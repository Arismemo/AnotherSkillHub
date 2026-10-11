// 详情页的 markdown 渲染与代码高亮。marked / highlight.js 只在这里配置一次，
// 也只应被详情页（懒加载 chunk）引用——从首屏代码 import 会把 hljs 拖进主包。
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

marked.setOptions({ breaks: true, gfm: true });

// 只注册文件查看器与代码块实际支持的语言。未知语言会安全地显示为纯文本。
Object.entries({ bash, c, cpp, css, diff, go, ini, java, javascript, json, markdown, python, rust, scss, sql, typescript, xml, yaml })
  .forEach(([name, grammar]) => hljs.registerLanguage(name, grammar));

// 扩展名 -> highlight.js 语言（覆盖技能包常见脚本/配置类型）
const EXT_LANGUAGES = {
  sh: 'bash', bash: 'bash', zsh: 'bash',
  py: 'python',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  json: 'json',
  yaml: 'yaml', yml: 'yaml',
  md: 'markdown',
  html: 'xml', xml: 'xml', svg: 'xml',
  css: 'css', scss: 'scss',
  sql: 'sql',
  ini: 'ini', toml: 'ini', env: 'ini',
  diff: 'diff', patch: 'diff',
  go: 'go', rs: 'rust', java: 'java', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp',
};

export function languageForPath(path) {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return EXT_LANGUAGES[ext] || null;
}

function escapeHtml(text) {
  return text.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
}

export function highlightCode(code, language) {
  if (!code) return '';
  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    }
  } catch { /* 语法包异常时退回纯文本 */ }
  // 未知语言不再走 highlightAuto：它要拿每种已注册语言各试跑一遍，代价是定向高亮的 8~20 倍
  return escapeHtml(code);
}

// 把整段高亮 HTML 按换行切开，跨行的 <span> 在行尾闭合、行首重开——
// 这样既保住了跨行语法（多行字符串 / 块注释），又能沿用 CSS counter 渲染行号。
export function splitHighlightedLines(html) {
  const lines = [];
  const open = [];
  let buffer = '';
  let index = 0;
  while (index < html.length) {
    if (html[index] === '<') {
      const end = html.indexOf('>', index);
      if (end === -1) { buffer += html.slice(index); break; }
      const tag = html.slice(index, end + 1);
      if (tag.startsWith('</')) open.pop();
      else if (!tag.endsWith('/>')) open.push(tag);
      buffer += tag;
      index = end + 1;
      continue;
    }
    const next = html.indexOf('<', index);
    const text = next === -1 ? html.slice(index) : html.slice(index, next);
    const parts = text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) {
        buffer += '</span>'.repeat(open.length);
        lines.push(buffer || '&nbsp;');
        buffer = open.join('');
      }
      buffer += part;
    });
    index = next === -1 ? html.length : next;
  }
  lines.push(buffer || '&nbsp;');
  return lines;
}

// 轻量字符串哈希（djb2）：给 marked / hljs 的结果做缓存键
function hashSource(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `${hash.toString(36)}:${text.length}`;
}

// 渲染结果按内容哈希缓存（小 LRU）：来回切技能、预览↔编辑来回切都不必重跑 marked + hljs
const RENDER_CACHE = new Map();
const RENDER_CACHE_MAX = 24;
export function cachedRender(kind, source, render) {
  const key = `${kind}:${hashSource(source)}`;
  if (RENDER_CACHE.has(key)) {
    const hit = RENDER_CACHE.get(key);
    RENDER_CACHE.delete(key);
    RENDER_CACHE.set(key, hit); // 命中后移到队尾
    return hit;
  }
  const value = render(source);
  RENDER_CACHE.set(key, value);
  if (RENDER_CACHE.size > RENDER_CACHE_MAX) RENDER_CACHE.delete(RENDER_CACHE.keys().next().value);
  return value;
}

// 代码块高亮 + 语言标签：对 marked 输出的 HTML 做后处理，比覆写 renderer 稳定（marked v18）
function highlightMarkdownHtml(html) {
  if (!html) return '';
  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll('pre > code').forEach((block) => {
    const classMatch = block.className.match(/language-([\w-]+)/);
    const lang = classMatch ? classMatch[1].toLowerCase() : null;
    block.innerHTML = highlightCode(block.textContent || '', lang);
    const pre = block.parentElement;
    if (pre) {
      pre.setAttribute('data-lang', lang || 'text');
    }
  });
  return container.innerHTML;
}

// marked 不过滤原始 HTML：分享页渲染的是别人的内容，Agent 推送的内容也不可信，先净化再放进 innerHTML
// （脱离文档的 div 里 <img onerror> 照样会执行，所以必须在 highlightMarkdownHtml 之前做）
export const renderMarkdown = (source) => highlightMarkdownHtml(DOMPurify.sanitize(marked.parse(source)));
