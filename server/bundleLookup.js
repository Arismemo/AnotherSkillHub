// 组合引用解析：数字 id / slug / 名称（中文名组合的 slug 是时间戳，Agent 只能按名称找）
const db = require('./db');

function findBundle(ref) {
  const value = String(ref || '').trim();
  if (!value) return { error: '请提供组合标识或名称' };
  if (/^\d+$/.test(value)) {
    const byId = db.prepare('SELECT * FROM bundles WHERE id = ?').get(Number(value));
    if (byId) return { bundle: byId };
  }
  const bySlug = db.prepare('SELECT * FROM bundles WHERE slug = ?').get(value);
  if (bySlug) return { bundle: bySlug };
  const byName = db.prepare('SELECT * FROM bundles WHERE name = ? COLLATE NOCASE').all(value);
  if (byName.length === 1) return { bundle: byName[0] };
  if (byName.length > 1) return { error: `有 ${byName.length} 个同名组合「${value}」，请改用标识：${byName.map((b) => b.slug).join(', ')}` };
  return { error: `技能组合「${value}」不存在（ash bundles 查看全部组合）` };
}

function bundleMembers(bundleId) {
  return db.prepare(`
    SELECT s.id, s.slug, s.name, s.description, s.status, bi.added_at
    FROM bundle_items bi JOIN skills s ON s.id = bi.skill_id
    WHERE bi.bundle_id = ? AND s.is_deleted = 0
    ORDER BY bi.added_at DESC
  `).all(bundleId);
}

module.exports = { findBundle, bundleMembers };
