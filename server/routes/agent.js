// Agent 接口分两组挂载：
//   router → /s          只读：Markdown、信息、附属文件、历史版本、安装脚本、归档
//   api    → /api/agent  推送与跟进：push、revisions（已装技能比对）、mine（我的推送）、withdraw（撤回待审）
const express = require('express');
const router = express.Router();
const api = express.Router();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const multer = require('multer');
const db = require('../db');
const { replaceSkillOnDisk, removeSkillFromDisk, skillDirExists, cleanFolderPath, createSkillArchive, createSkillTarGzArchive, getSkillFileTree, getSkillFileContent } = require('../storage');
const { normalizeSkillMeta, dependenciesOf } = require('../skillMeta');
const { findBundle, bundleMembers } = require('../bundleLookup');
const { scanSkill, hasHighRisk } = require('../security');
const { reviewRequired, parseJson, snapshotSkillVersion, isVisibleToAgents, skillRevision } = require('../review');
const { shQuote, getBaseUrl, curlPipeCommand, SCRIPT_TOKEN_PRELUDE } = require('../shell');
const { render } = require('../templates');

const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } });

const INSTALL_AGENTS = ['auto', 'hermes', 'codex', 'claude', 'dsh'];
const truthy = (value) => ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
const wantsText = (req) => req.query.format === 'text' || req.body?.format === 'text';

// 只在请求者（token / 会话所属用户）自己的库里找
function findSkill(userId, slug) {
  return db.prepare('SELECT * FROM skills WHERE user_id = ? AND slug = ?').get(userId, slug);
}

// 安装脚本里的错误也必须是合法脚本：curl | bash 时给出原因并以非零退出
function scriptError(res, status, message) {
  res.status(status).type('text/plain').send(`#!/usr/bin/env bash\necho ${shQuote(`错误: ${message}`)} >&2\nexit 1\n`);
}

// Agent 侧读取时，不可见的技能给出可操作的原因
function agentLookup(req) {
  const skill = findSkill(req.user.id, req.params.slug.replace(/\.md$/, ''));
  if (!skill || skill.is_deleted) return { error: [404, `技能 ${req.params.slug} 不存在或已删除（ash search <关键词> 查找）`] };
  if (!isVisibleToAgents(skill, { allowPending: truthy(req.query.pending) })) {
    return { error: [404, `技能 ${skill.slug} 正在等待人工审核，采纳后才能拉取；推送者自用请加 --pending（HTTP: ?pending=1）`] };
  }
  return { skill };
}

// 技能组合一键安装：/s/bundle/:ref/install.sh —— ref 可为标识或名称（URL 编码），依次安装全部已发布技能
router.get('/bundle/:slug/install.sh', (req, res) => {
  const { bundle, error } = findBundle(req.user.id, req.params.slug);
  if (!bundle) return scriptError(res, 404, error);
  const items = bundleMembers(bundle.id, bundle.user_id);
  const ready = items.filter((it) => it.status !== 'pending');
  const skipped = items.filter((it) => it.status === 'pending');
  if (!ready.length) return scriptError(res, 400, `技能组合 ${bundle.name} 中没有可安装的技能`);

  const sub = new URLSearchParams();
  if (INSTALL_AGENTS.includes(req.query.agent)) sub.set('agent', req.query.agent);
  if (typeof req.query.dir === 'string' && req.query.dir) sub.set('dir', req.query.dir);
  if (truthy(req.query.force)) sub.set('force', '1');
  if (truthy(req.query.nodeps)) sub.set('nodeps', '1');
  const query = sub.toString() ? `?${sub}` : '';
  const lines = [
    '#!/usr/bin/env bash',
    '# AnotherSkillHub 技能组合安装脚本（由服务端生成）',
    'set -euo pipefail',
    `BASE_URL=${shQuote(getBaseUrl(req))}`,
    SCRIPT_TOKEN_PRELUDE,
    `echo ${shQuote(`📦 技能组合 [${bundle.name}]：共 ${ready.length} 个技能`)}`,
    ...skipped.map((it) => `echo ${shQuote(`⏭  跳过待审核技能 ${it.name} (${it.slug})`)}`),
    ...ready.flatMap((it, i) => [
      `echo ${shQuote(`--- [${i + 1}/${ready.length}] ${it.name} (${it.slug})`)}`,
      `curl -fsSL -H "Authorization: Bearer $ASH_TOKEN" "$BASE_URL"${shQuote(`/s/${it.slug}/install.sh${query}`)} | bash`,
    ]),
    `echo ${shQuote(`✅ 技能组合 [${bundle.name}] 安装完毕`)}`,
  ];
  res.type('text/plain').send(`${lines.join('\n')}\n`);
});

