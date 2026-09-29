// 技能之间的引用与元技能检查：谁引用了谁、谁被谁引用、引用有没有写对、元技能有没有写契约、有没有人抄了元技能的步骤。
//
// 引用只认明确的信号（与依赖图一致）：
//   · frontmatter depends_on（ash pull 据此一并安装）
//   · 正文里指向 ../<slug>/SKILL.md 的本地链接
//   · 同一行里既有「元技能 / meta-skill」又有某个元技能完整 slug 的写法，如「用元技能 `verification-discipline`」
// 随口提到另一个技能的名字不算——仲裁规则里写「否则用 X」并不是引用 X。
const { parseFrontmatter, referencesOf, missingLanguages, localizedMeta, LANGUAGE_HINT } = require('./skillMeta');
const { extractCommands, sharedRuns } = require('./skillSteps');

const META_WORD = /元技能|meta[- ]skill/i;
const MAX_CHAIN = 2;       // 引用链超过这么多层给出提醒：每多一层，Agent 就多读一个文件、多一个可能断的地方
const EXTRACT_MIN = 3;     // 三次法则：≥3 个技能在重复同一段操作才建议提炼元技能

function list(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : typeof value === 'string' ? [value] : [];
}

function parseTags(tags) {
  if (Array.isArray(tags)) return tags;
  try { return JSON.parse(tags || '[]'); } catch { return []; }
}

// 元技能：frontmatter type/kind: meta、标签 meta-skill / 元技能、description 以「【元技能】」开头，或放在「元技能」目录里。
// 单独的 meta 标签不算：它常指「关于技能本身的技能」（例如怎么写技能），不是被别的技能引用的基础动作
function isMetaSkill(skill, data = {}) {
  return data.type === 'meta' || data.kind === 'meta' || data.metadata?.type === 'meta' || data.is_meta === true
    || list(parseTags(skill.tags)).some((tag) => ['meta-skill', '元技能'].includes(tag))
    || /^【元技能[·】]/.test(skill.description || '') || /(?:^|\/)元技能(?:\/|$)/.test(skill.folder_path || '');
}

function splitBody(content) {
  const text = String(content || '');
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

const stripFences = (body) => body.replace(/^(`{3,}|~{3,}).*\n[\s\S]*?^\1[^\n]*$/gm, '');

const slugPatterns = new Map();
function slugPattern(slug) {
  if (!slugPatterns.has(slug)) {
    const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    slugPatterns.set(slug, new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`));
  }
  return slugPatterns.get(slug);
}

