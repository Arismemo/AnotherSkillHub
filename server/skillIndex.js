// 技能相关度索引：按任务描述找技能（ash suggest）、关键词搜不到时的候选、推送与审核时的相似技能。
// 不依赖外部模型。排序用逐字段 BM25：中文按字二元组、英文按词切分；description 讲「何时使用」、name/slug 是意图本身，
// 权重最高，其次标签、标题，正文最低——每个字段单独饱和，长正文反复出现某个词也盖不过描述里的一次命中。
// 相似度用意图字段（名称、描述、标签、标题）的 TF-IDF 余弦。索引按用户缓存，库有变化时重建。
const matter = require('gray-matter');
const db = require('./db');
const { localizedMeta, languagesOf } = require('./skillMeta');

const FIELD_WEIGHTS = { name: 3, description: 3, tags: 2, headings: 1.5, body: 0.6 };
const INTENT_FIELDS = ['name', 'description', 'tags', 'headings'];
const K1 = 1.2;
const B = 0.75;

// 查询里常见、却不代表任务内容的词。中文以二元组形式过滤
const STOP_EN = new Set(('a an and are as at be by can do does for from how i in into is it me my of on or our please should so that '
  + 'the this to use using want we what when where which with you your need help make get let some any all just').split(' '));
const STOP_ZH = new Set(['帮我', '一下', '如何', '怎么', '怎样', '我们', '你们', '这个', '那个', '需要', '可以', '进行', '一个', '然后',
  '现在', '请你', '能否', '是否', '什么', '为什么', '时候', '的时', '我想', '想要', '看看', '使用', '用于', '这些', '里的', '的一', '一份']);

// 中英对照：技能库常是中英混写，Agent 用中文描述任务时要能找到英文写的技能，反之亦然。
// 只收开发与运维里的高频概念；扩展出来的词按 EXPANSION_WEIGHT 计分，只加分不抬高满分线
const GLOSSARY = {
  测试: 'test', 调试: 'debug', 根因: 'root cause debug', 排查: 'troubleshoot debug', 报错: 'error', 错误: 'error', 故障: 'failure incident',
  部署: 'deploy', 上线: 'deploy release', 发布: 'release publish', 回滚: 'rollback', 构建: 'build', 编译: 'compile build',
  浏览器: 'browser', 网页: 'web page', 页面: 'page', 网站: 'website site', 登录: 'login', 填表: 'form', 表单: 'form', 截图: 'screenshot',
  文档: 'doc document', 飞书: 'lark feishu', 代码库: 'codebase repo', 仓库: 'repo repository', 代码: 'code',
  审查: 'review', 评审: 'review', 审核: 'review', 重构: 'refactor', 性能: 'performance', 优化: 'optimize',
  设计: 'design', 界面: 'ui interface', 前端: 'frontend', 后端: 'backend', 数据库: 'database', 服务器: 'server',
  容器: 'docker container', 日志: 'log', 监控: 'monitor', 图表: 'chart', 可视化: 'visualization dataviz',
  幻灯片: 'slides presentation', 演示: 'presentation slides', 表格: 'spreadsheet sheet', 翻译: 'translate', 写作: 'writing',
  简洁: 'concise', 总结: 'summary summarize', 摘要: 'summary', 新人: 'onboard onboarding', 新同事: 'onboard onboarding',
  上手: 'onboard', 入门: 'onboard getting started', 介绍: 'overview explain', 解释: 'explain', 计划: 'plan', 规划: 'plan',
  需求: 'requirement spec', 提交: 'commit', 合并: 'merge', 分支: 'branch', 安全: 'security', 漏洞: 'vulnerability security',
  依赖: 'dependency', 升级: 'upgrade', 迁移: 'migrate migration', 自动化: 'automation', 定时: 'schedule cron',
  图片: 'image', 图像: 'image', 视频: 'video', 生成: 'generate', 技能: 'skill', 验证: 'verify verification', 验收: 'verify acceptance',
  感知: 'perception', 检测: 'detection detect', 仿真: 'simulation sim', 回放: 'replay', 进度: 'progress status',
};
const EXPANSION_WEIGHT = 0.6;

const CJK = /[㐀-鿿豈-﫿]/;
const RUN = /[㐀-鿿豈-﫿]+|[a-z0-9]+/g;