// 纯文本技能信息：ash info <slug>
router.get('/:slug/info', (req, res) => {
  const { skill, error } = agentLookup(req);
  if (error) return res.status(error[0]).type('text/plain').send(`错误: ${error[1]}\n`);
  const base = getBaseUrl(req);
  const tags = parseJson(skill.tags, []);
  const files = getSkillFileTree(skill.user_id, skill.folder_path, skill.slug).map((f) => f.path).sort();
  const warnings = parseJson(skill.security_warnings, []);
  const deps = dependenciesOf(skill.content);
  const missing = deps.filter((d) => !isVisibleToAgents(findSkill(skill.user_id, d)));
  const out = [
    `${skill.name} (${skill.slug})`,
    skill.description ? `描述: ${skill.description}` : '描述: （无）',
    `状态: ${skill.status === 'pending' ? '待审核' : '已发布'}${skill.pending_content ? '（有待审核的更新）' : ''} · 版本 ${skill.version} · 更新于 ${skill.updated_at}`,
    `目录: ${skill.folder_path}${tags.length ? ` · 标签: ${tags.join(', ')}` : ''} · 修订 ${skillRevision(skill)}`,
    ...(deps.length ? [`依赖: ${deps.join(', ')}${missing.length ? `（库中缺失或未发布: ${missing.join(', ')}）` : ''}  —— ash pull 会一并安装`] : []),
    `文件 (${files.length}):`,
    ...files.map((f) => `  ${f}`),
    ...warnings.map((w) => `⚠️  ${w.msg}`),
    `阅读: ash show ${skill.slug}    (${base}/s/${skill.slug}.md)`,
    `安装: ash pull ${skill.slug}    (${curlPipeCommand(`${base}/s/${skill.slug}/install.sh`)})`,
    `历史: ash versions ${skill.slug}`,
  ];
  res.type('text/plain').send(`${out.join('\n')}\n`);
});

// 历史版本（纯文本）：ash versions <slug>；内容用 /s/<slug>.md?version=<id> 读取
router.get('/:slug/versions', (req, res) => {
  const { skill, error } = agentLookup(req);
  if (error) return res.status(error[0]).type('text/plain').send(`错误: ${error[1]}\n`);
  const rows = db.prepare(`
    SELECT id, source, label, created_at, LENGTH(content) AS size FROM skill_versions
    WHERE skill_id = ? ORDER BY created_at DESC, id DESC
  `).all(skill.id);
  const sourceLabel = { web: '网页编辑前', agent: 'Agent 更新前', 'restore-backup': '恢复前备份' };
  const lines = rows.map((v) => `${v.id}  ·  ${v.created_at} UTC  ·  ${sourceLabel[v.source] || v.source}  ·  ${Math.max(1, Math.round(v.size / 1024))} KB${v.label ? `  ·  ${v.label}` : ''}`);
  const header = rows.length
    ? `${skill.slug} 共 ${rows.length} 个历史版本（快照是被替换掉的旧内容；ash show ${skill.slug} --version <id> 查看）`
    : `${skill.slug} 还没有历史版本`;
  res.type('text/plain').send(`${[header, ...lines].join('\n')}\n`);
});

