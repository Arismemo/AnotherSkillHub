// 分享：免登录查看技能（公开 / 密码访问）。token 只存 sha256，密码用 scrypt。
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { verifyPassword } = require('../auth');
const { recordEvent } = require('../usage');

const router = express.Router();
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

// 无效 / 过期 / 吊销一律 404，不区分，避免探测
const notFound = (res) => res.status(404).json({ error: '链接不存在或已过期' });

function findShare(token) {
  const hash = sha256(token);
  const skill = db.prepare(`
    SELECT id, user_id, slug, name, description, tags, content, version, updated_at,
           share_mode, share_expires_at, share_password_hash
    FROM skills WHERE share_token_hash = ? AND is_deleted = 0 AND status = 'approved'
  `).get(hash);
  if (!skill) return null;
  if (skill.share_expires_at && new Date(skill.share_expires_at) < new Date()) return null;
  return skill;
}

const publicFields = (skill) => ({
  slug: skill.slug,
  name: skill.name,
  description: skill.description,
  tags: JSON.parse(skill.tags || '[]'),
  version: skill.version,
  updated_at: skill.updated_at,
  mode: skill.share_mode,
  content: skill.content,
});

// 公开访问：GET /api/share/:token
router.get('/:token', (req, res) => {
  const skill = findShare(req.params.token);
  if (!skill) return notFound(res);
  if (skill.share_mode === 'password') {
    return res.status(401).json({ error: '需要密码', password_required: true });
  }
  recordEvent(skill, null, 'view', { terminal: 'share' });
  res.json(publicFields(skill));
});

// 密码访问：POST /api/share/:token/unlock
router.post('/:token/unlock', async (req, res) => {
  const skill = findShare(req.params.token);
  if (!skill) return notFound(res);
  if (skill.share_mode !== 'password') return res.status(400).json({ error: '该链接不需要密码' });

  const password = String(req.body?.password || '');
  const ok = await verifyPassword(password, skill.share_password_hash);
  if (!ok) return res.status(403).json({ error: '密码错误' });

  recordEvent(skill, null, 'view', { terminal: 'share' });
  res.json(publicFields(skill));
});

module.exports = router;
