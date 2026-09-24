const express = require('express');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

const { authenticate, requireAuth } = require('./auth');
const skillsRoutes = require('./routes/skills');
const foldersRoutes = require('./routes/folders');
const agentRoutes = require('./routes/agent');
const { render } = require('./templates');
const { shQuote, getBaseUrl } = require('./shell');

const app = express();
const PORT = process.env.PORT || 9444;

// 前面有 Nginx / 隧道反代：信任私网来的 X-Forwarded-*，req.ip / req.secure 才是真实值（限流、Secure cookie 依赖它们）
app.set('trust proxy', process.env.ASH_TRUST_PROXY || 'loopback, linklocal, uniquelocal');
app.use(morgan('dev'));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

app.get('/healthz', (req, res) => res.json({ ok: true }));

// 挂载 API：除 /api/auth 外全部需要登录（网页会话）或 API token（CLI / Agent）
app.use('/api/auth', require('./routes/auth'));
app.use('/api/skills', requireAuth, skillsRoutes);
app.use('/api/session', requireAuth, require('./routes/session'));
app.use('/api/bundles', requireAuth, require('./routes/bundles'));
app.use('/api/folders', requireAuth, foldersRoutes);
app.use('/s', agentRoutes.browserRedirect, requireAuth, agentRoutes.publicRouter);
app.use('/api/agent', requireAuth, agentRoutes.apiRouter);

// CLI 安装/本体（/setup.sh 与 /cli.sh 是同一个脚本：管道执行时安装，安装后作为 ash 本体）
app.get(['/setup.sh', '/cli.sh'], (req, res) => {
  res.type('text/plain').send(render('cli.sh', { SERVER_URL: shQuote(getBaseUrl(req)) }));
});

// Agent 使用指南：引导语只指向这里，改指南不必给每台机器重发提示词
app.get(['/agent.md', '/llms.txt'], (req, res) => {
  res.type('text/markdown').send(render('agent.md', { BASE_URL: getBaseUrl(req) }));
});

// 前端：两个入口。index.html 是公开的 landing（含 /login、/register），app.html 是登录后的应用（/app）
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  const landingPage = path.join(clientDist, 'index.html');
  const appPage = path.join(clientDist, 'app.html');
  // 页面本身不缓存：发版后立刻拿到新的资源文件名（资源文件自带 hash，可长缓存）
  const sendPage = (res, file) => res.set('Cache-Control', 'no-cache').sendFile(file);

  app.get('/', (req, res) => {
    // 多用户之前的分享链接是 /?skill=<slug>，应用搬到 /app 后原样转过去
    if (req.query.skill || req.query.view) return res.redirect(`/app${req.originalUrl.slice(1)}`);
    sendPage(res, landingPage);
  });
  app.get('/docs', (req, res) => sendPage(res, landingPage));
  app.get(['/login', '/register'], (req, res) => {
    if (authenticate(req)) return res.redirect('/app');
    sendPage(res, landingPage);
  });
  app.get(['/app', '/app/*rest'], (req, res) => {
    if (!authenticate(req)) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    sendPage(res, appPage);
  });
  app.use(express.static(clientDist, { index: false }));
  app.use((req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/s/') || req.path.endsWith('.sh')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.status(404).set('Cache-Control', 'no-cache').sendFile(landingPage);
  });
} else {
  app.get('/', (req, res) => {
    res.send('<h1>AnotherSkillHub API Server is running</h1><p>Client UI is building...</p>');
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 AnotherSkillHub Server listening on http://0.0.0.0:${PORT}`);
});
