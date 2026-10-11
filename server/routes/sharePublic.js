// 分享链接的免登录访问，分两组挂载：
//   page → /share       链接本身：浏览器打开是分享页（landing 入口渲染），curl / Agent 拿到 Markdown；
//                        另有 info（CLI 用）、install.sh、archive.tar.gz、download（zip）、files/*
//   api  → /api/share   分享页用的 JSON：内容、解锁密码、单个附属文件、存到我的库（这一项要登录）
// 密码分享在解锁前只回「需要密码」，不透露技能名等任何信息；无效 / 过期 / 停用统一 404
const express = require('express');
const db = require('../db');
const { verifyPassword, requireAuth, isRateLimited, recordFailure, clearFailures, authenticate } = require('../auth');
const { shQuote, getBaseUrl, AGENT_ROOTS_FN } = require('../shell');
const { render } = require('../templates');
const { createTarGzFromContent, createZipFromContent, saveSkillToDisk } = require('../storage');
const { slugify, INSTALL_FOOTER_MARK } = require('../skillMeta');
const { warningsFor } = require('../review');
const { recordEvent } = require('../usage');
const { findShare, issueAccess, accessOf, setAccessCookie, countAccess, shareUrl } = require('../shares');

const page = express.Router();
const api = express.Router();
// 分享出去的是别人写的内容：附属文件按纯文本给，禁止浏览器把它嗅探成 HTML 执行
for (const router of [page, api]) router.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

const NOT_FOUND = '链接不存在、已过期或已被停用';
const LOCKED = '这个分享需要密码';
const INSTALL_AGENTS = ['auto', 'hermes', 'codex', 'claude', 'dsh', 'all'];
const terminalOf = (req) => String(req.query.terminal || '').trim() || null;
const scriptError = (res, status, message) => res.status(status).type('text/plain').send(`#!/usr/bin/env bash\necho ${shQuote(`错误: ${message}`)} >&2\nexit 1\n`);
const encodePath = (rel) => rel.split('/').map(encodeURIComponent).join('/');
// 记到技能使用统计里的「终端」：分享来的访问统一标成 share，安装时再带上对方机器名
const shareTerminal = (req) => (terminalOf(req) ? `share:${terminalOf(req)}` : 'share');

// 找分享并检查访问权限：返回 { found, access } 或 { error: [status, message] }
function lookup(req) {
  const found = findShare(req.params.token);
  if (!found) return { error: [404, NOT_FOUND] };
  const access = accessOf(req, found.share);
  if (access === null) return { error: [401, LOCKED], found };
  return { found, access };
}

// 给对方的安装命令：密码分享把解锁凭据带进链接（24 小时内有效），CLI 命令则让 ash 自己提示输入密码
function installCommands(base, share, access) {
  const url = shareUrl(base, share.token);
  const script = `${url}/install.sh${access ? `?access=${encodeURIComponent(access)}` : ''}`;
  return { curl: `curl -fsSL ${shQuote(script)} | bash`, ash: `ash pull ${url}` };
}

// ——— 链接本身 /share/:token ———

// 浏览器打开（Accept 首选 text/html）交给前端分享页（server/index.js 里的页面路由）；其余返回 Markdown，方便 Agent 直接读
page.get('/:token', (req, res, next) => {
  if (req.accepts(['text/markdown', 'text/html']) === 'text/html' && req.query.format !== 'md') return next();
  const { found, access, error } = lookup(req);
  res.type('text/markdown');
  if (error) {
    const hint = error[0] === 401 ? `\n\n在浏览器打开此链接输入密码查看，或运行 \`ash pull ${shareUrl(getBaseUrl(req), req.params.token)}\`（会提示输入密码）。` : '';
    return res.status(error[0]).send(`# 错误\n\n${error[1]}${hint}\n`);
  }
  const { share, view, skill } = found;
  countAccess(share, 'view');
  recordEvent(skill, null, 'view', { terminal: 'share', revision: view.revision });
  if (['1', 'true'].includes(String(req.query.raw || ''))) return res.send(view.content);

  const base = getBaseUrl(req);
  const url = shareUrl(base, share.token);
  const query = access ? `?access=${encodeURIComponent(access)}` : '';
  const cmds = installCommands(base, share, access);
  const appendix = [
    '', '', '---', '',
    '<!-- 以下由 AnotherSkillHub 附加，不属于 SKILL.md 原文（?raw=1 可获取原文） -->',
    `> 来自 ${found.owner} 的分享 · v${view.version}${share.follow_latest ? '（跟随最新）' : '（快照）'}`,
    '',
    ...(view.files.length ? [
      '## 附属文件', '',
      `本技能包含 ${view.files.length} 个附属文件，正文中的相对路径指向它们。`, '',
      ...view.files.map((f) => `- \`${f.path}\`：${url}/files/${encodePath(f.path)}${query}`),
      '',
    ] : []),
    '## 安装', '',
    `- 一键安装：\`${cmds.curl}\``,
    `- 已装 ash：\`${cmds.ash}\``,
    `- 下载 zip：${url}/download${query}`,
    '',
  ];
  res.send(view.content.replace(/\s*$/, '') + appendix.join('\n'));
});

