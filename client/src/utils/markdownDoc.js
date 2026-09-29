// SKILL.md 文档结构的纯函数：frontmatter 拆分 / 解析、标题提取与锚点 slug。不依赖 DOM，可直接 node --test。

export function splitFrontmatter(text) {
  if (!text) return { frontmatter: '', body: '' };
  const trimmed = text.trim();
  if (!trimmed.startsWith('---')) return { frontmatter: '', body: trimmed };
  const end = trimmed.indexOf('---', 3);
  if (end === -1) return { frontmatter: '', body: trimmed };
  return {
    frontmatter: trimmed.slice(3, end).trim(),
    body: trimmed.slice(end + 3).trim(),
  };
}

export function extractHeadings(markdown) {
  const lines = markdown.split('\n');
  const headings = [];
  let inFence = false;
  let fenceMarker = '';
  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fenceMatch[1][0];
      } else if (fenceMatch[1][0] === fenceMarker) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (match) {
      headings.push({ level: match[1].length, text: match[2].trim() });
    }
  }
  return headings;
}

export function slugifyHeading(text, used) {
  const base = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-') || 'section';
  let slug = base;
  let index = 2;
  while (used.has(slug)) {
    slug = `${base}-${index}`;
    index += 1;
  }
  used.add(slug);
  return slug;
}

// B5: frontmatter 解析为键值对表格
export function parseFrontmatterPairs(raw) {
  if (!raw) return [];
  return raw.split('\n')
    .map((line) => line.match(/^([\w-]+)\s*:\s*(.*)$/))
    .filter(Boolean)
    .map((match) => ({ key: match[1], value: match[2].replace(/^["']|["']$/g, '').trim() }))
    .filter((pair) => pair.key);
}
