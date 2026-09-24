// 账号：注册、登录、登出、改密码、个人 API token。挂在 /api/auth，本身不在 requireAuth 后面，按接口各自校验。
const express = require('express');
const router = express.Router();
const db = require('../db');
const { ensureUserDefaults } = require('../db');
const { seedUserLibrary } = require('../seed');
const {
  USERNAME_RE, DUMMY_HASH, hashPassword, verifyPassword, validateCredentials,
  createSession, destroySession, currentSessionHash, issueToken,
  requireAuth, csrfOk, isRateLimited, recordFailure, clearFailures,
} = require('../auth');

const registrationOpen = () => process.env.ASH_REGISTRATION !== 'closed';
const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role });

// 未登录的写接口同样要挡跨站请求（登录 CSRF）；CLI 调用时自带该请求头
function requireSameSite(req, res, next) {
  if (!csrfOk(req)) return res.status(403).json({ error: '请求来源校验失败' });
  next();
}

// 管理账号与 token 只能在网页会话里做：Agent 手里的 token 不能用来给自己续命或改密码
function requireSession(req, res, next) {
  if (req.authVia !== 'session') return res.status(403).json({ error: '此操作需要在网页登录后进行' });
  next();
}

// 校验用户名密码；失败计入限流。成功返回用户行，失败时已写好响应并返回 null
async function checkPassword(req, res) {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  // 不可能存在的用户名/超长密码直接拒绝：不跑 scrypt，也不往限流表里写任意长的键
  if (!USERNAME_RE.test(username) || password.length > 200) {
    recordFailure(req, '');
    res.status(401).json({ error: '用户名或密码错误' });
    return null;
  }
  if (isRateLimited(req, username)) {
    res.status(429).json({ error: '失败次数过多，请 10 分钟后再试' });
    return null;
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok || user.disabled) {
    recordFailure(req, username);
    // 停用账号也回同样的话：否则「账号已停用」会暴露密码猜对了
    res.status(401).json({ error: '用户名或密码错误' });
    return null;
  }
  clearFailures(req, username);
  return user;
}

// 前端据此决定是否显示注册入口
router.get('/config', (req, res) => {
  res.json({ registration: registrationOpen() ? 'open' : 'closed' });
});

router.post('/register', requireSameSite, async (req, res) => {
  try {
    if (!registrationOpen()) return res.status(403).json({ error: '当前未开放注册，请联系管理员' });
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = req.body?.password;
    const invalid = validateCredentials(username, password);
    if (invalid) return res.status(400).json({ error: invalid });
    if (isRateLimited(req, username)) return res.status(429).json({ error: '请求过于频繁，请稍后再试' });

    const passwordHash = await hashPassword(password);
    const user = db.transaction(() => {
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return null;
      // 全新实例的第一个账号是管理员
      const role = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0 ? 'admin' : 'member';
      const r = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, passwordHash, role);
      return { id: Number(r.lastInsertRowid), username, role };
    })();
    if (!user) {
      recordFailure(req, username);
      return res.status(409).json({ error: '用户名已被占用' });
    }
    ensureUserDefaults(user.id);
    seedUserLibrary(user.id);
    createSession(req, res, user.id);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', requireSameSite, async (req, res) => {
  try {
    const user = await checkPassword(req, res);
    if (!user) return;
    createSession(req, res, user.id);
    res.json({ user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/logout', requireSameSite, (req, res) => {
  destroySession(req, res);
  res.json({ success: true });
});

// ash login：用户名密码换一个 API token（明文只返回这一次）
router.post('/cli-token', requireSameSite, async (req, res) => {
  try {
    const user = await checkPassword(req, res);
    if (!user) return;
    const terminal = String(req.body?.terminal || '').trim().slice(0, 40);
    const { id, token } = issueToken(user.id, `ash CLI${terminal ? ` @ ${terminal}` : ''}`);
    res.status(201).json({ id, token, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), via: req.authVia });
});

// 改密码：校验旧密码，成功后注销该用户的其他会话（当前会话保留）
router.post('/password', requireAuth, requireSession, async (req, res) => {
  try {
    const { current_password: current, new_password: next } = req.body || {};
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!(await verifyPassword(String(current || ''), row.password_hash))) return res.status(400).json({ error: '当前密码不正确' });
    const invalid = validateCredentials(req.user.username, next);
    if (invalid) return res.status(400).json({ error: invalid });
    const hash = await hashPassword(next);
    const currentHash = currentSessionHash(req);
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
      db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND id_hash != ?').run(req.user.id, currentHash);
    })();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ——— 个人 API token ———
router.get('/tokens', requireAuth, requireSession, (req, res) => {
  res.json(db.prepare(`
    SELECT id, name, prefix, created_at, last_used_at FROM api_tokens
    WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC, id DESC
  `).all(req.user.id));
});

router.post('/tokens', requireAuth, requireSession, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '请给 token 起个名字（例如用在哪台机器）' });
  const { id, token } = issueToken(req.user.id, name);
  res.status(201).json({ id, name, token });
});

router.delete('/tokens/:id', requireAuth, requireSession, (req, res) => {
  const r = db.prepare('UPDATE api_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .run(req.params.id, req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Token 不存在' });
  res.json({ success: true });
});

module.exports = router;
