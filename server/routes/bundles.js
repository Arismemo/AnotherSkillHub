// 技能组合（Bundle）：一组技能的快捷方式集合
// - 删除组合/移除组合项不影响技能本身
// - /s/bundle/:slug/install.sh 一次安装组合内全部技能
const express = require('express');
const router = express.Router();
const db = require('../db');

const { findBundle, bundleMembers } = require('../bundleLookup');
const { getBaseUrl } = require('../shell');

function bundleWithItems(bundleId) {
  const bundle = db.prepare('SELECT * FROM bundles WHERE id = ?').get(bundleId);
  if (!bundle) return null;
  const items = bundleMembers(bundleId);
  return { ...bundle, items, count: items.length };
}

// 列表（format=text 给 Agent：ash bundles）
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, (SELECT COUNT(*) FROM bundle_items bi JOIN skills s ON s.id = bi.skill_id
                 WHERE bi.bundle_id = b.id AND s.is_deleted = 0) AS count
    FROM bundles b ORDER BY b.created_at DESC
  `).all();
  if (req.query.format === 'text') {
    if (!rows.length) return res.type('text/plain').send('还没有技能组合\n');
    const lines = rows.map((b) => `${b.slug}  ·  ${b.name}  ·  ${b.count} 个技能${b.description ? `  ·  ${b.description}` : ''}`);
    return res.type('text/plain').send(`${[`共 ${rows.length} 个组合（ash bundle <标识或名称> 查看成员，ash pull bundle:<标识或名称> 安装）`, ...lines].join('\n')}\n`);
  }
  res.json(rows);
});

// 详情：:id 可以是数字 id、slug 或组合名称
router.get('/:id', (req, res) => {
  const { bundle: found, error } = findBundle(req.params.id);
  if (!found) {
    return req.query.format === 'text'
      ? res.status(404).type('text/plain').send(`错误: ${error}\n`)
      : res.status(404).json({ error: error || 'Bundle not found' });
  }
  const bundle = bundleWithItems(found.id);
  if (req.query.format === 'text') {
    const ready = bundle.items.filter((s) => s.status !== 'pending');
    const out = [
      `${bundle.name} (${bundle.slug}) · ${bundle.count} 个技能`,
      ...(bundle.description ? [`描述: ${bundle.description}`] : []),
      ...bundle.items.map((s) => `  ${s.slug}  ·  ${s.name}${s.status === 'pending' ? '  [待审核，安装时跳过]' : ''}${s.description ? `  ·  ${s.description}` : ''}`),
      `安装: ash pull bundle:${bundle.slug}    (curl -fsSL ${getBaseUrl(req)}/s/bundle/${bundle.slug}/install.sh | bash)`,
    ];
    if (!ready.length) out.push('注意: 组合内没有已发布的技能');
    return res.type('text/plain').send(`${out.join('\n')}\n`);
  }
  res.json(bundle);
});

// 创建
router.post('/', (req, res) => {
  const { name, description = '' } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '组合名称必填' });
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || `bundle-${Date.now()}`;
  let finalSlug = slug;
  let n = 2;
  while (db.prepare('SELECT 1 FROM bundles WHERE slug = ?').get(finalSlug)) finalSlug = `${slug}-${n++}`;
  const r = db.prepare('INSERT INTO bundles (slug, name, description) VALUES (?, ?, ?)').run(finalSlug, name.trim(), description);
  res.status(201).json(bundleWithItems(r.lastInsertRowid));
});

// 重命名/改描述
router.put('/:id', (req, res) => {
  const { name, description } = req.body;
  const bundle = db.prepare('SELECT * FROM bundles WHERE id = ?').get(req.params.id);
  if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
  db.prepare('UPDATE bundles SET name = ?, description = ? WHERE id = ?')
    .run(name !== undefined ? name : bundle.name, description !== undefined ? description : bundle.description, bundle.id);
  res.json(bundleWithItems(bundle.id));
});

// 删除组合（仅删组合与快捷方式，不动技能）
router.delete('/:id', (req, res) => {
  const r = db.prepare('DELETE FROM bundles WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Bundle not found' });
  res.json({ success: true, note: '仅删除组合与快捷方式，技能本身不受影响' });
});

// 添加技能（快捷方式）
router.post('/:id/skills', (req, res) => {
  const { skill_id } = req.body;
  const bundle = db.prepare('SELECT * FROM bundles WHERE id = ?').get(req.params.id);
  const skill = db.prepare('SELECT id, is_deleted FROM skills WHERE id = ?').get(skill_id);
  if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
  if (!skill || skill.is_deleted) return res.status(404).json({ error: 'Skill not found' });
  db.prepare('INSERT OR IGNORE INTO bundle_items (bundle_id, skill_id) VALUES (?, ?)').run(bundle.id, skill.id);
  res.json(bundleWithItems(bundle.id));
});

// 移除技能（快捷方式）
router.delete('/:id/skills/:skillId', (req, res) => {
  db.prepare('DELETE FROM bundle_items WHERE bundle_id = ? AND skill_id = ?').run(req.params.id, req.params.skillId);
  res.json(bundleWithItems(req.params.id));
});

module.exports = router;
