const matter = require('gray-matter');
const { declaredDependencies, parseReference } = require('./skillMeta');
const { isMetaSkill, bodyReferences } = require('./skillRefs');

// Relationships come only from explicit signals: declared metadata, local links to another skill (its SKILL.md or a file
// under it), and lines that name a meta skill by its exact slug on the same line as the word 元技能 / meta-skill.
// Bare prose mentions never count. Body parsing is shared with the reference checks (skillRefs.bodyReferences).
function buildSkillGraph(skills) {
  const parsed = skills.filter((skill) => !skill.is_deleted).map((skill) => {
    let data = {}, body = skill.content || '', warning = false;
    try { const result = matter(body, {}); data = result.data; body = result.content; } catch { warning = true; }
    return { skill, data, body, warning, meta: isMetaSkill(skill, data) };
  });
  const bySlug = new Map(parsed.map((item) => [item.skill.slug, item]));
  const metaSlugs = parsed.filter((item) => item.meta).map((item) => item.skill.slug);
  const edges = [], unresolved = [];
  for (const { skill, data, body } of parsed) {
    const seen = new Set();
    const add = (slug, kind) => {
      if (slug === skill.slug || seen.has(slug)) return;
      seen.add(slug);
      const target = bySlug.get(slug);
      if (!target) { if (kind === 'dependency') unresolved.push({ source: skill.id, target: slug }); return; }
      if (target.meta) edges.push({ source: skill.id, target: target.skill.id, kind });
    };
    // 声明的依赖：@账号/slug 指向别的库，不在本库的图里；slug@版本 取 slug
    declaredDependencies(data).map(parseReference).filter((ref) => ref && !ref.owner).forEach((ref) => add(ref.slug, 'dependency'));
    // 正文引用（代码块里的示例与远程链接不算）：../x/SKILL.md、../x/references/y.md、「用元技能 `x`」
    bodyReferences(body, metaSlugs).refs.forEach((slug) => add(slug, 'reference'));
  }
  return {
    nodes: parsed.map(({ skill, meta, warning }) => ({ id: skill.id, slug: skill.slug, name: skill.name,
      description: skill.description, folder: skill.folder_path, meta, warning })),
    edges, unresolved,
  };
}

module.exports = { buildSkillGraph };