// 单个附属文件：/s/:slug/files/<相对路径>
router.get('/:slug/files/*filepath', (req, res) => {
  const { skill, error } = agentLookup(req);
  if (error) return res.status(error[0]).type('text/plain').send(`错误: ${error[1]}\n`);
  const rel = [].concat(req.params.filepath).join('/');
  const content = getSkillFileContent(skill.user_id, skill.folder_path, skill.slug, rel);
  if (content === null) return res.status(404).type('text/plain').send(`错误: 文件 ${rel} 不存在\n`);
  res.type('text/plain').send(content);
});

// 智能短链：/s/:slug 或 /s/:slug.md —— 默认返回 Markdown，只有浏览器（Accept: text/html）才跳转到管理界面。
// 跳转发生在鉴权之前（挂在 requireAuth 前面）：浏览器没有 token，由 /app 自己决定是否要先登录。
function browserRedirect(req, res, next) {
  const m = req.method === 'GET' && /^\/([^/]+)$/.exec(req.path);
  if (!m || m[1].endsWith('.md') || req.query.format === 'md') return next();
  // 浏览器的 Accept 首选 text/html；curl 的 */*、Agent 抓取器的 text/markdown 都会落到 Markdown
  if (req.accepts(['text/markdown', 'text/html']) !== 'text/html') return next();
  let slug;
  try { slug = decodeURIComponent(m[1]); } catch { return next(); }
  return res.redirect(`/app?skill=${encodeURIComponent(slug)}`);
}

router.get('/:slug', (req, res) => {
  try {
    const { skill, error } = agentLookup(req);
    if (error) return res.status(error[0]).type('text/markdown').send(`# 错误\n\n${error[1]}\n`);
    res.type('text/markdown');

    if (req.query.version) {
      const ver = db.prepare('SELECT content FROM skill_versions WHERE id = ? AND skill_id = ?').get(req.query.version, skill.id);
      if (!ver) return res.status(404).send(`# 错误\n\n版本 ${req.query.version} 不存在\n`);
      return res.send(ver.content);
    }
    if (truthy(req.query.raw)) return res.send(skill.content);

    // 多文件技能：直接 fetch 只拿得到 SKILL.md，附上文件清单让 Agent 能取到脚本/参考资料
    const files = getSkillFileTree(skill.user_id, skill.folder_path, skill.slug).filter((f) => f.path !== 'SKILL.md').map((f) => f.path).sort();
    if (!files.length) return res.send(skill.content);
    const base = getBaseUrl(req);
    const manifest = [
      '',
      '',
      '---',
      '',
      '<!-- 以下由 AnotherSkillHub 附加，不属于 SKILL.md 原文（?raw=1 可获取原文） -->',
      '## 附属文件',
      '',
      `本技能包含 ${files.length} 个附属文件，正文中的相对路径指向它们。需要执行脚本时请完整安装：\`ash pull ${skill.slug}\`（或 \`${curlPipeCommand(`${base}/s/${skill.slug}/install.sh`)}\`）。`,
      '',
      ...files.map((f) => `- \`${f}\`：${base}/s/${skill.slug}/files/${f.split('/').map(encodeURIComponent).join('/')}`),
      '',
    ];
    return res.send(skill.content.replace(/\s*$/, '') + manifest.join('\n'));
  } catch (err) {
    res.status(500).type('text/markdown').send(`# 服务器错误\n\n${err.message}\n`);
  }
});

// 一键安装脚本：/s/:slug/install.sh
// 查询参数: agent=auto|hermes|codex|claude|dsh；dir=/path 自定义目录；pending=1 安装待审核技能
router.get('/:slug/install.sh', (req, res) => {
  try {
    const { skill, error } = agentLookup(req);
    if (error) return scriptError(res, error[0], error[1]);
    const agent = INSTALL_AGENTS.includes(req.query.agent) ? req.query.agent : 'auto';
    const dir = typeof req.query.dir === 'string' ? req.query.dir : '';
    // 依赖只收合法 slug；不存在/未发布的依赖由脚本安装时提示
    const deps = dependenciesOf(skill.content).filter((d) => /^[A-Za-z0-9_.-]+$/.test(d) && d !== skill.slug);
    const script = render('install.sh', {
      SLUG: shQuote(skill.slug),
      BASE_URL: shQuote(getBaseUrl(req)),
      AGENT: shQuote(agent),
      DIR: shQuote(dir),
      PENDING: truthy(req.query.pending) ? '1' : '0',
      FORCE: truthy(req.query.force) ? '1' : '0',
      NODEPS: truthy(req.query.nodeps) ? '1' : '0',
      REVISION: shQuote(skillRevision(skill)),
      VERSION: shQuote(skill.version || ''),
      DEPS: deps.map(shQuote).join(' '),
    });
    res.type('text/plain').send(script);
  } catch (err) {
    scriptError(res, 500, `服务器错误：${err.message}`);
  }
});

