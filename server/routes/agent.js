const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const multer = require('multer');
const db = require('../db');
const { replaceSkillOnDisk, skillDirExists, createSkillArchive, createSkillTarGzArchive, getSkillFileTree, getSkillFileContent } = require('../storage');
const { normalizeSkillMeta } = require('../skillMeta');
const { scanSkill, hasHighRisk } = require('../security');
const { reviewRequired, parseJson, snapshotSkillVersion, isVisibleToAgents } = require('../review');
const { shQuote, getBaseUrl } = require('../shell');
const { render } = require('../templates');

const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } });

const INSTALL_AGENTS = ['auto', 'hermes', 'codex', 'claude', 'dsh'];
const truthy = (value) => ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
const wantsText = (req) => req.query.format === 'text' || req.body?.format === 'text';

function findSkill(slug) {
  return db.prepare('SELECT * FROM skills WHERE slug = ?').get(slug);
}

// 安装脚本里的错误也必须是合法脚本：curl | bash 时给出原因并以非零退出
function scriptError(res, status, message) {
  res.status(status).type('text/plain').send(`#!/usr/bin/env bash\necho ${shQuote(`错误: ${message}`)} >&2\nexit 1\n`);
}

// Agent 侧读取时，不可见的技能给出可操作的原因
function agentLookup(req) {
  const skill = findSkill(req.params.slug.replace(/\.md$/, ''));
  if (!skill || skill.is_deleted) return { error: [404, `技能 ${req.params.slug} 不存在或已删除（ash search <关键词> 查找）`] };
  if (!isVisibleToAgents(skill, { allowPending: truthy(req.query.pending) })) {
    return { error: [404, `技能 ${skill.slug} 正在等待人工审核，采纳后才能拉取；推送者自用请加 --pending（HTTP: ?pending=1）`] };
  }
  return { skill };
}