// CLI 用的概要：密码分享未解锁时只回 password_required
page.get('/:token/info', (req, res) => {
  const { found, error } = lookup(req);
  if (error && error[0] === 404) return res.status(404).json({ error: error[1] });
  if (error) return res.status(401).json({ error: error[1], password_required: true });
  const { view, share, owner } = found;
  res.json({ slug: view.slug, name: view.name, version: view.version, revision: view.revision, follow_latest: Boolean(share.follow_latest), owner, password_required: Boolean(share.password_hash) });
});

// 一键安装脚本：与本库安装同一个模板，只是归档地址指向分享、不带个人 token、不装依赖（引用的技能在分享者的库里，对方拿不到）
page.get('/:token/install.sh', (req, res) => {
  try {
    const { found, access, error } = lookup(req);
    if (error) {
      const message = error[0] === 401 ? `${LOCKED}：运行 ash pull ${shareUrl(getBaseUrl(req), req.params.token)}（会提示输入密码），或在网页输入密码后复制安装命令` : error[1];
      return scriptError(res, error[0], message);
    }
    const { share, view } = found;
    const base = getBaseUrl(req);
    const url = shareUrl(base, share.token);
    const footer = [
      `> 本技能来自 ${found.owner} 在 AnotherSkillHub 的分享（${share.follow_latest ? '跟随最新' : `v${view.version} 快照`}）。`,
      `> 重新安装或更新：\`ash pull ${url}\`。`,
    ].join('\n');
    const script = render('install.sh', {
      SLUG: shQuote(view.slug),
      BASE_URL: shQuote(base),
      AGENT: shQuote(INSTALL_AGENTS.includes(req.query.agent) ? req.query.agent : 'auto'),
      DIR: shQuote(typeof req.query.dir === 'string' ? req.query.dir : ''),
      PENDING: '0',
      FORCE: ['1', 'true'].includes(String(req.query.force || '')) ? '1' : '0',
      NODEPS: '1',
      REVISION: shQuote(view.revision),
      VERSION: shQuote(view.version),
      REASON: shQuote('install'),
      PIN: shQuote(''),
      FOOTER_MARK: shQuote(INSTALL_FOOTER_MARK),
      FOOTER: shQuote(footer),
      DEPS: '',
      ARCHIVE_URL: shQuote(`${url}/archive.tar.gz`),
      RAW_URL: shQuote(url),
      SHARE_URL: shQuote(url),
      SHARE_ACCESS: shQuote(access || ''),
      AGENT_ROOTS_FN,
    });
    res.type('text/plain').send(script);
  } catch (err) {
    scriptError(res, 500, `服务器错误：${err.message}`);
  }
});

// 归档：内容一律从数据库里的这一份生成（快照不在磁盘上；跟随最新时数据库也是真相来源）
function sendArchive(req, res, kind) {
  const { found, error } = lookup(req);
  if (error) return res.status(error[0]).type('text/plain').send(`错误: ${error[1]}\n`);
  const { share, view, skill } = found;
  countAccess(share, 'download');
  recordEvent(skill, null, 'install', { terminal: shareTerminal(req), revision: view.revision });
  if (kind === 'tar') {
    res.attachment(`${view.slug}.tar.gz`);
    createTarGzFromContent(view.slug, view.content, view.files, res);
  } else {
    res.attachment(`${view.slug}.zip`);
    createZipFromContent(view.slug, view.content, view.files, res);
  }
}

page.get('/:token/archive.tar.gz', (req, res) => {
  try { sendArchive(req, res, 'tar'); } catch (err) { res.status(500).type('text/plain').send(`错误: ${err.message}\n`); }
});
page.get('/:token/download', (req, res) => {
  try { sendArchive(req, res, 'zip'); } catch (err) { res.status(500).type('text/plain').send(`错误: ${err.message}\n`); }
});

// 单个附属文件（纯文本）
page.get('/:token/files/*filepath', (req, res) => {
  const { found, error } = lookup(req);
  if (error) return res.status(error[0]).type('text/plain').send(`错误: ${error[1]}\n`);
  const rel = [].concat(req.params.filepath).join('/');
  const file = rel === 'SKILL.md' ? { content: found.view.content } : found.view.files.find((f) => f.path === rel);
  if (!file) return res.status(404).type('text/plain').send(`错误: 文件 ${rel} 不存在\n`);
  res.type('text/plain').send(String(file.content));
});

// ——— 分享页用的 JSON /api/share/:token ———

function viewer(req, share) {
  const auth = authenticate(req);
  return auth ? { username: auth.user.username, is_owner: auth.user.id === share.user_id } : null;
}

