// 会话状态：跨设备恢复「上次浏览到哪」（选中技能/文件夹/标签）
// 无鉴权阶段按 device_key（客户端生成的随机 id）隔离；将来加用户体系时换成 user_id
const express = require('express');
const router = express.Router();
const db = require('../db');

function validRow(row) {
  return row && typeof row === 'object';
}

// 读
router.get('/:deviceKey', (req, res) => {
  const row = db.prepare('SELECT selected_slug, folder, tag, updated_at FROM session_state WHERE device_key = ?').get(req.params.deviceKey);
  res.json(row || { selected_slug: null, folder: 'inbox', tag: null });
});

// 写（UPSERT）
router.put('/:deviceKey', (req, res) => {
  const { selected_slug = null, folder = 'inbox', tag = null } = req.body || {};
  if (folder && typeof folder !== 'string') return res.status(400).json({ error: 'folder must be string' });
  if (tag && typeof tag !== 'string') return res.status(400).json({ error: 'tag must be string' });
  if (selected_slug && typeof selected_slug !== 'string') return res.status(400).json({ error: 'selected_slug must be string' });
  db.prepare(`
    INSERT INTO session_state (device_key, selected_slug, folder, tag, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(device_key) DO UPDATE SET
      selected_slug = excluded.selected_slug,
      folder = excluded.folder,
      tag = excluded.tag,
      updated_at = CURRENT_TIMESTAMP
  `).run(String(req.params.deviceKey).slice(0, 64), selected_slug, folder || 'inbox', tag || null);
  res.json({ success: true });
});

module.exports = router;
