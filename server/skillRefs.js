// 技能之间的引用与元技能检查：谁引用了谁、谁被谁引用、引用有没有写对、元技能有没有写契约、有没有人抄了元技能的步骤。
//
// 引用只认明确的信号（与依赖图一致）：
//   · frontmatter depends_on（ash pull 据此一并安装）
//   · 正文里指向 ../<slug>/SKILL.md 的本地链接，以及指向别的技能里文件的相对路径（../<slug>/references/x.md、../<slug>/scripts/run.sh）
//   · 同一行里既有「元技能 / meta-skill」又有某个元技能完整 slug 的写法，如「用元技能 `verification-discipline`」
// 随口提到另一个技能的名字不算——仲裁规则里写「否则用 X」并不是引用 X；「交给 X」只检查 X 存不存在，不算引用。
const { parseFrontmatter, referencesOf, missingLanguages, localizedMeta, LANGUAGE_HINT, effectsOf, callModeOf, EFFECT_LEVELS, EFFECT_LABELS } = require('./skillMeta');
const { extractCommands, sharedRuns, extractProseSteps, sharedProseRuns } = require('./skillSteps');

const META_WORD = /元技能|meta[- ]skill/i;
// 元技能引用链超过这么多层给出提醒：调用一个技能就是把它的正文读进同一个上下文，每多一层元技能，Agent 就多读一个文件、
// 多一个可能断的地方。只沿指向元技能的边数：业务技能把一整段阶段交给另一个业务技能，是那个技能自己的结构，不算进调用方
const MAX_CHAIN = 2;
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

// 指向别的技能目录里文件的相对路径（SKILL.md 之外）：../<slug>/references/x.md、../<slug>/scripts/run.sh
const SIBLING_FILE = /^(?:\.\/)?\.\.\/([A-Za-z0-9_.-]+)\/(.+)$/;