function stem(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

// 切出词元序列；withSpans 时同时给出每个词元在原串中的位置（用于把命中的二元组拼回可读的词）
function tokenize(text, { withSpans = false } = {}) {
  const tokens = [];
  const spans = [];
  const source = String(text || '').toLowerCase();
  const push = (token, start, end) => { tokens.push(token); if (withSpans) spans.push({ token, start, end }); };
  for (const match of source.matchAll(RUN)) {
    const run = match[0];
    if (CJK.test(run[0])) {
      if (run.length === 1) { push(run, match.index, match.index + 1); continue; }
      for (let i = 0; i < run.length - 1; i += 1) {
        const bigram = run.slice(i, i + 2);
        if (!STOP_ZH.has(bigram)) push(bigram, match.index + i, match.index + i + 2);
      }
    } else if (run.length >= 2 && !STOP_EN.has(run)) {
      push(stem(run), match.index, match.index + run.length);
    }
  }
  return withSpans ? { tokens, spans, source } : tokens;
}

// 反向对照（英文词 → 中文词元），启动时算一次
const GLOSSARY_EN = new Map();
for (const [zh, en] of Object.entries(GLOSSARY)) {
  for (const token of tokenize(en)) GLOSSARY_EN.set(token, [...(GLOSSARY_EN.get(token) || []), ...tokenize(zh)]);
}

// 查询 → { 词元: 权重 }：原词 1，对照扩展出的词 EXPANSION_WEIGHT
function queryTerms(query) {
  const terms = new Map();
  const original = tokenize(query);
  for (const token of original) terms.set(token, 1);
  const expand = (token) => { if (!terms.has(token)) terms.set(token, EXPANSION_WEIGHT); };
  const lower = String(query || '').toLowerCase();
  for (const [zh, en] of Object.entries(GLOSSARY)) if (lower.includes(zh)) tokenize(en).forEach(expand);
  for (const token of original) (GLOSSARY_EN.get(token) || []).forEach(expand);
  return terms;
}

function stripFences(markdown) {
  return markdown.replace(/^(`{3,}|~{3,}).*\n[\s\S]*?^\1[^\n]*$/gm, (block) => block.replace(/^(`{3,}|~{3,}).*$/gm, ''));
}

function parseTags(tags) {
  if (Array.isArray(tags)) return tags;
  try { return JSON.parse(tags || '[]'); } catch { return []; }
}