// 正文里的引用：{ refs: Set<slug>, absolute: [绝对路径链接] }
function bodyReferences(body, metaSlugs) {
  const prose = stripFences(body);
  const refs = new Set();
  const absolute = [];
  for (const match of prose.matchAll(/\[[^\]]*\]\(<?([^\s)>]+)(?:>?(?:\s+"[^"]*")?)\)/g)) {
    const href = match[1];
    if (/^[a-z][a-z\d+.-]*:/i.test(href)) continue;
    let path;
    try { path = decodeURIComponent(href.split(/[?#]/)[0]); } catch { continue; }
    const target = path.match(/(?:^|\/)([^/]+)\/SKILL\.md$/i);
    if (!target) continue;
    refs.add(target[1]);
    if (/^(~|\/|[A-Za-z]:\\)/.test(path)) absolute.push(path);
  }
  for (const line of prose.split('\n')) {
    if (!META_WORD.test(line)) continue;
    for (const slug of metaSlugs) if (slugPattern(slug).test(line)) refs.add(slug);
  }
  return { refs, absolute };
}

// 「## 标题」下的一节正文（到下一个同级或更高级标题为止）
function section(body, titles) {
  const prose = stripFences(body);
  const heading = new RegExp(`^(#{2,4})\\s*(?:${titles.join('|')})\\s*$`, 'mi');
  const m = heading.exec(prose);
  if (!m) return null;
  const rest = prose.slice(m.index + m[0].length);
  const next = new RegExp(`^#{2,${m[1].length}}\\s`, 'm').exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

// 「## 被谁引用」里列出的技能：反引号里的 slug，或列表项开头的 slug（库里已经没有的也要列出来，才能提示它过时了）
function listedSlugs(text, self) {
  const found = new Set();
  for (const m of text.matchAll(/`([A-Za-z0-9_.-]+)`/g)) found.add(m[1]);
  for (const m of text.matchAll(/^\s*[-*]\s+([A-Za-z0-9_.-]+)(?=\s|$|[（(:：,，])/gm)) found.add(m[1]);
  found.delete(self);
  return found;
}

// 单个技能的引用与结构信息。library 提供库里的 slug 集合，以便分辨哪些引用解析得到
function analyzeSkill(skill, library) {
  const { data, error: frontmatterError } = parseFrontmatter(skill.content || '');
  const body = splitBody(skill.content);
  const meta = isMetaSkill(skill, data);
  const { refs: declared, invalid } = referencesOf(skill.content);
  const { refs: inBody, absolute } = bodyReferences(body, library.metaSlugs);
  inBody.delete(skill.slug);
  const contract = section(body, ['契约', 'Contract', '接口', 'Interface']);
  const usedBy = section(body, ['被谁引用', 'Used by', '调用方']);
  return {
    id: skill.id, slug: skill.slug, name: skill.name, status: skill.status, version: skill.version, meta, frontmatterError,
    declared: declared.filter((r) => r.slug !== skill.slug), invalid, inBody, absolute,
    contract: contract === null ? null : {
      input: /输入|input/i.test(contract), output: /输出|output|返回|拿回/i.test(contract),
    },
    usedByListed: usedBy === null ? null : listedSlugs(usedBy, skill.slug),
    missingLanguages: skill.description ? missingLanguages(skill.description, localizedMeta(data)) : [],
    commands: extractCommands(skill.content),
  };
}

// 引用是否指向本库：没写账号，或写的就是自己的账号
const isLocal = (ref, username) => !ref.owner || (username && ref.owner.toLowerCase() === String(username).toLowerCase());

// 整个库的引用分析。skills 为库里未删除的技能（含待审核）
function analyzeLibrary(skills) {
  const slugs = new Set(skills.map((s) => s.slug));
  const metaSlugs = skills.filter((s) => isMetaSkill(s, parseFrontmatter(s.content || '').data)).map((s) => s.slug);
  const library = { slugs, metaSlugs };
  const entries = skills.map((s) => analyzeSkill(s, library));
  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  // 被谁引用：声明的本库引用 + 正文引用（跨账号的引用不计入本库的反向索引）
  const dependents = new Map();
  const outgoing = new Map();
  for (const e of entries) {
    const targets = new Set([...e.declared.filter((r) => !r.owner).map((r) => r.slug), ...e.inBody]);
    outgoing.set(e.slug, [...targets].filter((t) => bySlug.has(t)));
    for (const t of targets) {
      if (!bySlug.has(t)) continue;
      if (!dependents.has(t)) dependents.set(t, []);
      dependents.get(t).push(e.slug);
    }
  }
  // 共有的命令段：所有技能（含待审核，推送时的新技能也要能比对）
  const runs = sharedRuns(entries.filter((e) => e.commands.length).map((e) => ({ id: e.id, commands: e.commands })));
  return { library, entries, bySlug, dependents, outgoing, runs };
}

// 从 slug 出发最长的引用链，以及遇到的环
function chainFrom(analysis, slug) {
  let longest = [slug];
  let cycle = null;
  const walk = (path) => {
    if (path.length > longest.length) longest = path;
    for (const next of analysis.outgoing.get(path[path.length - 1]) || []) {
      if (path.includes(next)) { if (!cycle && next === slug) cycle = [...path, next]; continue; }
      if (path.length <= 6) walk([...path, next]);
    }
  };
  walk([slug]);
  return { longest, cycle };
}

const idsToSlugs = (analysis, ids) => ids.map((id) => analysis.entries.find((e) => e.id === id)).filter(Boolean);

// 与 entry 共有命令段的其他技能：[{ others: [entry…], commands }]
function sharedStepsOf(analysis, entry) {
  // entry 可能是还没进库的内容（待审更新）：那就单独把它和库里其他技能比一遍
  const inLibrary = analysis.entries.includes(entry);
  const runs = inLibrary ? analysis.runs : sharedRuns([
    { id: entry.id, commands: entry.commands },
    ...analysis.entries.filter((e) => e.id !== entry.id && e.commands.length).map((e) => ({ id: e.id, commands: e.commands })),
  ]);
  return runs.filter((r) => r.skills.includes(entry.id))
    .map((r) => ({ others: idsToSlugs(analysis, r.skills.filter((id) => id !== entry.id)), commands: r.commands }));
}

// 检查一个技能：[{ code, level: warn | info, msg }]。entry 默认取库里的分析结果，也可以传入待审内容的分析
function lintSkill(analysis, entry, { username = null } = {}) {
  const issues = [];
  const add = (code, level, msg) => issues.push({ code, level, msg });
  // frontmatter 解析失败时 name / description / depends_on 全部丢失，Agent 框架也读不到——最先修
  if (entry.frontmatterError) add('frontmatter', 'warn', `frontmatter 解析失败（含「: 」的值要用引号括起来）：${entry.frontmatterError.split('\n')[0]}`);
  entry.missingLanguages.forEach((lang) => add('bilingual', 'warn', LANGUAGE_HINT[lang]));

  const declaredLocal = new Set();
  for (const raw of entry.invalid) add('invalid-ref', 'warn', `depends_on 里的「${raw}」写法不对：应为 slug、@账号/slug 或 slug@版本`);
  for (const ref of entry.declared) {
    if (!isLocal(ref, username)) {
      add('foreign-ref', 'info', `${ref.raw} 指向其他账号：团队库 / 技能广场上线前还不能跨账号安装`);
      continue;
    }
    declaredLocal.add(ref.slug);
    const target = analysis.bySlug.get(ref.slug);
    if (!target) add('missing-ref', 'warn', `引用的 ${ref.slug} 不在库里（或已删除）：ash pull 装不上它`);
    else if (target.status === 'pending') add('pending-ref', 'info', `引用的 ${ref.slug} 还在待审核：采纳前别的机器装不上它`);
    else if (ref.pin && target.version && ref.pin !== target.version) {
      add('pin-mismatch', 'warn', `固定在 ${ref.slug}@${ref.pin}，库里当前是 ${target.version}：ash pull 会装当前版本，请确认仍然适用后更新版本号`);
    }
  }
  for (const slug of entry.inBody) {
    if (declaredLocal.has(slug) || !analysis.bySlug.has(slug)) continue;
    add('undeclared-ref', 'warn', `正文引用了 ${slug}，但 depends_on 没有声明：ash pull 不会一并装上它，本地 Agent 可能找不到`);
  }
  for (const path of entry.absolute) add('absolute-link', 'warn', `链接 ${path} 用了绝对路径：换一台机器或换一个 Agent 就找不到，请写成相对路径 ../<slug>/SKILL.md`);

  if (analysis.bySlug.get(entry.slug) === entry) {
    const { longest, cycle } = chainFrom(analysis, entry.slug);
    if (cycle) add('cycle', 'warn', `引用成环：${cycle.join(' → ')}`);
    else if (longest.length - 1 > MAX_CHAIN) {
      add('deep-chain', 'info', `引用链有 ${longest.length - 1} 层（${longest.join(' → ')}）：每多一层，Agent 就要多读一个文件、多一个可能断的地方；考虑把中间层的内容收进调用方或元技能`);
    }
  }

  if (entry.meta) {
    const actual = (analysis.dependents.get(entry.slug) || []).filter((s) => s !== entry.slug);
    if (!entry.contract) add('meta-contract', 'warn', '元技能缺少「## 契约」一节（输入 / 输出 / 前置 / 失败）：调用方靠它知道要给什么、能拿回什么');
    else if (!entry.contract.input || !entry.contract.output) add('meta-contract', 'info', '「## 契约」里没写清输入或输出');
    if (!entry.usedByListed) {
      add('meta-used-by', 'info', `元技能缺少「## 被谁引用」一节：改它之前要知道会影响谁${actual.length ? `（实际被 ${actual.join('、')} 引用）` : ''}`);
    } else {
      const missing = actual.filter((s) => !entry.usedByListed.has(s));
      const extra = [...entry.usedByListed].filter((s) => !actual.includes(s));
      if (missing.length || extra.length) {
        add('meta-used-by', 'info', `「## 被谁引用」与实际不符${missing.length ? `：漏了 ${missing.join('、')}` : ''}${extra.length ? `${missing.length ? '；' : '：'}${extra.join('、')} 其实没有引用它` : ''}`);
      }
    }
    if (actual.length < 2) {
      add('meta-few-callers', 'info', `只有 ${actual.length} 个技能引用这个元技能。三次法则：第 3 个调用方出现再抽；抽出后要立刻把调用方改成引用它`);
    }
  }

  for (const { others, commands } of sharedStepsOf(analysis, entry)) {
    const metaOthers = others.filter((o) => o.meta);
    if (!entry.meta && metaOthers.length) {
      const m = metaOthers[0].slug;
      add('copies-meta', 'warn', `有 ${commands.length} 条命令与元技能 ${m} 相同：引用它（depends_on 加上 ${m}，正文写「用元技能 \`${m}\`」+ 本技能特有的参数），不要抄它的步骤`);
    } else if (!metaOthers.length && others.length + 1 >= EXTRACT_MIN) {
      add('extract-candidate', 'info', `有 ${commands.length} 条命令与 ${others.map((o) => o.slug).join('、')} 相同：已有 ${others.length + 1} 个技能在重复这段操作，可以考虑提炼为元技能`);
    }
  }
  return issues;
}

// 整理用的结构信号（「需关注」视图）：Map(skillId → [{ code, label, detail }])，只看已发布技能
function structuralFlags(analysis) {
  const flags = new Map();
  const add = (id, flag) => { if (!flags.has(id)) flags.set(id, []); if (!flags.get(id).some((f) => f.code === flag.code)) flags.get(id).push(flag); };
  const published = analysis.entries.filter((e) => e.status !== 'pending');
  for (const e of published) {
    const broken = e.declared.filter((r) => !r.owner && !analysis.bySlug.has(r.slug)).map((r) => r.slug);
    if (broken.length) add(e.id, { code: 'broken_ref', label: '引用失效', detail: `引用的 ${broken.join('、')} 不在库里` });
    if (e.meta && !e.contract) add(e.id, { code: 'meta_contract', label: '元技能缺契约', detail: '缺少「## 契约」一节（输入 / 输出 / 前置 / 失败）' });
  }
  const publishedIds = new Set(published.map((e) => e.id));
  for (const run of analysis.runs) {
    const members = idsToSlugs(analysis, run.skills).filter((e) => publishedIds.has(e.id));
    const metas = members.filter((e) => e.meta);
    if (metas.length) {
      for (const e of members.filter((m) => !m.meta)) {
        add(e.id, { code: 'copies_meta', label: '抄了元技能步骤', detail: `有 ${run.commands.length} 条命令与元技能 ${metas[0].slug} 相同，应改为引用它` });
      }
    } else if (members.length >= EXTRACT_MIN) {
      for (const e of members) {
        add(e.id, { code: 'extractable', label: '可提炼元技能', detail: `与 ${members.filter((m) => m !== e).map((m) => m.slug).join('、')} 有 ${run.commands.length} 条相同的命令` });
      }
    }
  }
  return flags;
}

// ——— 按用户缓存（挂在相关度索引上，库一变化就重算）———
// 延迟加载：上面的纯函数不依赖数据库，单元测试可以直接用
function libraryAnalysis(userId) {
  return require('./skillIndex').libraryCache(userId, 'refs', (skills) => analyzeLibrary(skills));
}

// 某个技能的分析：默认取库里那份；传入 content（例如待审更新、刚推送还没进库的内容）时按这份内容分析
function entryFor(userId, skill, content) {
  const analysis = libraryAnalysis(userId);
  const inLibrary = analysis.bySlug.get(skill.slug);
  const entry = content === undefined && inLibrary ? inLibrary : analyzeSkill({ ...skill, content: content ?? skill.content }, analysis.library);
  return { analysis, entry };
}

function lintFor(userId, skill, { username = null, content } = {}) {
  const { analysis, entry } = entryFor(userId, skill, content);
  return lintSkill(analysis, entry, { username });
}

module.exports = {
  analyzeLibrary, analyzeSkill, lintSkill, sharedStepsOf, chainFrom, isMetaSkill, isLocal, bodyReferences, structuralFlags,
  libraryAnalysis, entryFor, lintFor, splitBody, EXTRACT_MIN,
};
