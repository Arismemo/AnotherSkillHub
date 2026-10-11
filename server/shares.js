// 分享链接的公共部分：按 token 找分享、对外可见的内容、密码分享的访问凭据。
// 管理接口（登录后增删改查）在 routes/shares.js，免登录访问（网页、Markdown、安装脚本、归档）在 routes/sharePublic.js。
const crypto = require('crypto');
const db = require('./db');
const { parseJson, skillRevision } = require('./review');
const { parseCookies, cookieAttrs } = require('./auth');

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const ACCESS_TTL_MS = 24 * 3600 * 1000;
const ACCESS_HEADER = 'x-ash-share-access';

// 16 字节随机数（128 位），base64url 后 22 个字符
const newToken = () => crypto.randomBytes(16).toString('base64url');
const shareUrl = (base, token) => `${base}/share/${token}`;
const accessCookie = (share) => `ash_share_${share.id}`;

// 签访问凭据的密钥：首次用到时生成并存进 app_meta，重启后已签发的凭据仍然有效
let cachedSecret = null;
function secret() {
  if (cachedSecret) return cachedSecret;
  db.prepare("INSERT OR IGNORE INTO app_meta (key, value) VALUES ('share_secret', ?)").run(crypto.randomBytes(32).toString('hex'));
  cachedSecret = db.prepare("SELECT value FROM app_meta WHERE key = 'share_secret'").get().value;
  return cachedSecret;
}

// 按 token 找到仍然有效的分享；无效、过期、技能已删除或待审、主人账号已停用一律返回 null（对外统一 404，不区分原因）
function findShare(token) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const share = db.prepare('SELECT * FROM skill_shares WHERE token = ?').get(String(token));
  if (!share || (share.expires_at && share.expires_at <= Date.now())) return null;
  const skill = db.prepare('SELECT * FROM skills WHERE id = ? AND user_id = ?').get(share.skill_id, share.user_id);
  if (!skill || skill.is_deleted || skill.status === 'pending') return null;
  const owner = db.prepare('SELECT username FROM users WHERE id = ? AND disabled = 0').get(share.user_id);
  if (!owner) return null;
  return { share, skill, owner: owner.username, view: shareView(share, skill) };
}

// 分享出去的那一份内容：快照取分享行里冻结的列，跟随最新取技能当前已发布的内容（待审更新不在 content 里，不会外泄）
function shareView(share, skill) {
  const src = share.follow_latest ? skill : share;
  const filesJson = src.files || '[]';
  return {
    slug: src.slug,
    name: src.name,
    description: src.description || '',
    tags: parseJson(src.tags, []),
    version: src.version || '',
    content: src.content || '',
    files: parseJson(filesJson, []).filter((f) => f && f.path && f.content !== undefined && f.path !== 'SKILL.md'),
    revision: skillRevision({ content: src.content || '', files: filesJson }),
    updated_at: share.follow_latest ? skill.updated_at : share.created_at,
  };
}

// ——— 密码分享的访问凭据：<分享 id>.<过期毫秒>.<签名> ———
// 签名覆盖密码哈希：改密码或去掉密码后，之前解锁得到的凭据全部失效
function sign(share, exp) {
  return crypto.createHmac('sha256', secret()).update(`${share.id}.${exp}.${share.password_hash || ''}`).digest('base64url');
}

function issueAccess(share) {
  const exp = Date.now() + ACCESS_TTL_MS;
  return { access: `${share.id}.${exp}.${sign(share, exp)}`, expires_at: exp };
}

function accessValid(share, value) {
  const m = /^(\d+)\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(String(value || ''));
  if (!m || Number(m[1]) !== share.id || Number(m[2]) <= Date.now()) return false;
  const expected = Buffer.from(sign(share, m[2]));
  const given = Buffer.from(m[3]);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// 请求里带着的有效凭据（请求头 > ?access= > 网页解锁时种下的 cookie）；公开分享返回 ''，没有有效凭据返回 null
function accessOf(req, share) {
  if (!share.password_hash) return '';
  const candidates = [req.get(ACCESS_HEADER), req.query?.access, parseCookies(req.headers.cookie)[accessCookie(share)]];
  return candidates.find((value) => value && accessValid(share, value)) || null;
}

function setAccessCookie(req, res, share, access) {
  res.append('Set-Cookie', `${accessCookie(share)}=${access}; ${cookieAttrs(req, ACCESS_TTL_MS / 1000)}`);
}

// 访问计数：浏览（网页 / Markdown）与取用（下载、安装、存到自己库里）分开记
function countAccess(share, kind) {
  const column = kind === 'download' ? 'download_count' : 'view_count';
  db.prepare(`UPDATE skill_shares SET ${column} = ${column} + 1, last_accessed_at = ? WHERE id = ?`).run(Date.now(), share.id);
}

// 给主人看的一条分享（列表、创建、修改的返回值）
function ownerShare(row, base) {
  return {
    id: row.id,
    skill_id: row.skill_id,
    skill_slug: row.skill_slug,
    skill_name: row.skill_name,
    token: row.token,
    url: shareUrl(base, row.token),
    label: row.label || '',
    follow_latest: Boolean(row.follow_latest),
    version: row.follow_latest ? row.skill_version : row.version,
    protected: Boolean(row.password_hash),
    expires_at: row.expires_at,
    expired: Boolean(row.expires_at && row.expires_at <= Date.now()),
    view_count: row.view_count,
    download_count: row.download_count,
    last_accessed_at: row.last_accessed_at,
    created_at: row.created_at,
  };
}

const OWNER_SELECT = `
  SELECT sh.*, s.slug AS skill_slug, s.name AS skill_name, s.version AS skill_version
  FROM skill_shares sh JOIN skills s ON s.id = sh.skill_id AND s.user_id = sh.user_id
`;

module.exports = {
  TOKEN_RE, ACCESS_HEADER, newToken, shareUrl,
  findShare, issueAccess, accessOf, setAccessCookie, countAccess,
  ownerShare, OWNER_SELECT,
};
