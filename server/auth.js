// 鉴权：网页用 httpOnly cookie 会话，CLI / Agent 用个人 API token（Authorization: Bearer ash_…）。
// 数据库里只存会话 id 与 token 的 sha256，明文只在签发时出现一次。
const crypto = require('crypto');
const { promisify } = require('util');
const db = require('./db');

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = 'ash_sid';
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_SESSIONS_PER_USER = 20;
const USERNAME_RE = /^[a-z0-9_-]{3,32}$/;

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const randomSecret = () => crypto.randomBytes(32).toString('base64url');

// ——— 密码 ———
// 存储格式：scrypt$N$r$p$salt$hash（参数随哈希保存，以后调参不影响老密码）
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(String(password), Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(actual, expected);
}

// 用户不存在时也跑一遍 scrypt，避免按响应时间枚举用户名
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

function validateCredentials(username, password) {
  if (!USERNAME_RE.test(String(username || ''))) return '用户名需为 3–32 位小写字母、数字、- 或 _';
  if (typeof password !== 'string' || password.length < 8) return '密码至少 8 位';
  if (password.length > 200) return '密码过长';
  return null;
}

// ——— 会话 ———
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key || Object.hasOwn(out, key)) continue;
    try { out[key] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* 忽略坏 cookie */ }
  }
  return out;
}

function cookieAttrs(req, maxAgeSeconds) {
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${req.secure ? '; Secure' : ''}`;
}

// 新建会话时顺带清理：删掉所有过期会话，并只保留该用户最近的 MAX_SESSIONS_PER_USER 个，会话表不会无限增长
function createSession(req, res, userId) {
  const sid = randomSecret();
  const now = Date.now();
  db.transaction(() => {
    db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(now);
    db.prepare('INSERT INTO auth_sessions (id_hash, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)')
      .run(sha256(sid), userId, now + SESSION_TTL_MS, String(req.get('user-agent') || '').slice(0, 200));
    db.prepare(`
      DELETE FROM auth_sessions WHERE user_id = ? AND id_hash NOT IN (
        SELECT id_hash FROM auth_sessions WHERE user_id = ? ORDER BY expires_at DESC LIMIT ?
      )
    `).run(userId, userId, MAX_SESSIONS_PER_USER);
  })();
  res.append('Set-Cookie', `${SESSION_COOKIE}=${sid}; ${cookieAttrs(req, SESSION_TTL_MS / 1000)}`);
}

function currentSessionHash(req) {
  const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  return sid ? sha256(sid) : null;
}

function destroySession(req, res) {
  const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (sid) db.prepare('DELETE FROM auth_sessions WHERE id_hash = ?').run(sha256(sid));
  res.append('Set-Cookie', `${SESSION_COOKIE}=; ${cookieAttrs(req, 0)}`);
}

// ——— API token ———
function issueToken(userId, name) {
  const token = `ash_${randomSecret()}`;
  const r = db.prepare('INSERT INTO api_tokens (user_id, name, token_hash, prefix) VALUES (?, ?, ?, ?)')
    .run(userId, String(name || 'token').slice(0, 64), sha256(token), token.slice(0, 10));
  return { id: r.lastInsertRowid, token };
}

// ——— 请求鉴权 ———
const activeUser = (id) => db.prepare('SELECT id, username, role FROM users WHERE id = ? AND disabled = 0').get(id);

// 返回 { user, via: 'token' | 'session' } 或 null
function authenticate(req) {
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
  if (bearer) {
    const row = db.prepare('SELECT id, user_id, last_used_at FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL').get(sha256(bearer[1]));
    const user = row && activeUser(row.user_id);
    if (!user) return null;
    // last_used_at 精确到分钟即可，避免每个请求都写库
    if (!row.last_used_at || Date.now() - Date.parse(`${row.last_used_at}Z`) > 60_000) {
      db.prepare('UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
    }
    return { user, via: 'token' };
  }
  const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!sid) return null;
  const session = db.prepare('SELECT user_id, expires_at FROM auth_sessions WHERE id_hash = ?').get(sha256(sid));
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    db.prepare('DELETE FROM auth_sessions WHERE id_hash = ?').run(sha256(sid));
    return null;
  }
  const user = activeUser(session.user_id);
  return user ? { user, via: 'session' } : null;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// cookie 会自动附带，跨站请求必须挡住：写操作要求自定义头（跨站带自定义头会触发预检，而服务端不放行跨域），
// 且 Origin（若有）必须与本站一致。token 请求不受影响——token 不会被浏览器自动附带。
function csrfOk(req) {
  if (SAFE_METHODS.has(req.method)) return true;
  if (req.get('x-ash-request') !== '1') return false;
  const origin = req.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === (req.get('x-forwarded-host') || req.get('host')); } catch { return false; }
}

function unauthorized(req, res, status, message) {
  const hint = status === 401 ? `${message}（网页请登录；终端请运行 ash login）` : message;
  if (req.path.endsWith('.sh')) {
    const { shQuote } = require('./shell');
    return res.status(status).type('text/plain').send(`#!/usr/bin/env bash\necho ${shQuote(`错误: ${hint}`)} >&2\nexit 1\n`);
  }
  if (req.baseUrl.startsWith('/api')) return res.status(status).json({ error: hint });
  return res.status(status).type('text/plain').send(`错误: ${hint}\n`);
}

function requireAuth(req, res, next) {
  const auth = authenticate(req);
  if (!auth) return unauthorized(req, res, 401, '未登录或凭证已失效');
  if (auth.via === 'session' && !csrfOk(req)) return unauthorized(req, res, 403, '请求来源校验失败');
  req.user = auth.user;
  req.authVia = auth.via;
  next();
}

// ——— 登录限流：同一 IP 或同一用户名 10 分钟内失败 10 次即锁定到窗口结束 ———
// 表在内存里，键来自请求：每分钟清掉过期条目，另设条目上限（超出时丢最早的），防止被刷爆内存
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 10;
const MAX_TRACKED_KEYS = 10_000;
const failures = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of failures) if (now - entry.first > WINDOW_MS) failures.delete(key);
}, 60_000).unref();

function limitKeys(req, username) {
  const name = String(username || '').toLowerCase().slice(0, 32);
  return name ? [`ip:${req.ip}`, `user:${name}`] : [`ip:${req.ip}`];
}

function isRateLimited(req, username) {
  const now = Date.now();
  return limitKeys(req, username).some((key) => {
    const entry = failures.get(key);
    if (!entry) return false;
    if (now - entry.first > WINDOW_MS) { failures.delete(key); return false; }
    return entry.count >= MAX_FAILURES;
  });
}

function recordFailure(req, username) {
  const now = Date.now();
  for (const key of limitKeys(req, username)) {
    const entry = failures.get(key);
    if (!entry || now - entry.first > WINDOW_MS) {
      failures.delete(key);
      if (failures.size >= MAX_TRACKED_KEYS) failures.delete(failures.keys().next().value);
      failures.set(key, { count: 1, first: now });
    } else entry.count += 1;
  }
}

function clearFailures(req, username) {
  limitKeys(req, username).forEach((key) => failures.delete(key));
}

module.exports = {
  USERNAME_RE, DUMMY_HASH, SESSION_COOKIE,
  hashPassword, verifyPassword, validateCredentials,
  createSession, destroySession, currentSessionHash, issueToken, sha256,
  authenticate, requireAuth, csrfOk,
  isRateLimited, recordFailure, clearFailures,
  MAX_SESSIONS_PER_USER,
};
