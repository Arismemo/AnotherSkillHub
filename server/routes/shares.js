// 分享管理（登录后）：挂在 /api/shares。一个技能可以有多条分享链接，各自的备注、密码、期限，可随时停用。
// 网页（详情页分享弹窗、我的分享）与 CLI（ash share / shares / unshare）共用这组接口
const express = require('express');
const db = require('../db');
const { hashPassword } = require('../auth');
const { getBaseUrl } = require('../shell');
const { newToken, ownerShare, OWNER_SELECT } = require('../shares');

const router = express.Router();

const MAX_SHARES_PER_SKILL = 50;
const MAX_EXPIRES_SECONDS = 365 * 24 * 3600;
const EXPIRES_ALIASES = { '1d': 86400, '7d': 7 * 86400, '30d': 30 * 86400, never: null };
const wantsText = (req) => req.query.format === 'text' || req.body?.format === 'text';

// :id 可以是分享 id、token 或完整链接（CLI 的 ash unshare 直接粘贴链接）
function findOwnShare(userId, ref) {
  const raw = String(ref || '');
  const token = /\/share\/([A-Za-z0-9_-]+)/.exec(raw)?.[1] || raw;
  const where = /^\d+$/.test(token) ? 'sh.id = ?' : 'sh.token = ?';
  return db.prepare(`${OWNER_SELECT} WHERE sh.user_id = ? AND ${where}`).get(userId, /^\d+$/.test(token) ? Number(token) : token);
}

// 技能可以用 id 或标识符指定（网页传 id，CLI 传 slug）
function findOwnSkill(userId, ref) {
  const raw = String(ref ?? '');
  return /^\d+$/.test(raw)
    ? db.prepare('SELECT * FROM skills WHERE id = ? AND user_id = ?').get(Number(raw), userId)
    : db.prepare('SELECT * FROM skills WHERE slug = ? AND user_id = ?').get(raw, userId);
}

// 有效期：秒数或 1d / 7d / 30d / never；返回 { value: 毫秒时间戳 | null } 或 { error }
function parseExpires(body) {
  const raw = body.expires ?? body.expires_in;
  if (raw === undefined || raw === null || raw === '' || raw === 'never') return { value: null };
  const seconds = Object.hasOwn(EXPIRES_ALIASES, raw) ? EXPIRES_ALIASES[raw] : Number(raw);
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > MAX_EXPIRES_SECONDS) {
    return { error: '有效期必须是 1d / 7d / 30d / never，或 1 秒到 365 天之间的秒数' };
  }
  return { value: Date.now() + seconds * 1000 };
}

// 密码：不传 = 不改（新建时即无密码）；'' 或 null = 去掉密码；否则 4–200 位
async function parsePassword(body) {
  if (!Object.hasOwn(body, 'password')) return { keep: true };
  const value = body.password;
  if (value === null || value === '') return { value: null };
  const text = String(value);
  if (text.length < 4 || text.length > 200) return { error: '访问密码需要 4 到 200 位' };
  return { value: await hashPassword(text) };
}

function parseLabel(body) {
  const label = String(body.label ?? '').trim();
  return label.length > 80 ? { error: '备注最多 80 个字' } : { value: label };
}

function describe(share) {
  const content = share.follow_latest ? `跟随最新（当前 v${share.version}）` : `快照 v${share.version}`;
  const access = share.protected ? '密码' : '公开';
  const expires = share.expired ? '已过期' : share.expires_at ? `${new Date(share.expires_at).toISOString().slice(0, 16).replace('T', ' ')} UTC 到期` : '永久';
  return `${content} · ${access} · ${expires} · 浏览 ${share.view_count} · 取用 ${share.download_count}`;
}

function textLine(share) {
  return [
    `#${share.id}  ${share.skill_slug}${share.label ? `  「${share.label}」` : ''}`,
    `   ${describe(share)}`,
    `   ${share.url}`,
  ].join('\n');
}

// 列表：?skill=<id|slug> 只看某个技能的分享；format=text 给 CLI
router.get('/', (req, res) => {
  let rows;
  if (req.query.skill !== undefined) {
    const skill = findOwnSkill(req.user.id, req.query.skill);
    if (!skill) return res.status(404).json({ error: `技能 ${req.query.skill} 不存在` });
    rows = db.prepare(`${OWNER_SELECT} WHERE sh.user_id = ? AND sh.skill_id = ? ORDER BY sh.created_at DESC, sh.id DESC`).all(req.user.id, skill.id);
  } else {
    rows = db.prepare(`${OWNER_SELECT} WHERE sh.user_id = ? ORDER BY sh.created_at DESC, sh.id DESC`).all(req.user.id);
  }
  const shares = rows.map((row) => ownerShare(row, getBaseUrl(req)));
  if (wantsText(req)) {
    return res.type('text/plain').send(shares.length ? `${shares.map(textLine).join('\n')}\n` : '还没有分享链接（ash share <slug> 创建）\n');
  }
  res.json({ shares });
});