api.get('/:token', (req, res) => {
  const { found, access, error } = lookup(req);
  if (error && error[0] === 404) return res.status(404).json({ error: error[1] });
  if (error) return res.status(401).json({ error: error[1], password_required: true });
  const { share, view, skill, owner } = found;
  countAccess(share, 'view');
  recordEvent(skill, null, 'view', { terminal: 'share', revision: view.revision });
  const base = getBaseUrl(req);
  const url = shareUrl(base, share.token);
  const query = access ? `?access=${encodeURIComponent(access)}` : '';
  res.json({
    slug: view.slug,
    name: view.name,
    description: view.description,
    tags: view.tags,
    version: view.version,
    content: view.content,
    files: view.files.map((f) => ({ path: f.path, size: Buffer.byteLength(String(f.content)) })),
    follow_latest: Boolean(share.follow_latest),
    updated_at: view.updated_at,
    owner,
    protected: Boolean(share.password_hash),
    url,
    download_url: `${url}/download${query}`,
    install: installCommands(base, share, access),
    viewer: viewer(req, share),
  });
});

// 解锁：密码对了签发 24 小时的访问凭据，网页种 cookie（刷新、下载不用再输），同时返回给 CLI。
// 失败计入登录同一套限流（同 IP 10 分钟 10 次；键名带 # 不会和用户名撞上）
api.post('/:token/unlock', async (req, res) => {
  const found = findShare(req.params.token);
  if (!found) return res.status(404).json({ error: NOT_FOUND });
  const { share } = found;
  if (!share.password_hash) return res.json({ access: '', expires_at: null });
  const limitKey = `#share:${share.id}`;
  if (isRateLimited(req, limitKey)) return res.status(429).json({ error: '尝试次数过多，请 10 分钟后再试' });
  const password = String(req.body?.password ?? '');
  if (!password || password.length > 200 || !(await verifyPassword(password, share.password_hash))) {
    recordFailure(req, limitKey);
    return res.status(403).json({ error: '密码不正确' });
  }
  clearFailures(req, limitKey);
  const grant = issueAccess(share);
  setAccessCookie(req, res, share, grant.access);
  res.json(grant);
});

// 分享页里点开附属文件
api.get('/:token/file', (req, res) => {
  const { found, error } = lookup(req);
  if (error) return res.status(error[0]).json({ error: error[1], password_required: error[0] === 401 || undefined });
  const rel = String(req.query.path || '');
  const file = rel === 'SKILL.md' ? { content: found.view.content } : found.view.files.find((f) => f.path === rel);
  if (!file) return res.status(404).json({ error: `文件 ${rel} 不存在` });
  res.json({ path: rel, content: String(file.content) });
});

// 存到我的库：登录用户把这份内容复制进自己的库（收件箱）。同名时 409 并给出建议标识符，带 slug 重试
api.post('/:token/save', requireAuth, (req, res) => {
  try {
    const { found, error } = lookup(req);
    if (error) return res.status(error[0]).json({ error: error[1], password_required: error[0] === 401 || undefined });
    const { share, view, skill, owner } = found;
    if (share.user_id === req.user.id) return res.status(400).json({ error: '这是你自己的技能，已经在你的库里了' });

    const slug = req.body?.slug !== undefined ? slugify(req.body.slug) : view.slug;
    if (!slug) return res.status(400).json({ error: '标识符只能用英文、数字、- _ .' });
    const taken = (s) => db.prepare('SELECT id FROM skills WHERE user_id = ? AND slug = ?').get(req.user.id, s);
    if (taken(slug)) {
      let suggested = slugify(`${view.slug}-from-${owner}`) || `${view.slug}-shared`;
      for (let n = 2; taken(suggested); n += 1) suggested = slugify(`${view.slug}-from-${owner}-${n}`);
      return res.status(409).json({ error: `你的库里已有标识符「${slug}」`, conflict: true, suggested_slug: suggested });
    }

    const filesJson = JSON.stringify(view.files);
    const r = db.prepare(`
      INSERT INTO skills (user_id, slug, name, description, folder_path, tags, content, files, terminal_source, version, security_warnings)
      VALUES (?, ?, ?, ?, 'inbox', ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, slug, view.name, view.description, JSON.stringify(view.tags), view.content, filesJson,
      `Share:${owner}`, view.version || '1.0.0', JSON.stringify(warningsFor(view.content, view.files)));
    saveSkillToDisk(req.user.id, 'inbox', slug, view.content, view.files);

    countAccess(share, 'download');
    recordEvent(skill, req.user.id, 'install', { terminal: 'share:saved', revision: view.revision });
    res.status(201).json({ id: r.lastInsertRowid, slug, url: `/app?skill=${encodeURIComponent(slug)}` });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: '标识符已存在，请换一个', conflict: true });
    res.status(500).json({ error: err.message });
  }
});

module.exports = { page, api };