// 一个技能 → 各字段文本。双语描述（description_en / description_zh、title_en / title_zh）并入对应字段：
// 中文任务能找到英文写的技能，查重也能跨语言对上
function skillFields(skill) {
  let body = skill.content || '';
  let data = {};
  try { const parsed = matter(body, {}); body = parsed.content; data = parsed.data || {}; } catch { /* frontmatter 坏了就整段当正文 */ }
  const headings = [...body.matchAll(/^#{1,4}\s+(.+)$/gm)].map((m) => m[1]).join('\n');
  const i18n = localizedMeta(data);
  return {
    name: `${skill.name || ''} ${String(skill.slug || '').replace(/[-_]/g, ' ')} ${i18n.title_en} ${i18n.title_zh}`,
    description: [skill.description || '', i18n.description_en, i18n.description_zh].join('\n'),
    tags: parseTags(skill.tags).join(' '),
    headings,
    body: stripFences(body),
  };
}

function termCounts(text) {
  const tf = new Map();
  const tokens = tokenize(text);
  for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
  return { tf, length: tokens.length };
}

function buildIndex(skills) {
  const docs = skills.map((skill) => {
    const text = skillFields(skill);
    const fields = Object.fromEntries(Object.keys(FIELD_WEIGHTS).map((f) => [f, termCounts(text[f])]));
    return { skill, fields };
  });
  const n = docs.length || 1;
  const avgLength = Object.fromEntries(Object.keys(FIELD_WEIGHTS).map((f) => [f, docs.reduce((sum, d) => sum + d.fields[f].length, 0) / n || 1]));
  const df = new Map();
  const intentDf = new Map();
  for (const doc of docs) {
    const all = new Set();
    const intent = new Set();
    for (const [field, { tf }] of Object.entries(doc.fields)) {
      for (const token of tf.keys()) { all.add(token); if (INTENT_FIELDS.includes(field)) intent.add(token); }
    }
    all.forEach((t) => df.set(t, (df.get(t) || 0) + 1));
    intent.forEach((t) => intentDf.set(t, (intentDf.get(t) || 0) + 1));
  }
  const idf = (token) => Math.log(1 + (docs.length - (df.get(token) || 0) + 0.5) / ((df.get(token) || 0) + 0.5));
  // 相似度用的 TF-IDF 向量（只含意图字段，按字段权重累加）：对称、0~1，长正文不会因为「顺带提到」而显得相似
  for (const doc of docs) {
    const weighted = new Map();
    for (const field of INTENT_FIELDS) {
      for (const [token, count] of doc.fields[field].tf) weighted.set(token, (weighted.get(token) || 0) + count * FIELD_WEIGHTS[field]);
    }
    const toVector = (entries) => {
      const vector = new Map();
      let norm = 0;
      for (const [token, tf] of entries) {
        const weight = (1 + Math.log(tf)) * Math.log((docs.length + 1) / ((intentDf.get(token) || 0) + 0.5));
        if (weight <= 0) continue;
        vector.set(token, weight);
        norm += weight * weight;
      }
      return { vector, norm: Math.sqrt(norm) };
    };
    doc.intent = toVector(weighted);
    // 按语言再各算一份：中文写的技能补了 description_en 之后，和英文写的同类技能在英文这一侧直接比，
    // 不会被各自另一种语言的标题稀释
    const entries = [...weighted];
    doc.primaryLanguage = languagesOf(doc.skill.description).zh ? 'zh' : 'en';
    doc.intentByLang = {
      zh: toVector(entries.filter(([token]) => CJK.test(token[0]))),
      en: toVector(entries.filter(([token]) => !CJK.test(token[0]))),
    };
  }
  return { docs, avgLength, idf };
}

// 两个技能「做的是不是同一件事」：整体比一次。主语言不同（一个中文写、一个英文写）时，再按语言各比一次取最高——
// 只在这种情况下分语言比：同语言的同系列技能（共享大段套话）分语言比会显得过于相似。
// 某种语言的词太少（例如中文技能里零星几个英文词）时不单独比较，免得一两个词撞上就判成重复
const MIN_LANG_TOKENS = 6;
function intentSimilarity(a, b) {
  let best = cosine(a.intent, b.intent);
  if (a.primaryLanguage === b.primaryLanguage) return best;
  for (const lang of ['zh', 'en']) {
    const x = a.intentByLang[lang];
    const y = b.intentByLang[lang];
    if (x.vector.size >= MIN_LANG_TOKENS && y.vector.size >= MIN_LANG_TOKENS) best = Math.max(best, cosine(x, y));
  }
  return best;
}

function cosine(a, b) {
  if (!a.norm || !b.norm) return 0;
  const [small, large] = a.vector.size < b.vector.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [token, weight] of small.vector) dot += weight * (large.vector.get(token) || 0);
  return dot / (a.norm * b.norm);
}

function scoreDoc(index, doc, terms) {
  let score = 0;
  const matched = [];
  for (const [token, queryWeight] of terms) {
    let termScore = 0;
    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
      const { tf, length } = doc.fields[field];
      const count = tf.get(token);
      if (!count) continue;
      termScore += weight * (count * (K1 + 1)) / (count + K1 * (1 - B + B * length / index.avgLength[field]));
    }
    if (!termScore) continue;
    score += queryWeight * index.idf(token) * termScore;
    if (queryWeight === 1) matched.push(token);
  }
  return { score, matched };
}

// ——— 按用户缓存 ———
const cache = new Map();