// 新建：{ skill, label?, password?, expires?|expires_in?, follow_latest? }
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const skill = findOwnSkill(req.user.id, body.skill ?? body.skill_id);
    if (!skill || skill.is_deleted) return res.status(404).json({ error: `技能 ${body.skill ?? body.skill_id ?? ''} 不存在或已在回收站` });
    if (skill.status === 'pending') return res.status(400).json({ error: '待审核的技能不能分享，采纳后再试' });

    const label = parseLabel(body);
    const expires = parseExpires(body);
    const password = await parsePassword(body);
    const error = label.error || expires.error || password.error;
    if (error) return res.status(400).json({ error });

    const count = db.prepare('SELECT COUNT(*) AS n FROM skill_shares WHERE skill_id = ? AND user_id = ?').get(skill.id, req.user.id).n;
    if (count >= MAX_SHARES_PER_SKILL) return res.status(400).json({ error: `一个技能最多 ${MAX_SHARES_PER_SKILL} 条分享链接，先停用一些旧的` });

    const followLatest = body.follow_latest === true || body.follow_latest === 1 || body.follow_latest === '1' || body.follow_latest === 'true';
    // 快照：冻结当前已发布的内容（待审更新在 pending_* 里，不会被带出去）
    const snap = followLatest ? {} : skill;
    const r = db.prepare(`
      INSERT INTO skill_shares (user_id, skill_id, token, label, follow_latest, slug, name, description, tags, version, content, files, password_hash, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, skill.id, newToken(), label.value, followLatest ? 1 : 0,
      snap.slug ?? null, snap.name ?? null, snap.description ?? null, snap.tags ?? null, snap.version ?? null, snap.content ?? null, snap.files ?? null,
      password.keep ? null : password.value, expires.value);

    const share = ownerShare(db.prepare(`${OWNER_SELECT} WHERE sh.id = ?`).get(r.lastInsertRowid), getBaseUrl(req));
    if (wantsText(req)) return res.status(201).type('text/plain').send(`✓ 已创建分享链接\n${textLine(share)}\n`);
    res.status(201).json({ share });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 修改：{ label?, password?, expires?|expires_in? }——只改传了的字段；内容（快照 / 跟随最新）创建后不变，要换就新建一条
router.patch('/:id', async (req, res) => {
  try {
    const share = findOwnShare(req.user.id, req.params.id);
    if (!share) return res.status(404).json({ error: '分享链接不存在' });
    const body = req.body || {};
    const sets = [];
    const values = [];
    if (Object.hasOwn(body, 'label')) {
      const label = parseLabel(body);
      if (label.error) return res.status(400).json({ error: label.error });
      sets.push('label = ?'); values.push(label.value);
    }
    if (Object.hasOwn(body, 'expires') || Object.hasOwn(body, 'expires_in')) {
      const expires = parseExpires(body);
      if (expires.error) return res.status(400).json({ error: expires.error });
      sets.push('expires_at = ?'); values.push(expires.value);
    }
    const password = await parsePassword(body);
    if (password.error) return res.status(400).json({ error: password.error });
    if (!password.keep) { sets.push('password_hash = ?'); values.push(password.value); }
    if (sets.length) db.prepare(`UPDATE skill_shares SET ${sets.join(', ')} WHERE id = ?`).run(...values, share.id);
    res.json({ share: ownerShare(db.prepare(`${OWNER_SELECT} WHERE sh.id = ?`).get(share.id), getBaseUrl(req)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 停用：直接删除，链接立即失效
router.delete('/:id', (req, res) => {
  const share = findOwnShare(req.user.id, req.params.id);
  if (!share) return res.status(404).json({ error: '分享链接不存在' });
  db.prepare('DELETE FROM skill_shares WHERE id = ?').run(share.id);
  if (wantsText(req)) return res.type('text/plain').send(`✓ 已停用分享 #${share.id}（${share.skill_slug}）\n`);
  res.json({ success: true });
});

module.exports = router;