function sendArchive(req, res, kind) {
  const { skill, error } = agentLookup(req);
  if (error) return res.status(error[0]).type('text/plain').send(`错误: ${error[1]}\n`);
  if (!skillDirExists(skill.user_id, skill.folder_path, skill.slug)) return res.status(404).type('text/plain').send('错误: 技能文件缺失\n');
  if (kind === 'tar') {
    res.attachment(`${skill.slug}.tar.gz`);
    createSkillTarGzArchive(skill.user_id, skill.folder_path, skill.slug, res);
  } else {
    res.attachment(`${skill.slug}.zip`);
    createSkillArchive(skill.user_id, skill.folder_path, skill.slug, res);
  }
}

// 打包下载：tar.gz 供终端与 Agent 流式解压，zip 供浏览器下载
router.get('/:slug/archive.tar.gz', (req, res) => {
  try { sendArchive(req, res, 'tar'); } catch (err) { res.status(500).send('Error archiving skill: ' + err.message); }
});
router.get('/:slug/download', (req, res) => {
  try { sendArchive(req, res, 'zip'); } catch (err) { res.status(500).send('Error archiving skill: ' + err.message); }
});

// 解包技能归档（tar.gz/tgz）：返回 { content, files }——SKILL.md 为正文，其余为附属文件
// 扩展名白名单（可用环境变量 ASH_ALLOWED_EXTS 覆盖，逗号分隔）
const ALLOWED_EXTS = (process.env.ASH_ALLOWED_EXTS
  ? process.env.ASH_ALLOWED_EXTS.split(',').map((e) => e.trim().toLowerCase())
  : ['.md', '.json', '.yaml', '.yml', '.toml', '.txt', '.sh', '.bash', '.zsh', '.py', '.js', '.ts', '.mjs', '.cjs', '.css', '.html', '.xml', '.sql', '.ini', '.cfg', '.conf', '.csv', '.xsd', '.xsl', '.dtd', '.svg']);
const DENY_EXTS = ['.exe', '.dll', '.so', '.dylib', '.bin', '.img', '.iso', '.zip', '.tar.gz', '.tgz', '.7z', '.rar', '.pdf', '.doc', '.xls', '.ppt', '.key', '.pem', '.p12', '.env', '.git'];

function extAllowed(name) {
  const lower = name.toLowerCase();
  if (DENY_EXTS.some((e) => lower.endsWith(e))) return false;
  if (lower === 'dockerfile' || lower === 'makefile' || lower.startsWith('.')) return true; // 无扩展名常见配置文件
  return ALLOWED_EXTS.some((e) => lower.endsWith(e));
}