function librarySignature(userId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS n, MAX(updated_at) AS latest, SUM(LENGTH(content)) AS size, SUM(status = 'pending') AS pending, SUM(id) AS ids
    FROM skills WHERE user_id = ? AND is_deleted = 0
  `).get(userId);
  return `${row.n}|${row.latest}|${row.size}|${row.pending}|${row.ids}`;
}

function indexFor(userId) {
  const signature = librarySignature(userId);
  const hit = cache.get(userId);
  if (hit && hit.signature === signature) return hit.index;
  const skills = db.prepare(`
    SELECT id, slug, name, description, folder_path, tags, content, status, version FROM skills WHERE user_id = ? AND is_deleted = 0
  `).all(userId);
  const index = buildIndex(skills);
  index.skills = skills;
  index.extras = new Map();
  cache.set(userId, { signature, index });
  return index;
}

// 挂在索引上的其他整库计算（引用分析、重复配对等）：库一变化，随索引一起失效
function libraryCache(userId, key, build) {
  const index = indexFor(userId);
  if (!index.extras.has(key)) index.extras.set(key, build(index.skills, index));
  return index.extras.get(key);
}

// 把命中的词元拼回查询原文里的连续片段：「检测」「测框」→「检测框」
function matchedPhrases(query, matchedTokens) {
  const set = new Set(matchedTokens);
  const { spans, source } = tokenize(query, { withSpans: true });
  const phrases = [];
  for (const span of spans.filter((s) => set.has(s.token)).sort((a, b) => a.start - b.start)) {
    const last = phrases[phrases.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else phrases.push({ start: span.start, end: span.end });
  }
  return [...new Set(phrases.map((p) => source.slice(p.start, p.end)))];
}

// relevance = 得分 / 「全部原始查询词都在描述里命中一次」的得分，截到 0~1。
// 低于 MIN_RELEVANCE 视为不相关；STRONG_RELEVANCE 以上标为「相关」，其余为「可能相关」。
// 只保留不低于第一名 RELATIVE_CUTOFF 的结果，免得长尾噪声淹没真正的候选
const MIN_RELEVANCE = 0.12;
const STRONG_RELEVANCE = 0.25;
const RELATIVE_CUTOFF = 0.4;
const FULL_MATCH = FIELD_WEIGHTS.description * (K1 + 1) / (1 + K1);

function rankSkills(userId, query, options) {
  return rankInIndex(indexFor(userId), query, options);
}

// 默认只看已发布技能（Agent 拉得到的）
// where(skill) 可进一步限定范围（例如调用方已经按目录、标签筛选过）
function rankInIndex(index, query, { limit = 5, includePending = false, excludeIds = [], minRelevance = MIN_RELEVANCE, where = null } = {}) {
  const terms = queryTerms(query);
  if (!terms.size || !index.docs.length) return [];
  let ceiling = 0;
  for (const [token, weight] of terms) if (weight === 1) ceiling += index.idf(token) * FULL_MATCH;
  ceiling = ceiling || 1;
  const exclude = new Set(excludeIds.map(Number));
  const scored = [];
  for (const doc of index.docs) {
    if (exclude.has(doc.skill.id)) continue;
    if (!includePending && doc.skill.status === 'pending') continue;
    if (where && !where({ ...doc.skill, tags: parseTags(doc.skill.tags) })) continue;
    const { score, matched } = scoreDoc(index, doc, terms);
    if (score > 0) scored.push({ doc, score, matched, relevance: Math.min(1, score / ceiling) });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.relevance < minRelevance) return [];
  return scored
    .filter((r) => r.relevance >= minRelevance && r.score >= top.score * RELATIVE_CUTOFF)
    .slice(0, limit)
    .map((r) => ({
      skill: publicSkill(r.doc.skill), score: r.score, relevance: r.relevance,
      strong: r.relevance >= STRONG_RELEVANCE, matched: matchedPhrases(query, r.matched),
    }));
}

// 相似度：两个技能意图字段 TF-IDF 向量的余弦（0~1）。
// SIMILAR_MIN 以上算「相近」，SIMILAR_HIGH 以上提示「疑似重复」（用 139 个真实技能校准：
// 0.25~0.4 多是同一系列的兄弟技能，0.4 以上基本是职责重叠）
const SIMILAR_MIN = 0.25;
const SIMILAR_HIGH = 0.4;

function similarSkills(userId, target, options) {
  return similarInIndex(indexFor(userId), target, options);
}

function similarInIndex(index, target, { limit = 3, minSimilarity = SIMILAR_MIN, includePending = true } = {}) {
  const self = index.docs.find((d) => d.skill.id === target.id);
  if (!self) return [];
  const results = [];
  for (const doc of index.docs) {
    if (doc === self || doc.skill.slug === target.slug) continue;
    if (!includePending && doc.skill.status === 'pending') continue;
    const similarity = intentSimilarity(self, doc);
    if (similarity >= minSimilarity) results.push({ skill: publicSkill(doc.skill), similarity, high: similarity >= SIMILAR_HIGH });
  }
  return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

// 已发布技能里「疑似重复」的配对：Map(skillId → 最像的那个 { skill, similarity })。
// 列表、侧栏计数每次都要用，挂在索引上缓存，库变化、索引重建时一并失效
function duplicateMap(userId) {
  return libraryCache(userId, 'duplicates', (skills, index) => {
    const docs = index.docs.filter((d) => d.skill.status !== 'pending');
    const best = new Map();
    const keep = (a, b, similarity) => {
      if (!best.has(a.skill.id) || best.get(a.skill.id).similarity < similarity) best.set(a.skill.id, { skill: publicSkill(b.skill), similarity });
    };
    for (let i = 0; i < docs.length; i += 1) {
      for (let j = i + 1; j < docs.length; j += 1) {
        const similarity = intentSimilarity(docs[i], docs[j]);
        if (similarity >= SIMILAR_HIGH) { keep(docs[i], docs[j], similarity); keep(docs[j], docs[i], similarity); }
      }
    }
    return best;
  });
}

function publicSkill(skill) {
  const { id, slug, name, description, folder_path, status } = skill;
  return { id, slug, name, description, folder_path, status };
}

module.exports = { tokenize, queryTerms, buildIndex, rankSkills, rankInIndex, similarSkills, similarInIndex, duplicateMap, libraryCache, matchedPhrases };