// 正文里的引用：
//   refs     Set<slug>：引用了哪些技能
//   inline   Set<slug>：其中要读进上下文的（链接到 SKILL.md 或 references/、写着「元技能 x」）；只跑对方脚本的不算，脚本是叶子
//   absolute [绝对路径链接]
//   files    [{ slug, path }]：链接到别的技能里的哪个文件，检查时核对文件在不在
function bodyReferences(body, metaSlugs) {
  const prose = stripFences(body);
  const refs = new Set();
  const inline = new Set();
  const absolute = [];
  const files = [];
  const sibling = (path) => {
    const m = SIBLING_FILE.exec(path);
    if (!m || /^SKILL\.md$/i.test(m[2])) return;
    const rel = m[2].replace(/\/+$/, '');
    refs.add(m[1]);
    if (!/^scripts\//.test(rel)) inline.add(m[1]);
    if (!files.some((f) => f.slug === m[1] && f.path === rel)) files.push({ slug: m[1], path: rel });
  };
  for (const match of prose.matchAll(/\[[^\]]*\]\(<?([^\s)>]+)(?:>?(?:\s+"[^"]*")?)\)/g)) {
    const href = match[1];
    if (/^[a-z][a-z\d+.-]*:/i.test(href)) continue;
    let path;
    try { path = decodeURIComponent(href.split(/[?#]/)[0]); } catch { continue; }
    const target = path.match(/(?:^|\/)([^/]+)\/SKILL\.md$/i);
    if (!target) { sibling(path); continue; }
    refs.add(target[1]);
    inline.add(target[1]);
    if (/^(~|\/|[A-Za-z]:\\)/.test(path)) absolute.push(path);
  }
  // 行内代码里写的相对路径也算：`../verification-discipline/references/evidence.md`
  for (const match of prose.matchAll(/`(\.{1,2}\/[^`\s]+)`/g)) sibling(match[1]);
  for (const line of prose.split('\n')) {
    if (!META_WORD.test(line)) continue;
    for (const slug of metaSlugs) if (slugPattern(slug).test(line)) { refs.add(slug); inline.add(slug); }
  }
  return { refs, inline, absolute, files };
}

// 技能目录里有哪些附属文件：库里的技能带 file_paths（见 skillIndex）或 files；拿不到时为 null，不做文件核对
function filePathsOf(skill) {
  const raw = skill.file_paths ?? skill.files;
  if (raw === undefined || raw === null) return null;
  try {
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(list) ? new Set(list.map((f) => (typeof f === 'string' ? f : f?.path)).filter(Boolean)) : null;
  } catch { return null; }
}

// 「交给 X」里写的技能：只认带连字符的 slug 写法（单个英文词多半是普通名词），取到第一个逗号为止；
// 同一个括号里注明不在本库的不算（「交给 hermes-agent，不在本库」「交给 Hermes Profile `x`（不是本库技能）」）
const HANDOFF_CLAUSE = /交给([^。；;）)\n]*)/g;
const SLUG_TOKEN = /(?<![\w.-])[a-z0-9]+(?:-[a-z0-9]+)+(?![\w-])/g;
function handoffTargets(text) {
  const found = new Set();
  for (const m of String(text || '').matchAll(HANDOFF_CLAUSE)) {
    if (/不在本库|不是本库|非本库|库外/.test(m[1])) continue;
    for (const token of m[1].split(/[，,]/)[0].match(SLUG_TOKEN) || []) found.add(token);
  }
  return [...found];
}

// 改名 / 合并留下的去向（analysis.redirects 由 libraryAnalysis 从 skill_redirects 填入）：顺着走到库里还在的技能，最多 5 跳
function movedTo(analysis, slug) {
  let current = slug;
  for (let hops = 0; hops < 5; hops += 1) {
    const next = analysis.redirects?.get(current);
    if (!next) return null;
    if (analysis.bySlug.has(next)) return next;
    current = next;
  }
  return null;
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

// 「## 契约」里的各项：表格行「| **输入** | … |」或列表行「- 输入：…」→ Map(项名 → 内容，空白已归一)。表头和分隔行不算
const CONTRACT_TITLES = ['契约', 'Contract', '接口', 'Interface'];
const CONTRACT_HEADER = /^(项|字段|item|field)$/i;
function contractRows(text) {
  const rows = new Map();
  const clean = (value) => value.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  for (const line of String(text || '').split('\n')) {
    const cells = /^\s*\|(.+)\|\s*$/.exec(line);
    if (cells) {
      const [label, ...rest] = cells[1].split('|').map(clean);
      if (label && !/^[-:\s]+$/.test(label) && !CONTRACT_HEADER.test(label)) rows.set(label, rest.join(' | '));
      continue;
    }
    const item = /^\s*[-*]\s*\**([^：:*\n]{1,12}?)\**\s*[：:]\s*(.*)$/.exec(line);
    if (item) rows.set(clean(item[1]), clean(item[2]));
  }
  return rows;
}

const majorOf = (version) => {
  const m = /^v?(\d+)\.\d+/.exec(String(version || '').trim());
  return m ? Number(m[1]) : null;
};

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
  const { refs: inBody, inline: inBodyInline, absolute, files } = bodyReferences(body, library.metaSlugs);
  inBody.delete(skill.slug);
  inBodyInline.delete(skill.slug);
  const contract = section(body, CONTRACT_TITLES);
  const rows = contractRows(contract);
  const has = (re) => [...rows.keys()].some((k) => re.test(k));
  const effects = effectsOf(data);
  const call = callModeOf(data);
  const usedBy = section(body, ['被谁引用', 'Used by', '调用方']);
  return {
    id: skill.id, slug: skill.slug, name: skill.name, status: skill.status, version: skill.version, meta, frontmatterError, body,
    frontmatterName: typeof data.name === 'string' ? data.name.trim() : null,
    description: String(skill.description || ''),
    // Claude Code 不会自动调用设置了这个字段的技能——别的技能也就引用不到它
    disableModelInvocation: /^(true|yes|on|1)$/i.test(String(data['disable-model-invocation'] ?? '')),
    declared: declared.filter((r) => r.slug !== skill.slug), invalid, inBody, inBodyInline, absolute,
    fileLinks: files.filter((f) => f.slug !== skill.slug),
    filePaths: filePathsOf(skill),
    contract: contract === null ? null : {
      input: /输入|input/i.test(contract), output: /输出|output|返回|拿回/i.test(contract),
      resources: has(/^(资源|resources?)$/i), rows,
    },
    // frontmatter 里的版本号：待审内容的版本以它为准（库里那一行还是旧版本）
    declaredVersion: data.version !== undefined && data.version !== null ? String(data.version).trim() : (skill.version || null),
    effects: effects.value, effectsRaw: effects.raw, effectsInvalid: effects.invalid,
    call: call.value, callRaw: call.raw, callInvalid: call.invalid,
    usedByListed: usedBy === null ? null : listedSlugs(usedBy, skill.slug),
    missingLanguages: skill.description ? missingLanguages(skill.description, localizedMeta(data)) : [],
    hasEnglishDescription: Boolean(localizedMeta(data).description_en),
    commands: extractCommands(skill.content),
    steps: extractProseSteps(skill.content),
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
  // 读进上下文的引用（声明的依赖 + 正文里要读的）：数引用链层数只走这些边，只跑对方脚本的不算
  const inlineOutgoing = new Map();
  for (const e of entries) {
    const declared = e.declared.filter((r) => !r.owner).map((r) => r.slug);
    const targets = new Set([...declared, ...e.inBody]);
    outgoing.set(e.slug, [...targets].filter((t) => bySlug.has(t)));
    inlineOutgoing.set(e.slug, [...new Set([...declared, ...e.inBodyInline])].filter((t) => bySlug.has(t)));
    for (const t of targets) {
      if (!bySlug.has(t)) continue;
      if (!dependents.has(t)) dependents.set(t, []);
      dependents.get(t).push(e.slug);
    }
  }
  // 共有的命令段、文字步骤段：所有技能（含待审核，推送时的新技能也要能比对）
  const runs = computeRuns(entries);
  return { library, entries, bySlug, dependents, outgoing, inlineOutgoing, runs };
}

// 固定的版本在历史里有没有（analysis.historyVersions 由 libraryAnalysis 从 skill_versions 填入）
const pinAvailable = (analysis, ref) => Boolean(analysis.historyVersions?.get(ref.slug)?.has(String(ref.pin)));

// 从 slug 出发的引用链：
//   cycle    沿所有引用边找回到自己的环
//   longest  只沿指向元技能、且要读进上下文的边走出的最长链（层数提醒用）；独立调用的元技能不往下走
function chainFrom(analysis, slug) {
  let longest = [slug];
  let cycle = null;
  const walkCycle = (path) => {
    for (const next of analysis.outgoing.get(path[path.length - 1]) || []) {
      if (path.includes(next)) { if (!cycle && next === slug) cycle = [...path, next]; continue; }
      if (path.length <= 6) walkCycle([...path, next]);
    }
  };
  const walkDepth = (path) => {
    if (path.length > longest.length) longest = path;
    for (const next of (analysis.inlineOutgoing || analysis.outgoing).get(path[path.length - 1]) || []) {
      const target = analysis.bySlug.get(next);
      // 独立调用（call: fork）的元技能在子代理里执行，是新的上下文：它自己的层数在检查它时单算
      if (path.includes(next) || !target?.meta || target.call === 'fork') continue;
      if (path.length <= 6) walkDepth([...path, next]);
    }
  };
  walkCycle([slug]);
  walkDepth([slug]);
  return { longest, cycle };
}

// kind: commands（shell 命令）| steps（文字步骤）
function computeRuns(entries) {
  return [
    ...sharedRuns(entries.filter((e) => e.commands.length).map((e) => ({ id: e.id, commands: e.commands }))).map((r) => ({ ...r, kind: 'commands' })),
    ...sharedProseRuns(entries.filter((e) => e.steps.length).map((e) => ({ id: e.id, steps: e.steps }))).map((r) => ({ ...r, kind: 'steps' })),
  ];
}
const UNIT = { commands: '条命令', steps: '个步骤' };

const idsToSlugs = (analysis, ids) => ids.map((id) => analysis.entries.find((e) => e.id === id)).filter(Boolean);

// 与 entry 共有命令段的其他技能：[{ others: [entry…], commands }]
function sharedStepsOf(analysis, entry) {
  // entry 可能是还没进库的内容（待审更新）：那就单独把它和库里其他技能比一遍
  const inLibrary = analysis.entries.includes(entry);
  const runs = inLibrary ? analysis.runs : computeRuns([entry, ...analysis.entries.filter((e) => e.id !== entry.id)]);
  return runs.filter((r) => r.skills.includes(entry.id))
    .map((r) => ({ others: idsToSlugs(analysis, r.skills.filter((id) => id !== entry.id)), commands: r.commands, kind: r.kind }));
}

// ——— 副作用与调用方式（effects / call）———
const RANK = Object.fromEntries(EFFECT_LEVELS.map((level, i) => [level, i]));
const effectName = (level) => `${level}（${EFFECT_LABELS[level]}）`;

function effectIssues(analysis, entry, add) {
  if (entry.effectsInvalid) add('effects-invalid', 'warn', `effects 写成了「${entry.effectsRaw}」：只能是 read-only（只读）、temporary（临时占用，用完要收）或 mutating（改动）`);
  if (entry.callInvalid) add('call-invalid', 'warn', `call 写成了「${entry.callRaw}」：只能是 inline（默认，读进调用方的上下文）或 fork（独立调用，在子代理里执行）`);
  // 像 const：按本技能做事会经过被调用技能的步骤，副作用至少和它一样大
  const callees = [...new Set([...entry.declared.filter((r) => !r.owner).map((r) => r.slug), ...entry.inBody])]
    .map((slug) => analysis.bySlug.get(slug)).filter((t) => t && t.effects && t.slug !== entry.slug);
  if (entry.effects) {
    for (const t of callees) {
      if (RANK[t.effects] <= RANK[entry.effects]) continue;
      add('effects-escalation', 'warn', `声明了 effects: ${entry.effects}，但引用的 ${t.slug} 是 ${effectName(t.effects)}：按本技能做事会经过它的步骤，`
        + `effects 至少要写 ${t.effects}；如果只用到 ${t.slug} 里不改东西的部分，改成引用那一部分（例如它的 references 文件）`);
    }
  } else if (!entry.effectsInvalid) {
    const risky = callees.filter((t) => t.effects !== 'read-only');
    if (entry.meta) add('effects-missing', 'info', '元技能没有声明 effects（read-only / temporary / mutating）：调用方要靠它判断能不能放进子代理、做之前要不要先找用户确认');
    else if (risky.length) add('effects-missing', 'info', `引用了 ${risky.map((t) => `${t.slug}（${effectName(t.effects)}）`).join('、')}，本技能却没有声明 effects：写上本技能的级别，Agent 才知道哪一步要先确认`);
  }
  if (entry.call === 'fork') {
    if (entry.effects === 'mutating') {
      add('fork-mutating', 'warn', 'call: fork 的技能在子代理里执行：子代理没法当场找用户确认，在后台跑用户也看不见。改动级（mutating）的技能不能独立调用，去掉 call: fork');
    } else if (!entry.effects) {
      add('fork-effects', 'info', 'call: fork 的技能要声明 effects（read-only 或 temporary）：调用方据此确认它能放进子代理');
    }
    if (!entry.contract || !entry.contract.input || !entry.contract.output) {
      add('fork-contract', 'warn', '独立调用（call: fork）的技能在子代理里执行，子代理看不到调用方的对话，调用方也只拿得到它交回的结果：「## 契约」要写清输入（调用时要传什么）和输出（交回什么、什么格式）');
    }
  }
  if (entry.contract && (entry.effects === 'temporary' || entry.effects === 'mutating') && !entry.contract.resources) {
    add('contract-resources', 'info', `effects 是 ${effectName(entry.effects)}，但「## 契约」没有「资源」一项：写清会占用什么（后台进程、隧道、窗口、临时文件）、由谁在什么时候收，中途失败也要收`);
  }
}

// 契约里已有的项改了或删了，等于改了函数签名：要升主版本，依赖它的技能要复核。只新增项向后兼容。
// 只比「签名」项（输入、输出、前置、失败、交回格式……）；「副作用」「资源」是说明，改了只提醒核对 effects——
// 级别本身的变化由调用方的 effects-escalation 检查兜住。比较前去掉格式差异（全半角标点、空白、反引号、加粗）
const DESCRIPTIVE_ROW = /^(副作用|资源|side effects?|resources?)$/i;
const FULLWIDTH = { '，': ',', '。': '.', '：': ':', '；': ';', '（': '(', '）': ')', '、': ',', '“': '"', '”': '"', '‘': "'", '’': "'" };
const sameMeaning = (a, b) => {
  const norm = (t) => String(t || '').replace(/[，。：；（）、“”‘’]/g, (c) => FULLWIDTH[c]).replace(/[`*\s]/g, '').replace(/[.;]$/, '');
  return norm(a) === norm(b);
};
function contractChangeIssues(analysis, entry, previous, add) {
  if (previous.status === 'pending' || !previous.contract || !previous.contract.rows.size) return;
  const after = entry.contract ? entry.contract.rows : new Map();
  const changed = [...previous.contract.rows].filter(([label, text]) => !after.has(label) || !sameMeaning(after.get(label), text)).map(([label]) => label);
  const signature = changed.filter((label) => !DESCRIPTIVE_ROW.test(label));
  const descriptive = changed.filter((label) => DESCRIPTIVE_ROW.test(label));
  if (descriptive.length) {
    add('contract-effects-changed', 'info', `「## 契约」里的 ${descriptive.join('、')} 改了：确认 frontmatter 的 effects 是否也要跟着变（升级了的话，调用方的 effects 也要跟上）`);
  }
  if (!signature.length) return;
  const before = majorOf(previous.declaredVersion);
  const now = majorOf(entry.declaredVersion);
  if (before === null || now === null || now > before) return;
  const dependents = (analysis.dependents.get(entry.slug) || []).filter((s) => s !== entry.slug);
  add('contract-major', 'warn', `「## 契约」里的 ${signature.join('、')} 改了或删了，但版本 ${previous.declaredVersion} → ${entry.declaredVersion} 没有升主版本：`
    + `按旧契约写的调用方可能对不上。升到 ${before + 1}.0.0${dependents.length ? `，并复核依赖它的 ${dependents.join('、')}` : ''}（只新增项、只改措辞格式不用升主版本）`);
}

// ——— 全库写作约定（meta-skill-spec「全库写作约定」节的机器检查）———
// 只查能机械判断的：description 结构、正文里的地址/个人路径/口令赋值、元技能的必备节。
// 是否「写得好」仍靠人审；这里的提示要能让 Agent 照着改完重推。
const CJK = /[㐀-鿿]/g;
const HANDOFF = /不要用于|不适用|不负责|交给|Not for|not for|Do not use/;
const USE_WHEN = /\bUse (?:it |this )?(?:when|for|to)\b/i;
const DESCRIPTION_SOFT_MAX = 450;
// 只认 RFC1918 / Tailscale 段，且前面不是版本号上下文（「version 10.13.3.9」这类）
const PRIVATE_IP = /(?<![\d.]|version\s|版本\s?|v)(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\.\d{1,3}\.\d{1,3}(?![\d.])/i;
// 容器里的公共账号（vscode、sdk、root…）不算个人路径
const HOME_PATH = /(?:\/home|\/Users)\/(?!<|\$|USER\b|user\b|me\b|vscode\b|sdk\b|root\b|ubuntu\b|runner\b|node\b|app\b)[a-z][\w.-]*\//;
const SECRET_ASSIGN = /\b(?:[A-Z0-9_]*(?:PASS(?:WORD)?|TOKEN|SECRET|_AK|API_?KEY)|AK)\s*=\s*['"]?(?![$<{]|\.\.\.|xxx)[A-Za-z0-9_\-+/]{8,}/;

function conventionIssues(entry) {
  const issues = [];
  const desc = entry.description.trim();
  if (desc) {
    const cjk = (desc.match(CJK) || []).length;
    if (cjk < 8) issues.push(['desc-zh', 'info', 'description 没有中文主句：全库约定 description 以中文写「做什么 + 什么时候用」，末尾再加一句英文 Use when …（中文任务才能可靠地找到它）']);
    if (!HANDOFF.test(desc)) issues.push(['desc-boundary', 'info', 'description 缺少「不要用于…（交给 X）」：写明边界和该交给谁，才能防止和相近技能互抢触发']);
    if (!USE_WHEN.test(desc) && !entry.hasEnglishDescription) issues.push(['desc-use-when', 'info', 'description 末尾缺一句英文「Use when …」（或写 description_en）：英文任务和跨语言查重靠它']);
    if (desc.length > DESCRIPTION_SOFT_MAX) issues.push(['desc-long', 'info', `description 有 ${desc.length} 个字符，约定在 ${DESCRIPTION_SOFT_MAX} 以内：实现细节、端口、命令挪进正文`]);
  }
  // 地址、路径、口令最常出现在命令里：连代码块一起查
  const body = entry.body || '';
  const ip = body.match(PRIVATE_IP);
  const endpointOwner = /##\s*端点[^\n]*唯一/.test(entry.body || '');
  if (ip && !endpointOwner) {
    // 192.168 多是车内/设备局域网的固定拓扑（ThorB、ECU），不算泄露，只提醒；办公网/tailnet 地址必须改掉
    const lan = ip[0].startsWith('192.168.');
    issues.push(['hardcoded-host', lan ? 'info' : 'warn', lan
      ? `正文里有设备局域网地址 ${ip[0]}：如果是固定硬件拓扑可以保留，最好收进该平台的事实/端点技能统一维护`
      : `正文里有内网地址 ${ip[0]}：改成环境变量并在「端点」一节说明；默认值只放在该端点的唯一来源技能里`]);
  }
  const home = body.match(HOME_PATH);
  if (home) issues.push(['personal-path', 'warn', `正文里有个人路径 ${home[0]}…：改成 $HOME/… 或项目变量（如 $VOYAGER_ROOT），在开头说明变量含义`]);
  const secret = body.match(SECRET_ASSIGN);
  if (secret) issues.push(['secret-literal', 'warn', `正文里像是写了凭据明文（${secret[0].split('=')[0].trim()}=…）：只写变量名，值放 ~/.comate/secrets/creds.env`]);
  return issues;
}

// 检查一个技能：[{ code, level: warn | info, msg }]。entry 默认取库里的分析结果，也可以传入待审内容的分析
// previous：同一技能上一个已发布版本的分析结果（推送更新、ash lint 本地目录时由 lintFor 给出），用来检查契约改动
function lintSkill(analysis, entry, { username = null, previous = null } = {}) {
  const issues = [];
  const add = (code, level, msg) => issues.push({ code, level, msg });
  // frontmatter 解析失败时 name / description / depends_on 全部丢失，Agent 框架也读不到——最先修
  if (entry.frontmatterError) add('frontmatter', 'warn', `frontmatter 解析失败（含「: 」的值要用引号括起来）：${entry.frontmatterError.split('\n')[0]}`);
  // Agent 框架能不能加载、会不会调用它（Agent Skills 规范与 Claude Code 的约束）
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.slug) || entry.slug.length > 64) {
    add('spec-name', 'warn', `标识 ${entry.slug} 不符合 Agent Skills 规范（只能用小写字母、数字和单个连字符，最长 64 个字符）：严格按规范的客户端可能不加载它`);
  }
  if (!entry.frontmatterError && entry.frontmatterName && entry.frontmatterName !== entry.slug) {
    add('name-mismatch', 'warn', `frontmatter 的 name（${entry.frontmatterName}）与标识 ${entry.slug} 不一致：规范要求 name 与目录名相同，Claude Code 以 name 作为技能名，别的技能按 ${entry.slug} 引用它时会对不上`);
  }
  if (!entry.description.trim()) add('no-description', 'warn', '缺少 description：Agent 框架靠它决定什么时候调用这个技能，缺了几乎不会被自动触发');
  else if (entry.description.length > 1024) add('description-length', 'warn', `description 有 ${entry.description.length} 个字符，超过规范上限 1024：Claude Code 在技能列表里只保留前 1536 个字符，写在后面的触发条件 Agent 看不到`);
  if (entry.disableModelInvocation) {
    const callers = (analysis.dependents.get(entry.slug) || []).filter((s) => s !== entry.slug);
    if (callers.length) add('not-invocable', 'warn', `被 ${callers.join('、')} 引用，但设置了 disable-model-invocation: true：Claude 不能调用它，引用它的技能走不通`);
  }
  entry.missingLanguages.forEach((lang) => add('bilingual', 'warn', LANGUAGE_HINT[lang]));
  for (const issue of conventionIssues(entry)) add(...issue);

  const declaredLocal = new Set();
  for (const raw of entry.invalid) add('invalid-ref', 'warn', `depends_on 里的「${raw}」写法不对：应为 slug、@账号/slug 或 slug@版本`);
  for (const ref of entry.declared) {
    if (!isLocal(ref, username)) {
      add('foreign-ref', 'info', `${ref.raw} 指向其他账号：团队库 / 技能广场上线前还不能跨账号安装`);
      continue;
    }
    declaredLocal.add(ref.slug);
    const target = analysis.bySlug.get(ref.slug);
    if (target?.disableModelInvocation) add('ref-not-invocable', 'warn', `引用的 ${ref.slug} 设置了 disable-model-invocation: true：Claude Code 里调用不到它（仍可读 ../${ref.slug}/SKILL.md）`);
    if (!target) {
      const moved = movedTo(analysis, ref.slug);
      add('missing-ref', 'warn', moved ? `引用的 ${ref.slug} 已改名为 ${moved}：depends_on 和正文都改成新名字` : `引用的 ${ref.slug} 不在库里（或已删除）：ash pull 装不上它`);
    } else if (target.status === 'pending') add('pending-ref', 'info', `引用的 ${ref.slug} 还在待审核：采纳前别的机器装不上它`);
    else if (ref.pin && target.version && ref.pin !== target.version) {
      if (pinAvailable(analysis, ref)) add('pin-old', 'info', `固定在 ${ref.slug}@${ref.pin}（历史版本，ash pull 会装那一版），库里当前是 ${target.version}：确认新版适用后可以改掉固定`);
      else add('pin-missing', 'warn', `固定在 ${ref.slug}@${ref.pin}，但库里没有这个版本（当前是 ${target.version}）：ash pull 会失败`);
    }
  }
  for (const slug of entry.inBody) {
    if (declaredLocal.has(slug) || !analysis.bySlug.has(slug)) continue;
    add('undeclared-ref', 'warn', `正文引用了 ${slug}，但 depends_on 没有声明：ash pull 不会一并装上它，本地 Agent 可能找不到`);
  }
  for (const path of entry.absolute) add('absolute-link', 'warn', `链接 ${path} 用了绝对路径：换一台机器或换一个 Agent 就找不到，请写成相对路径 ../<slug>/SKILL.md`);
  // 链接到别的技能里的文件（references/、scripts/）：技能和文件都要在
  for (const { slug, path } of entry.fileLinks) {
    const target = analysis.bySlug.get(slug);
    if (!target) {
      // ../xodr/map.xodr 这类指向数据目录的相对路径不是技能：只有技能目录结构（references/、scripts/）才算指向技能
      if (!/^(references|scripts)\//.test(path)) continue;
      const moved = movedTo(analysis, slug);
      add('broken-link', 'warn', `链接 ../${slug}/${path} 指向的技能不在库里${moved ? `：它已改名为 ${moved}` : ''}`);
    } else if (target.filePaths && !target.filePaths.has(path) && ![...target.filePaths].some((f) => f.startsWith(`${path}/`))) {
      add('broken-link', 'warn', `链接 ../${slug}/${path} 指向的文件在 ${slug} 里不存在：Agent 打开会失败（ash info ${slug} 查看它现在的文件清单）`);
    }
  }
  // 「交给 X」写的是路由：X 不存在时模型会把任务交给一个找不到的技能
  for (const [where, text, level] of [['description', entry.description, 'warn'], ['正文', stripFences(entry.body || ''), 'info']]) {
    for (const slug of handoffTargets(text)) {
      if (slug === entry.slug || analysis.bySlug.has(slug)) continue;
      const moved = movedTo(analysis, slug);
      add('handoff-missing', level, `${where}里「交给 ${slug}」指向的技能不在库里${moved
        ? `：它已改名为 ${moved}，改成新名字`
        : '：名字写错了，或技能已删除；改成库里现有的 slug，库外的技能注明「不在本库」'}`);
    }
  }

  if (analysis.bySlug.get(entry.slug) === entry) {
    const { longest, cycle } = chainFrom(analysis, entry.slug);
    if (cycle) add('cycle', 'warn', `引用成环：${cycle.join(' → ')}`);
    else if (longest.length - 1 > MAX_CHAIN) {
      add('deep-chain', 'info', `元技能引用链有 ${longest.length - 1} 层（${longest.join(' → ')}）：每多一层元技能，Agent 就要多读一个文件、多一个可能断的地方；考虑把中间层的内容收进调用方，或把下层的确定性步骤做成脚本`);
    }
  }

  effectIssues(analysis, entry, add);
  if (previous && previous !== entry) contractChangeIssues(analysis, entry, previous, add);

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

  for (const { others, commands, kind } of sharedStepsOf(analysis, entry)) {
    const metaOthers = others.filter((o) => o.meta);
    const size = `${commands.length} ${UNIT[kind]}`;
    if (!entry.meta && metaOthers.length) {
      const m = metaOthers[0].slug;
      add('copies-meta', 'warn', `有 ${size}与元技能 ${m} 相同：引用它（depends_on 加上 ${m}，正文写「用元技能 \`${m}\`」+ 本技能特有的参数），不要抄它的步骤`);
    } else if (!metaOthers.length && others.length + 1 >= EXTRACT_MIN) {
      add('extract-candidate', 'info', `有 ${size}与 ${others.map((o) => o.slug).join('、')} 相同：已有 ${others.length + 1} 个技能在重复这段操作，可以考虑提炼为元技能`);
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
        add(e.id, { code: 'copies_meta', label: '抄了元技能步骤', detail: `有 ${run.commands.length} ${UNIT[run.kind]}与元技能 ${metas[0].slug} 相同，应改为引用它` });
      }
    } else if (members.length >= EXTRACT_MIN) {
      for (const e of members) {
        add(e.id, { code: 'extractable', label: '可提炼元技能', detail: `与 ${members.filter((m) => m !== e).map((m) => m.slug).join('、')} 有 ${run.commands.length} ${UNIT[run.kind]}相同` });
      }
    }
  }
  return flags;
}

// ——— 按用户缓存（挂在相关度索引上，库一变化就重算）———
// 延迟加载：上面的纯函数不依赖数据库，单元测试可以直接用
function libraryAnalysis(userId) {
  return require('./skillIndex').libraryCache(userId, 'refs', (skills) => {
    const analysis = analyzeLibrary(skills);
    const rows = require('./db').prepare(`
      SELECT s.slug, v.version FROM skill_versions v JOIN skills s ON s.id = v.skill_id
      WHERE s.user_id = ? AND s.is_deleted = 0 AND v.version IS NOT NULL
    `).all(userId);
    analysis.historyVersions = new Map();
    for (const { slug, version } of rows) {
      if (!analysis.historyVersions.has(slug)) analysis.historyVersions.set(slug, new Set());
      analysis.historyVersions.get(slug).add(String(version));
    }
    // 改名去向：引用了旧名字时提示改成哪个新名字
    analysis.redirects = new Map(require('./db').prepare('SELECT old_slug, new_slug FROM skill_redirects WHERE user_id = ?')
      .all(userId).map((r) => [r.old_slug, r.new_slug]));
    return analysis;
  });
}

// 某个技能的分析：默认取库里那份；传入 content（例如待审更新、刚推送还没进库的内容）时按这份内容分析
function entryFor(userId, skill, content) {
  const analysis = libraryAnalysis(userId);
  const inLibrary = analysis.bySlug.get(skill.slug);
  const entry = content === undefined && inLibrary ? inLibrary : analyzeSkill({ ...skill, content: content ?? skill.content }, analysis.library);
  return { analysis, entry };
}

// previous：上一版的 SKILL.md 全文（直接发布的更新，库里已经是新内容时由调用方传入）；
// 不传时，检查待审内容就和库里已发布的那份比
function lintFor(userId, skill, { username = null, content, previous } = {}) {
  const { analysis, entry } = entryFor(userId, skill, content);
  const inLibrary = analysis.bySlug.get(skill.slug);
  let before = null;
  if (previous !== undefined && previous !== null) before = analyzeSkill({ ...skill, content: previous, version: null }, analysis.library);
  else if (inLibrary && inLibrary !== entry) before = inLibrary;
  return lintSkill(analysis, entry, { username, previous: before });
}

module.exports = {
  analyzeLibrary, analyzeSkill, lintSkill, sharedStepsOf, chainFrom, isMetaSkill, isLocal, bodyReferences, structuralFlags,
  libraryAnalysis, entryFor, lintFor, splitBody, pinAvailable, contractRows, EXTRACT_MIN,
};
