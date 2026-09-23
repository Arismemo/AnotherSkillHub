const matter = require('gray-matter');

function list(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : typeof value === 'string' ? [value] : [];
}

// Only declared metadata and explicit SKILL.md links are relationships, never prose mentions.
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
    for (const value of [data.depends_on, data.dependencies, data.requires, data.metadata?.depends_on]) {
      list(value).forEach((slug) => add(slug, 'dependency'));
    }
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
  }
  return {
    nodes: parsed.map(({ skill, meta, warning }) => ({ id: skill.id, slug: skill.slug, name: skill.name,
      description: skill.description, folder: skill.folder_path, meta, warning })),
    edges, unresolved,
  };
}

module.exports = { buildSkillGraph };
