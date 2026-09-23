const matter = require('gray-matter');
const { declaredDependencies } = require('./skillMeta');

const META_WORD = /元技能|meta[- ]skill/i;
const slugPatterns = new Map();
function slugPattern(slug) {
  if (!slugPatterns.has(slug)) {
    const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    slugPatterns.set(slug, new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`));
  }
  return slugPatterns.get(slug);
}

function list(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : typeof value === 'string' ? [value] : [];
}

// Relationships come only from explicit signals: declared metadata, local SKILL.md links, and lines that
// name a meta skill by its exact slug on the same line as the word 元技能 / meta-skill. Bare prose mentions never count.
function buildSkillGraph(skills) {
  const parsed = skills.filter((skill) => !skill.is_deleted).map((skill) => {
    let data = {}, body = skill.content || '', warning = false;
    try { const result = matter(body); data = result.data; body = result.content; } catch { warning = true; }
    let tags = skill.tags;
    if (typeof tags === 'string') { try { tags = JSON.parse(tags); } catch { tags = []; } }
    const meta = data.type === 'meta' || data.kind === 'meta' || data.metadata?.type === 'meta'
      || data.is_meta === true || list(tags).some((tag) => ['meta', 'meta-skill', '元技能'].includes(tag))
      || /^【元技能[·】]/.test(skill.description || '') || /(?:^|\/)元技能(?:\/|$)/.test(skill.folder_path || '');
    return { skill, data, body, warning, meta };
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
    declaredDependencies(data).forEach((slug) => add(slug, 'dependency'));
    // Local links such as ../verification-discipline/SKILL.md. Ignore fenced examples and remote URLs.
    const prose = body.replace(/^(`{3,}|~{3,}).*\n[\s\S]*?^\1[^\n]*$/gm, '');
    for (const match of prose.matchAll(/\[[^\]]*\]\(<?([^\s)>]+)(?:>?(?:\s+"[^"]*")?)\)/g)) {
      const href = match[1];
      if (/^[a-z][a-z\d+.-]*:/i.test(href)) continue;
      let path;
      try { path = decodeURIComponent(href.split(/[?#]/)[0]); } catch { continue; }
      const target = path.match(/(?:^|\/)([^/]+)\/SKILL\.md$/i);
      if (target) add(target[1], 'reference');
    }
    // 库里约定俗成的引用写法："见元技能 `verification-discipline`"、"`bench-access`（元技能）"、"see meta-skill `x`"。
    // 同一行里既有元技能关键字、又有某个元技能的完整 slug（不是更长名字的一部分）才算。
    for (const line of prose.split('\n')) {
      if (!META_WORD.test(line)) continue;
      for (const slug of metaSlugs) {
        if (slugPattern(slug).test(line)) add(slug, 'reference');
      }
    }
  }
  return {
    nodes: parsed.map(({ skill, meta, warning }) => ({ id: skill.id, slug: skill.slug, name: skill.name,
      description: skill.description, folder: skill.folder_path, meta, warning })),
    edges, unresolved,
  };
}

module.exports = { buildSkillGraph };