// 技能组合一键安装：/s/bundle/:slug/install.sh —— 依次安装组合内全部已发布技能
router.get('/bundle/:slug/install.sh', (req, res) => {
  const bundle = db.prepare('SELECT * FROM bundles WHERE slug = ?').get(req.params.slug);
  if (!bundle) return scriptError(res, 404, `技能组合 ${req.params.slug} 不存在`);
  const items = db.prepare(`
    SELECT s.slug, s.name, s.status FROM bundle_items bi JOIN skills s ON s.id = bi.skill_id
    WHERE bi.bundle_id = ? AND s.is_deleted = 0 ORDER BY bi.added_at DESC
  `).all(bundle.id);
  const ready = items.filter((it) => it.status !== 'pending');
  const skipped = items.filter((it) => it.status === 'pending');
  if (!ready.length) return scriptError(res, 400, `技能组合 ${bundle.name} 中没有可安装的技能`);

  const sub = new URLSearchParams();
  if (INSTALL_AGENTS.includes(req.query.agent)) sub.set('agent', req.query.agent);
  if (typeof req.query.dir === 'string' && req.query.dir) sub.set('dir', req.query.dir);
  const query = sub.toString() ? `?${sub}` : '';
  const lines = [
    '#!/usr/bin/env bash',
    '# AnotherSkillHub 技能组合安装脚本（由服务端生成）',
    'set -euo pipefail',
    `BASE_URL=${shQuote(getBaseUrl(req))}`,
    `echo ${shQuote(`📦 技能组合 [${bundle.name}]：共 ${ready.length} 个技能`)}`,
    ...skipped.map((it) => `echo ${shQuote(`⏭  跳过待审核技能 ${it.name} (${it.slug})`)}`),
    ...ready.flatMap((it, i) => [
      `echo ${shQuote(`--- [${i + 1}/${ready.length}] ${it.name} (${it.slug})`)}`,
      `curl -fsSL "$BASE_URL"${shQuote(`/s/${it.slug}/install.sh${query}`)} | bash`,
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
  const files = getSkillFileTree(skill.folder_path, skill.slug).map((f) => f.path).sort();
  const warnings = parseJson(skill.security_warnings, []);
  const out = [
    `${skill.name} (${skill.slug})`,
    skill.description ? `描述: ${skill.description}` : '描述: （无）',
    `状态: ${skill.status === 'pending' ? '待审核' : '已发布'}${skill.pending_content ? '（有待审核的更新）' : ''} · 版本 ${skill.version} · 更新于 ${skill.updated_at}`,
    `目录: ${skill.folder_path}${tags.length ? ` · 标签: ${tags.join(', ')}` : ''}`,
    `文件 (${files.length}):`,
    ...files.map((f) => `  ${f}`),
    ...warnings.map((w) => `⚠️  ${w.msg}`),
    `阅读: ash show ${skill.slug}    (${base}/s/${skill.slug}.md)`,
    `安装: ash pull ${skill.slug}    (curl -fsSL ${base}/s/${skill.slug}/install.sh | bash)`,
  ];
  res.type('text/plain').send(`${out.join('\n')}\n`);
});

// 单个附属文件：/s/:slug/files/<相对路径>
router.get('/:slug/files/*filepath', (req, res) => {
  const { skill, error } = agentLookup(req);
  if (error) return res.status(error[0]).type('text/plain').send(`错误: ${error[1]}\n`);
  const rel = [].concat(req.params.filepath).join('/');
  const content = getSkillFileContent(skill.folder_path, skill.slug, rel);
  if (content === null) return res.status(404).type('text/plain').send(`错误: 文件 ${rel} 不存在\n`);
  res.type('text/plain').send(content);
});

// 智能短链：/s/:slug 或 /s/:slug.md —— 默认返回 Markdown，只有浏览器（Accept: text/html）才跳转到管理界面
router.get('/:slug', (req, res) => {
  try {
    const explicitMarkdown = req.params.slug.endsWith('.md');
    const slug = req.params.slug.replace(/\.md$/, '');
    // 浏览器的 Accept 首选 text/html；curl 的 */*、Agent 抓取器的 text/markdown 都会落到 Markdown
    const prefersHtml = req.accepts(['text/markdown', 'text/html']) === 'text/html';
    if (!explicitMarkdown && req.query.format !== 'md' && prefersHtml) {
      return res.redirect(`/?skill=${encodeURIComponent(slug)}`);
    }

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
    const files = getSkillFileTree(skill.folder_path, skill.slug).filter((f) => f.path !== 'SKILL.md').map((f) => f.path).sort();
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
      `本技能包含 ${files.length} 个附属文件，正文中的相对路径指向它们。需要执行脚本时请完整安装：\`ash pull ${skill.slug}\`（或 \`curl -fsSL ${base}/s/${skill.slug}/install.sh | bash\`）。`,
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
    const script = render('install.sh', {
      SLUG: shQuote(skill.slug),
      BASE_URL: shQuote(getBaseUrl(req)),
      AGENT: shQuote(agent),
      DIR: shQuote(dir),
      PENDING: truthy(req.query.pending) ? '1' : '0',
    });
    res.type('text/plain').send(script);
  } catch (err) {
    scriptError(res, 500, `服务器错误：${err.message}`);
  }
});

function sendArchive(req, res, kind) {
  const { skill, error } = agentLookup(req);
  if (error) return res.status(error[0]).type('text/plain').send(`错误: ${error[1]}\n`);
  if (!skillDirExists(skill.folder_path, skill.slug)) return res.status(404).type('text/plain').send('错误: 技能文件缺失\n');
  if (kind === 'tar') {
    res.attachment(`${skill.slug}.tar.gz`);
    createSkillTarGzArchive(skill.folder_path, skill.slug, res);
  } else {
    res.attachment(`${skill.slug}.zip`);
    createSkillArchive(skill.folder_path, skill.slug, res);
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
        if (item === '.git' || item === 'node_modules' || item === '__pycache__' || item === '.DS_Store' || item.startsWith('._')) continue;
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
function ensureFolderPath(folderPath) {
  const clean = String(folderPath || 'inbox').trim().replace(/^\/+|\/+$/g, '');
  const segments = clean.split('/');
  if (!clean || segments.some((s) => !s.trim() || s === '.' || s === '..')) return null;
  const insert = db.prepare('INSERT OR IGNORE INTO folders (path, name, parent_path) VALUES (?, ?, ?)');
  segments.forEach((segment, i) => insert.run(segments.slice(0, i + 1).join('/'), segment, segments.slice(0, i).join('/')));
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
router.post('/push', upload.single('file'), (req, res) => {
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
    const existing = findSkill(slug);
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
        replaceSkillOnDisk(existing.folder_path, slug, content, archiveFiles);
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
      const folderPath = ensureFolderPath(body.folder || body.folder_path || 'inbox');
      if (!folderPath) return fail(400, `非法的目录: ${body.folder || body.folder_path}`);
      const status = needsReview ? 'pending' : 'approved';
      db.prepare(`
        INSERT INTO skills (slug, name, description, folder_path, tags, content, files, terminal_source, version, status, security_warnings)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(slug, meta.name, meta.description, folderPath, JSON.stringify(meta.tags), content, JSON.stringify(archiveFiles),
        terminalSource, meta.version, status, JSON.stringify(securityWarnings));
      replaceSkillOnDisk(folderPath, slug, content, archiveFiles);
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
      install_cmd: `curl -fsSL ${base}/s/${slug}/install.sh | bash`,
    };
    const status = result.action === 'created' ? 201 : 200;
    return asText ? res.status(status).type('text/plain').send(pushSummaryText(payload)) : res.status(status).json(payload);
  } catch (err) {
    return fail(500, err.message);
  }
});

module.exports = router;
