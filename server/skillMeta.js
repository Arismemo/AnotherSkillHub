// 技能元数据的唯一解析规则：Agent 推送、网页新建、粘贴导入（经 /api/skills/parse 预览）全部走这里。
//   slug        显式 slug > frontmatter name > 文件名 > 正文 H1（取第一个能转成合法英文标识符的）
//   name        显式 name > 正文 H1（人话标题）> frontmatter name > 文件名 > slug
//   description 显式 > frontmatter description
//   tags        显式 > frontmatter tags（数组或逗号分隔字符串）
//   version     显式 > frontmatter version > 1.0.0
// 另有两类约定也在这里解析：
//   双语描述    description 是主描述（中英文均可），description_en / description_zh 补另一种语言
//   技能引用    depends_on: [slug, @owner/slug, slug@版本]——见 parseReference
const matter = require('gray-matter');

function slugify(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// 传入 options 对象是为了绕过 gray-matter 的内置缓存：它在解析之前就按原文缓存结果，
// 同一段坏掉的 frontmatter 第二次解析会静默返回空数据、不再报错（缓存也会随解析过的内容无限增长）
function parseFrontmatter(content) {
  try {
    return { data: matter(content, {}).data || {}, error: null };
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

function stringList(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string');
  return typeof value === 'string' ? [value] : [];
}

// frontmatter 声明的依赖（依赖图、引用检查与 ash pull 的依赖安装共用）。
// 也认 metadata 里逗号分隔的写法：Agent Skills 规范要求 metadata 的值是字符串
function declaredDependencies(data = {}) {
  const deps = [data.depends_on, data.dependencies, data.requires, data.metadata?.depends_on, data.metadata?.['depends-on']]
    .flatMap(stringList).flatMap((d) => d.split(','));
  return [...new Set(deps.map((d) => d.trim()).filter(Boolean))];
}

// 引用写法：slug（本库）、@owner/slug（指定账号，为团队库 / 技能广场预留）、slug@1.2.0（固定版本）
const REFERENCE = /^(?:@([A-Za-z0-9_.-]+)\/)?([A-Za-z0-9_.-]+)(?:@([A-Za-z0-9_.+-]+))?$/;
function parseReference(raw) {
  const value = String(raw || '').trim();
  const m = REFERENCE.exec(value);
  return m ? { raw: value, owner: m[1] || null, slug: m[2], pin: m[3] || null } : null;
}

// 技能声明的引用：{ refs: [解析后的引用], invalid: [写法不对的原文] }
function referencesOf(content) {
  const declared = declaredDependencies(parseFrontmatter(content || '').data);
  const refs = [];
  const invalid = [];
  for (const raw of declared) {
    const ref = parseReference(raw);
    if (ref) refs.push(ref); else invalid.push(raw);
  }
  return { refs, invalid };
}

// ——— 双语描述 ———
// 两种语言都有，中文任务和英文任务才都能找到它，查重也才能跨语言对上；以后网页做双语界面直接用这两个字段。
// 只要求元数据双语，不要求正文写两份：两份正文要同步维护、迟早漂移，而读正文的 Agent 本来就中英文都懂
const CJK_CHARS = /[\u3400-\u9fff\uf900-\ufaff]/g;
function languagesOf(value) {
  const s = text(value);
  return { zh: (s.match(CJK_CHARS) || []).length >= 4, en: (s.match(/[A-Za-z]{2,}/g) || []).length >= 4 };
}

function localizedMeta(data = {}) {
  const pick = (key) => text(data[key]) || text(data.metadata?.[key]) || text(data.metadata?.[key.replace('_', '-')]);
  return { description_en: pick('description_en'), description_zh: pick('description_zh'), title_en: pick('title_en'), title_zh: pick('title_zh') };
}

// 描述还缺哪种语言：['en'] / ['zh'] / []。主描述本身中英混写（例如「【元技能】… Use when …」）也算双语
function missingLanguages(description, localized = {}) {
  const { zh, en } = languagesOf([description, localized.description_en, localized.description_zh].join('\n'));
  return [!zh && 'zh', !en && 'en'].filter(Boolean);
}

const LANGUAGE_HINT = {
  en: '缺少英文描述：请在 frontmatter 加 description_en（英文任务也能找到它，也用于跨语言查重）',
  zh: '缺少中文描述：请在 frontmatter 加 description_zh（中文任务也能找到它，也用于跨语言查重）',
};

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
  const localized = localizedMeta(data);
  if (description) missingLanguages(description, localized).forEach((lang) => warnings.push(LANGUAGE_HINT[lang]));

  return { slug, name, description, tags, version, localized, frontmatter: data, errors, warnings };
}

// 安装时附在 SKILL.md 末尾的一段（见 templates/install.sh）：标记行 + 若干「> 」行（引用的技能在本机哪里、用完怎么反馈）。
// 它不属于技能内容：从本机已装目录推送回来时去掉，否则「没改过」的技能也会被当成有修改。
// 只去掉这一段——Agent 常在文件末尾（这段之后）追加修正，那些内容必须保留
const INSTALL_FOOTER_MARK = '<!-- ash:installed -->';
const INSTALL_FOOTER = /\n<!-- ash:installed -->\n(?:> [^\n]*(?:\n|$))+/g;
function stripInstallFooter(content) {
  return String(content || '').replace(INSTALL_FOOTER, '');
}

module.exports = {
  slugify, normalizeSkillMeta, normalizeTags, parseFrontmatter, declaredDependencies, parseReference, referencesOf,
  languagesOf, localizedMeta, missingLanguages, LANGUAGE_HINT, stripInstallFooter, INSTALL_FOOTER_MARK,
};
