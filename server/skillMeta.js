// 技能元数据的唯一解析规则：Agent 推送、网页新建、粘贴导入（经 /api/skills/parse 预览）全部走这里。
//   slug        显式 slug > frontmatter name > 文件名 > 正文 H1（取第一个能转成合法英文标识符的）
//   name        显式 name > 正文 H1（人话标题）> frontmatter name > 文件名 > slug
//   description 显式 > frontmatter description
//   tags        显式 > frontmatter tags（数组或逗号分隔字符串）
//   version     显式 > frontmatter version > 1.0.0
const matter = require('gray-matter');

function slugify(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function parseFrontmatter(content) {
  try {
    return { data: matter(content).data || {}, error: null };
  } catch (err) {
    return { data: {}, error: err.message };
  }
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map((t) => String(t).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((t) => t.trim()).filter(Boolean);
  return [];
}

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeSkillMeta(content, explicit = {}, { fileName = '' } = {}) {
  const { data, error: frontmatterError } = parseFrontmatter(content || '');
  const body = String(content || '').replace(/^---[\s\S]*?\n---\s*\n?/, '');
  const h1 = text((body.match(/^#\s+(.+)$/m) || [])[1]);
  const fileBase = text(fileName).replace(/\.md$/i, '');
  const usableFileBase = fileBase && !/^(skill|readme|untitled)$/i.test(fileBase) ? fileBase : '';

  const slugCandidates = [explicit.slug, data.name, usableFileBase, h1];
  let slug = '';
  for (const candidate of slugCandidates) {
    slug = slugify(candidate);
    if (slug) break;
  }

  const name = text(explicit.name) || h1 || text(data.name) || usableFileBase || slug;
  const description = text(explicit.description) || text(data.description);
  const tags = explicit.tags !== undefined ? normalizeTags(explicit.tags) : normalizeTags(data.tags);
  const version = text(explicit.version) || text(data.version) || '1.0.0';

  const errors = [];
  if (!text(content)) errors.push('技能内容为空');
  if (!slug) errors.push('无法得到英文标识符：请在 frontmatter 写英文 name（例如 name: my-skill），或显式传入 slug');
  const warnings = [];
  if (frontmatterError) warnings.push(`frontmatter 解析失败：${frontmatterError}`);
  if (!description) warnings.push('缺少 description：建议在 frontmatter 写一句「何时使用这个技能」，Agent 靠它判断是否调用');

  return { slug, name, description, tags, version, frontmatter: data, errors, warnings };
}

module.exports = { slugify, normalizeSkillMeta, normalizeTags };