function extractSkillArchive(buffer) {
  const os = require('os');
  const MAX_TOTAL_TEXT = 4 * 1024 * 1024;   // 附属文本总量 4MB
  const MAX_FILES = 200;                     // 附属文件数上限
  const MAX_FILE = 512 * 1024;               // 单文件 512KB

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-archive-'));
  try {
    const tmpTar = path.join(tmpDir, 'skill.tgz');
    fs.writeFileSync(tmpTar, buffer);
    // 路径穿越防护：先列出成员校验再解包
    let listing = '';
    try {
      listing = execFileSync('tar', ['-tzf', tmpTar], { stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 }).toString();
    } catch {
      return { error: '归档损坏或不是有效的 tar.gz' };
    }
    const members = listing.split('\n').filter(Boolean);
    for (const m of members) {
      const norm = path.posix.normalize(m.replace(/\/$/, ''));
      if (norm === '..' || norm.startsWith('../') || path.posix.isAbsolute(norm)) {
        return { error: `归档包含非法路径: ${m}` };
      }
    }
    if (members.length > MAX_FILES + 50) {
      return { error: `归档文件数过多（${members.length} > ${MAX_FILES + 50}）` };
    }
    const extractDir = path.join(tmpDir, 'x');
    fs.mkdirSync(extractDir);
    execFileSync('tar', ['-xzf', tmpTar, '-C', extractDir, '--no-same-owner'], { stdio: 'pipe' });

    // 若解包后只有一个根目录（skill-name/），下钻一层
    let root = extractDir;
    const entries = fs.readdirSync(extractDir);
    if (entries.length === 1) {
      const only = path.join(extractDir, entries[0]);
      if (fs.lstatSync(only).isDirectory()) root = only;
    }

    // 找 SKILL.md（大小写兼容：SKILL.md / skill.md / Skill.md）
    const findSkillMd = (dir) => fs.readdirSync(dir).find((f) => f.toLowerCase() === 'skill.md' && fs.lstatSync(path.join(dir, f)).isFile());
    let skillMdPath = null;
    const rootHit = findSkillMd(root);
    if (rootHit) {
      skillMdPath = path.join(root, rootHit);
    } else {
      // 容错：一层子目录里的 skill.md（单根目录包装场景）
      for (const e of fs.readdirSync(root)) {
        const sub = path.join(root, e);
        if (fs.lstatSync(sub).isDirectory()) {
          const hit = findSkillMd(sub);
          if (hit) { skillMdPath = path.join(sub, hit); root = sub; break; }
        }
      }
    }
    if (!skillMdPath) return { error: '归档根目录（或唯一子目录）缺少 SKILL.md——技能必须以 SKILL.md 作为入口文件' };

    const content = fs.readFileSync(skillMdPath, 'utf8');

    // 收集附属文本文件；数量/总量超限即报错，单文件超限或非白名单跳过并提示
    const files = [];
    let totalBytes = 0;
    const skipped = [];
    const skippedType = [];
    (function walk(dir, rel) {
      for (const item of fs.readdirSync(dir).sort()) {
        if (item === '.git' || item === 'node_modules' || item === '__pycache__' || item === '.DS_Store' || item === '.ash' || item.startsWith('._')) continue;
        const full = path.join(dir, item);
        const relP = rel ? `${rel}/${item}` : item;
        const stat = fs.lstatSync(full);
        if (stat.isSymbolicLink()) { skippedType.push(`${relP} (符号链接)`); continue; }
        if (stat.isDirectory()) walk(full, relP);
        else if (relP.toLowerCase() !== 'skill.md') {
          if (files.length >= MAX_FILES) throw new Error(`附属文件数超过上限 ${MAX_FILES}`);
          if (!extAllowed(item)) { skippedType.push(relP); continue; }
          if (stat.size > MAX_FILE) { skipped.push(`${relP} (${Math.round(stat.size / 1024)}KB)`); continue; }
          totalBytes += stat.size;
          if (totalBytes > MAX_TOTAL_TEXT) throw new Error('附属文本总量超过上限 4MB');
          files.push({ path: relP, content: fs.readFileSync(full, 'utf8') });
        }
      }
    })(root, '');
    return { content, files, skipped, skippedType };
  } catch (e) {
    return { error: e.message };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// 推送时指定的目录：逐级补齐 folders 记录，拒绝 .. 与空段
function ensureFolderPath(userId, folderPath) {
  const clean = cleanFolderPath(folderPath || 'inbox');
  if (!clean) return null;
  const segments = clean.split('/');
  const insert = db.prepare('INSERT OR IGNORE INTO folders (user_id, path, name, parent_path) VALUES (?, ?, ?, ?)');
  segments.forEach((segment, i) => insert.run(userId, segments.slice(0, i + 1).join('/'), segment, segments.slice(0, i).join('/')));
  return clean;
}

const sameFiles = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

function pushSummaryText(r) {
  const head = {
    created: r.status === 'pending'
      ? `✅ 已创建技能 ${r.slug}（待审核：人工采纳后其他 Agent 才能拉取）`
      : `✅ 已创建并发布技能 ${r.slug}`,
    updated: r.status === 'pending'
      ? `✅ 已更新待审核技能 ${r.slug}（仍需人工采纳）`
      : `✅ 已更新并发布技能 ${r.slug}（旧版本已存入历史）`,
    'update-pending': `✅ 已提交 ${r.slug} 的更新（待审核：采纳前其他 Agent 仍拉取当前版本）`,
    unchanged: `= ${r.slug} 内容无变化，未做修改`,
  }[r.action];
  const lines = [head, `   地址: ${r.url}`, `   附属文件: ${r.files} 个`];
  if (r.status === 'pending') lines.push(`   自用: ash pull ${r.slug} --pending`);
  (r.security_warnings || []).forEach((w) => lines.push(`⚠️  安全提醒: ${w.msg}${w.level === 'high' ? '（高危，已强制人工审核）' : ''}`));
  (r.notices || []).forEach((n) => lines.push(`ℹ️  ${n}`));
  return `${lines.join('\n')}\n`;
}

// Agent 一键 Push 上传端点（支持 JSON、单文件 FormData、归档 tar.gz 上传）
// 同名 slug 已存在时必须显式 update=1；推送结果默认需要人工审核后才对其他 Agent 可见
api.post('/push', upload.single('file'), (req, res) => {
  const asText = wantsText(req);
  const fail = (status, message, extra = {}) => (asText
    ? res.status(status).type('text/plain').send(`错误: ${message}\n`)
    : res.status(status).json({ error: message, ...extra }));
  try {
    const body = req.body || {};
    const terminalSource = body.terminal || body.terminal_source || 'Agent-CLI';
    let content = '';
    let fileName = '';
    let archiveFiles = [];
    const notices = [];
    if (req.file && /\.(tar\.gz|tgz)$/i.test(req.file.originalname)) {
      const extracted = extractSkillArchive(req.file.buffer);
      if (!extracted || extracted.error) return fail(400, (extracted && extracted.error) || '归档解析失败');
      content = extracted.content;
      archiveFiles = extracted.files;
      if (extracted.skipped.length) notices.push(`已跳过超限文件（>512KB）: ${extracted.skipped.join(', ')}`);
      if (extracted.skippedType.length) notices.push(`已跳过非白名单类型文件: ${extracted.skippedType.join(', ')}`);
    } else if (req.file) {
      if (/\.zip$/i.test(req.file.originalname)) return fail(400, '暂不支持 zip，请上传 tar.gz 归档或直接推送目录（ash push <目录>）');
      content = req.file.buffer.toString('utf8');
      fileName = req.file.originalname;
    } else if (body.content) {
      content = String(body.content);
    }
    if (!content.trim()) return fail(400, '缺少技能内容：请上传 SKILL.md、技能目录归档，或提供 content 字段');

    const meta = normalizeSkillMeta(content, { slug: body.slug, name: body.name, description: body.description, tags: body.tags }, { fileName });
    if (meta.errors.length) return fail(400, meta.errors.join('；'));
    notices.push(...meta.warnings);
    const securityWarnings = scanSkill(content, archiveFiles);
    const needsReview = reviewRequired() || hasHighRisk(securityWarnings);
    const slug = meta.slug;
    const uid = req.user.id;
    const existing = findSkill(uid, slug);
    const base = getBaseUrl(req);

    let result;
    if (existing) {
      if (existing.is_deleted) return fail(409, `标识符 ${slug} 属于废纸篓中的技能，请先在网页上恢复或彻底删除`, { slug });
      if (!truthy(body.update)) {
        return fail(409, `技能 ${slug} 已存在（目录 ${existing.folder_path}）。确认是在更新它请加 --update（HTTP: update=1）；如果是另一个技能，请在 frontmatter 换一个 name`, { slug, folder_path: existing.folder_path });
      }
      const common = { slug, folder_path: existing.folder_path, name: existing.name };
      const currentFiles = parseJson(existing.files, []);
      const isPending = existing.status === 'pending';
      const baseline = !isPending && existing.pending_content != null
        ? { content: existing.pending_content, files: parseJson(existing.pending_files, []) }
        : { content: existing.content, files: currentFiles };
      if (baseline.content === content && sameFiles(baseline.files, archiveFiles)) {
        result = { ...common, action: 'unchanged', status: existing.status };
      } else if (isPending || !needsReview) {
        // 从未发布过的待审技能直接原地更新；关闭审核时直接发布。名称/标签/目录保留人工维护的值
        snapshotSkillVersion(existing, 'agent');
        db.prepare(`
          UPDATE skills SET content = ?, files = ?, description = ?, version = ?, terminal_source = ?, security_warnings = ?,
            status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(content, JSON.stringify(archiveFiles), meta.description || existing.description,
          meta.frontmatter.version ? meta.version : existing.version, terminalSource, JSON.stringify(securityWarnings),
          isPending ? 'pending' : 'approved', existing.id);
        replaceSkillOnDisk(uid, existing.folder_path, slug, content, archiveFiles);
        result = { ...common, action: 'updated', status: isPending ? 'pending' : 'approved' };
      } else {
        db.prepare(`
          UPDATE skills SET pending_content = ?, pending_files = ?, pending_meta = ?, pending_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(content, JSON.stringify(archiveFiles), JSON.stringify({
          description: meta.description, version: meta.frontmatter.version ? meta.version : null,
          terminal_source: terminalSource, security_warnings: securityWarnings,
        }), existing.id);
        result = { ...common, action: 'update-pending', status: 'approved' };
      }
    } else {
      const folderPath = ensureFolderPath(uid, body.folder || body.folder_path || 'inbox');
      if (!folderPath) return fail(400, `非法的目录: ${body.folder || body.folder_path}`);
      const status = needsReview ? 'pending' : 'approved';
      db.prepare(`
        INSERT INTO skills (user_id, slug, name, description, folder_path, tags, content, files, terminal_source, version, status, security_warnings)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(uid, slug, meta.name, meta.description, folderPath, JSON.stringify(meta.tags), content, JSON.stringify(archiveFiles),
        terminalSource, meta.version, status, JSON.stringify(securityWarnings));
      replaceSkillOnDisk(uid, folderPath, slug, content, archiveFiles);
      result = { slug, name: meta.name, folder_path: folderPath, action: 'created', status };
    }

    const payload = {
      success: true,
      ...result,
      review_required: result.status === 'pending' || result.action === 'update-pending',
      files: archiveFiles.length,
      security_warnings: securityWarnings,
      notices,
      // 兼容旧版 CLI：合并成一行提示
      warning: [...securityWarnings.map((w) => `⚠️ 安全提醒: ${w.msg}`), ...notices].join(' | ') || undefined,
      url: `${base}/s/${slug}`,
      install_cmd: curlPipeCommand(`${base}/s/${slug}/install.sh`),
    };
    const status = result.action === 'created' ? 201 : 200;
    return asText ? res.status(status).type('text/plain').send(pushSummaryText(payload)) : res.status(status).json(payload);
  } catch (err) {
    return fail(500, err.message);
  }
});

// 已装技能比对：GET /api/agent/revisions?slug=a&slug=b → 每行 slug<TAB>状态<TAB>修订<TAB>版本
// 状态: published | pending | trashed | missing
api.get('/revisions', (req, res) => {
  const slugs = [].concat(req.query.slug || []).map(String).filter(Boolean).slice(0, 500);
  const lines = slugs.map((slug) => {
    const skill = findSkill(req.user.id, slug);
    if (!skill) return `${slug}\tmissing\t-\t-`;
    if (skill.is_deleted) return `${slug}\ttrashed\t-\t-`;
    return `${slug}\t${skill.status === 'pending' ? 'pending' : 'published'}\t${skillRevision(skill)}\t${skill.version || '-'}`;
  });
  res.type('text/plain').send(lines.length ? `${lines.join('\n')}\n` : '');
});

const REVIEW_TEXT = {
  approved: { new: '已通过', update: '更新已采纳' },
  rejected: { new: '已拒绝（在废纸篓）', update: '更新被拒绝' },
};

// 我的推送：按推送时记录的来源终端（hostname）列出状态，ash mine
api.get('/mine', (req, res) => {
  const terminal = String(req.query.terminal || '').trim();
  if (!terminal) return res.status(400).type('text/plain').send('错误: 缺少 terminal 参数\n');
  const rows = db.prepare(`
    SELECT slug, name, status, is_deleted, pending_content IS NOT NULL AS has_pending, pending_at, last_review, updated_at, terminal_source, pending_meta
    FROM skills
    WHERE user_id = ? AND (terminal_source = ? OR json_extract(pending_meta, '$.terminal_source') = ? OR json_extract(last_review, '$.source') = ?)
    ORDER BY COALESCE(pending_at, updated_at) DESC
  `).all(req.user.id, terminal, terminal, terminal);
  if (!rows.length) return res.type('text/plain').send(`没有来自 ${terminal} 的推送记录\n`);
  const lines = rows.map((r) => {
    const review = parseJson(r.last_review, null);
    let state;
    if (r.is_deleted) state = review?.action === 'rejected' ? '已拒绝（在废纸篓）' : '已删除';
    else if (r.status === 'pending') state = '新技能待审核（可 ash withdraw 撤回）';
    else if (r.has_pending) state = `更新待审核，提交于 ${r.pending_at} UTC（可 ash withdraw 撤回）`;
    else if (review) state = `${REVIEW_TEXT[review.action]?.[review.kind] || review.action}（${review.at.slice(0, 16).replace('T', ' ')} UTC）`;
    else state = '已发布';
    return `${r.slug}  ·  ${r.name}  ·  ${state}`;
  });
  res.type('text/plain').send(`${[`来自 ${terminal} 的推送（${rows.length} 个）`, ...lines].join('\n')}\n`);
});

// 撤回自己的待审推送：新技能直接删除（从未发布过），待审更新丢弃。只认推送时记录的来源终端
api.post('/withdraw', (req, res) => {
  const slug = String(req.body?.slug || '').trim();
  const terminal = String(req.body?.terminal || '').trim();
  const fail = (status, message) => res.status(status).type('text/plain').send(`错误: ${message}\n`);
  const skill = findSkill(req.user.id, slug);
  if (!skill || skill.is_deleted) return fail(404, `技能 ${slug} 不存在`);
  if (skill.status === 'pending') {
    if (skill.terminal_source !== terminal) return fail(403, `${slug} 不是由 ${terminal} 推送的，不能撤回`);
    db.transaction(() => {
      db.prepare('DELETE FROM bundle_items WHERE skill_id = ?').run(skill.id);
      db.prepare('DELETE FROM skill_versions WHERE skill_id = ?').run(skill.id);
      db.prepare('DELETE FROM skills WHERE id = ?').run(skill.id);
    })();
    removeSkillFromDisk(skill.user_id, skill.folder_path, skill.slug);
    return res.type('text/plain').send(`✅ 已撤回待审核的新技能 ${slug}\n`);
  }
  if (skill.pending_content != null) {
    const meta = parseJson(skill.pending_meta, {});
    if (meta.terminal_source !== terminal) return fail(403, `${slug} 的待审更新不是由 ${terminal} 提交的，不能撤回`);
    db.prepare('UPDATE skills SET pending_content = NULL, pending_files = NULL, pending_meta = NULL, pending_at = NULL WHERE id = ?').run(skill.id);
    return res.type('text/plain').send(`✅ 已撤回 ${slug} 的待审更新，当前发布版本不变\n`);
  }
  return fail(400, `${slug} 没有待审核的内容，已发布的技能不能撤回`);
});

module.exports = { publicRouter: router, apiRouter: api, browserRedirect };
