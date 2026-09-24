// 会话状态：跨设备恢复「上次浏览到哪」（选中技能/文件夹/标签），按登录用户保存
const express = require('express');
const router = express.Router();
const db = require('../db');

// 读
router.get('/', (req, res) => {
  const row = db.prepare('SELECT selected_slug, folder, tag, updated_at FROM session_state WHERE user_id = ?').get(req.user.id);
  res.json(row || { selected_slug: null, folder: 'inbox', tag: null });
});

// 写（UPSERT）
router.put('/', (req, res) => {
  const { selected_slug = null, folder = 'inbox', tag = null } = req.body || {};
  if (folder && typeof folder !== 'string') return res.status(400).json({ error: 'folder must be string' });
  if (tag && typeof tag !== 'string') return res.status(400).json({ error: 'tag must be string' });
  if (selected_slug && typeof selected_slug !== 'string') return res.status(400).json({ error: 'selected_slug must be string' });
  db.prepare(`
    INSERT INTO session_state (user_id, selected_slug, folder, tag, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      selected_slug = excluded.selected_slug,
      folder = excluded.folder,
      tag = excluded.tag,
      updated_at = CURRENT_TIMESTAMP
  `).run(req.user.id, selected_slug, folder || 'inbox', tag || null);
  res.json({ success: true });
});

module.exports = router;
