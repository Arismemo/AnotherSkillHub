import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
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
import { VersionHistoryModal } from './Modals';
import { showToast } from './toastBus';
import useResizableWidth from '../hooks/useResizableWidth';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileCode2,
  FileText,
  Folder,
  List,
  Terminal,
  History,
  MoreHorizontal,
  PanelLeftClose,
} from 'lucide-react';

marked.setOptions({ breaks: true, gfm: true });

// 只注册文件查看器与代码块实际支持的语言。未知语言会安全地显示为纯文本。
Object.entries({ bash, c, cpp, css, diff, go, ini, java, javascript, json, markdown, python, rust, scss, sql, typescript, xml, yaml })
  .forEach(([name, grammar]) => hljs.registerLanguage(name, grammar));

// 悬浮大纲的视口阈值：与 index.css 的 .doc-outline 收窄断点保持一致
const OUTLINE_MIN_VIEWPORT = '(min-width: 1280px)';

const HEADING_SELECTOR = '.markdown-document h1, .markdown-document h2, .markdown-document h3, .markdown-document h4';

function relativeTime(value) {
  const stamp = new Date(value).getTime();
  if (!Number.isFinite(stamp)) return '';
  const minutes = Math.round((Date.now() - stamp) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(stamp);
}

function splitFrontmatter(text) {
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

function extractHeadings(markdown) {
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

function slugifyHeading(text, used) {
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
function parseFrontmatterPairs(raw) {
  if (!raw) return [];
  return raw.split('\n')
    .map((line) => line.match(/^([\w-]+)\s*:\s*(.*)$/))
    .filter(Boolean)
    .map((match) => ({ key: match[1], value: match[2].replace(/^["']|["']$/g, '').trim() }))
    .filter((pair) => pair.key);
}

function buildFileTree(files) {
  const root = { name: '', path: '', children: new Map(), file: null };
  for (const file of files) {
    const parts = file.path.split('/');
    let node = root;
    parts.forEach((part, depth) => {
      const isLeaf = depth === parts.length - 1;
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, path: parts.slice(0, depth + 1).join('/'), children: new Map(), file: null });
      }
      node = node.children.get(part);
      if (isLeaf) node.file = file;
    });
  }
  return root;
}

function FileTreeNode({ node, depth, selectedFile, openFile, openDirs, toggleDir, hasSelectionInside, filterActive }) {
  const dirEntries = [...node.children.values()].sort((a, b) => {
    const aDir = a.children.size > 0;
    const bDir = b.children.size > 0;
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <ul className="file-tree" role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? '技能文件目录' : undefined}>
      {dirEntries.map((entry) => {
        const isDir = entry.children.size > 0;
        // 过滤激活时强制展开所有目录，保证匹配文件可见
        const expanded = filterActive || openDirs.has(entry.path);
        if (isDir) {
          return (
            <li key={entry.path} role="none">
              <button
                type="button"
                className="file-tree-row file-tree-dir"
                style={{ '--tree-depth': depth }}
                aria-expanded={expanded}
                onClick={() => toggleDir(entry.path)}
              >
                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Folder size={13} />
                <span>{entry.name}</span>
              </button>
              {(expanded || hasSelectionInside(entry)) && (
                <FileTreeNode
                  node={entry}
                  depth={depth + 1}
                  selectedFile={selectedFile}
                  openFile={openFile}
                  openDirs={openDirs}
                  toggleDir={toggleDir}
                  hasSelectionInside={hasSelectionInside}
                  filterActive={filterActive}
                />
              )}
            </li>
          );
        }
        const file = entry.file;
        const active = selectedFile === file.path;
        return (
          <li key={file.path} role="none">
            <button
              type="button"
              role="treeitem"
              aria-selected={active}
              className={`file-tree-row file-tree-file${active ? ' is-active' : ''}`}
              style={{ '--tree-depth': depth }}
              onClick={() => openFile(file.path)}
            >
              <span className="file-tree-leaf-spacer" aria-hidden="true" />
              {file.isMain || file.path.endsWith('.md') ? <FileText size={13} /> : <FileCode2 size={13} />}
              <span>{file.name}</span>
              <small>{Math.max(1, Math.round(file.size / 1024))} KB</small>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

async function getJson(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

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

function languageForPath(path) {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return EXT_LANGUAGES[ext] || null;
}

function escapeHtml(text) {
  return text.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
}

function highlightCode(code, language) {
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
function splitHighlightedLines(html) {
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
function cachedRender(kind, source, render) {
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

const renderMarkdown = (source) => highlightMarkdownHtml(marked.parse(source));

export default function SkillDetail({ skill, onSave, onSelectFolder, onSelectTag, onCopySkill, apiRef }) {
  const [mode, setMode] = useState('preview');
  const [content, setContent] = useState('');
  // 列表接口不再回传 content，详情接口是唯一来源；savedContent 是「服务端上那一份」，用来判 dirty
  const [savedContent, setSavedContent] = useState('');
  const [name, setName] = useState(skill.name || '');
  const [description, setDescription] = useState(skill.description || '');
  const [fileTree, setFileTree] = useState([]);
  const [selectedFile, setSelectedFile] = useState('SKILL.md');
  // 非 md 文件（脚本/json 等）用宽版式：代码行普遍较长，40rem 窄列反而难读
  const isWideFileView = selectedFile !== 'SKILL.md' && !selectedFile.endsWith('.md');
  const [auxFileContent, setAuxFileContent] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [fileError, setFileError] = useState('');
  const [copied, setCopied] = useState('');
  const [openDirs, setOpenDirs] = useState(() => new Set());
  // D1: 面板宽度/大纲显隐持久化
  const [fileSidebarWidth, , fileSidebarResizer] = useResizableWidth('file-sidebar-width', { min: 160, max: 480, initial: 240, label: '调整技能文件栏宽度' });
  const [showVersions, setShowVersions] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [outlineHidden, setOutlineHidden] = useState(() => window.localStorage.getItem('ash:outline-hidden') === '1');
  // 大纲按「视口宽度」判定，而不是滚动区宽度：滚动区永远是视口减去左两栏，
  // 用它做阈值会让大纲在 1684px 以下的视口里永远不出现。
  const [outlineFits, setOutlineFits] = useState(() => window.matchMedia(OUTLINE_MIN_VIEWPORT).matches);
  // 文件栏在滚动区 <640px 时自动收成细条（点击恢复），正文优先
  const [fileBarCollapsed, setFileBarCollapsed] = useState(false);
  const fileBarManualRef = useRef(false); // 用户手动展开过则不再自动收起
  // A2: 文件树过滤
  const [fileFilter, setFileFilter] = useState('');
  // B1: 大纲当前高亮索引
  const [activeHeading, setActiveHeading] = useState(0);
  const scrollRef = useRef(null);

  useEffect(() => {
    const query = window.matchMedia(OUTLINE_MIN_VIEWPORT);
    const sync = () => setOutlineFits(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (el.getBoundingClientRect().width < 760 && !fileBarManualRef.current) setFileBarCollapsed(true);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    window.localStorage.setItem('ash:outline-hidden', outlineHidden ? '1' : '0');
  }, [outlineHidden]);

  // 溢出菜单：点外部或按 Esc 关闭
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onPointerDown = (event) => { if (!event.target.closest('.detail-more')) setMoreOpen(false); };
    const onKeyDown = (event) => { if (event.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moreOpen]);

  useEffect(() => {
    let cancelled = false;
    getJson(`/api/skills/${skill.id}`)
      .then((detail) => {
        if (cancelled) return;
        const next = detail.content || '';
        // 内容没变就别换引用：否则 renderedMarkdown 的 useMemo 会白跑一遍 marked + hljs
        setContent((prev) => (prev === next ? prev : next));
        setSavedContent(next);
        setName(detail.name || '');
        setDescription(detail.description || '');
        setFileTree(Array.isArray(detail.file_tree) ? detail.file_tree : []);
      })
      .catch((error) => {
        if (!cancelled) setDetailError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skill.id]);

  useEffect(() => {
    if (selectedFile === 'SKILL.md') return undefined;
    let cancelled = false;
    getJson(`/api/skills/${skill.id}/file?path=${encodeURIComponent(selectedFile)}`)
      .then((data) => {
        if (!cancelled) setAuxFileContent(data.content || '');
      })
      .catch((error) => {
        if (!cancelled) setFileError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingFile(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedFile, skill.id]);

  const documentParts = useMemo(() => splitFrontmatter(content), [content]);

  // 大纲跟随当前查看的文件：SKILL.md 用主文档；其他 .md 用附件内容；非 markdown 不出大纲
  const activeMarkdownBody = useMemo(() => {
    if (selectedFile === 'SKILL.md') return documentParts.body || '';
    if (selectedFile.endsWith('.md')) return splitFrontmatter(auxFileContent || '').body || '';
    return '';
  }, [selectedFile, documentParts.body, auxFileContent]);

  const headings = useMemo(() => {
    const used = new Set();
    return extractHeadings(activeMarkdownBody).map((heading) => ({
      ...heading,
      id: slugifyHeading(heading.text, used),
    }));
  }, [activeMarkdownBody]);

  // 编辑模式下正文不上屏，但 content 每敲一个字符都会变——不短路就是每按一键跑一次 marked + hljs
  const renderedMarkdown = useMemo(
    () => (mode === 'edit' ? '' : cachedRender('md', documentParts.body || content || '', renderMarkdown)),
    [content, documentParts.body, mode],
  );

  const auxRendered = useMemo(
    () => (selectedFile !== 'SKILL.md' && selectedFile.endsWith('.md')
      ? cachedRender('md', splitFrontmatter(auxFileContent || '').body || '', renderMarkdown)
      : ''),
    [auxFileContent, selectedFile],
  );

  // 文件查看器（非 markdown）的语法高亮 HTML + 行号
  // 整文件高亮一次再按行切开，行号仍由 CSS counter 渲染
  const fileHighlightedLines = useMemo(() => {
    if (selectedFile === 'SKILL.md' || selectedFile.endsWith('.md')) return [];
    const raw = (auxFileContent || '').replace(/\n$/, '');
    if (!raw) return [];
    const language = languageForPath(selectedFile);
    return cachedRender(
      `file:${language || 'text'}`,
      raw,
      (text) => splitHighlightedLines(highlightCode(text, language)),
    );
  }, [auxFileContent, selectedFile]);

  // 渲染后为标题 DOM 补 id，与大纲的 slug 保持一致（marked v18 renderer 回调
  // 内部没有 parser 引用，覆写 heading renderer 会在运行时崩溃，故改为 DOM 补丁）
  // B3: 同时为代码块注入「复制」按钮（事件委托，避免重复绑定）
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return undefined;
    const used = new Set();
    container.querySelectorAll(HEADING_SELECTOR).forEach((node) => {
      const text = node.textContent || '';
      node.id = slugifyHeading(text, used);
    });
    container.querySelectorAll('.markdown-document pre[data-lang], .file-viewer pre[data-lang]').forEach((pre) => {
      if (pre.querySelector('.code-copy')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-copy';
      btn.textContent = '复制';
      btn.setAttribute('aria-label', '复制代码');
      btn.addEventListener('click', async () => {
        const code = pre.querySelector('code')?.textContent || '';
        try {
          await navigator.clipboard.writeText(code);
          btn.textContent = '已复制';
          btn.classList.add('is-copied');
          window.setTimeout(() => {
            btn.textContent = '复制';
            btn.classList.remove('is-copied');
          }, 1600);
        } catch { /* 剪贴板不可用时静默 */ }
      });
      pre.appendChild(btn);
    });
    return undefined;
  }, [renderedMarkdown, auxRendered, selectedFile, mode]);

  // B1: 大纲跟随滚动高亮（scroll-spy）
  // 原实现每帧 querySelectorAll + 逐标题 getBoundingClientRect——每次滚动都强制同步布局。
  // 改成：标题位置只在内容/尺寸变化时量一次，滚动中只比 scrollTop，零 rect 读取。
  const headingOffsetsRef = useRef([]);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || headings.length < 2) return undefined;

    const measure = () => {
      const containerTop = container.getBoundingClientRect().top;
      headingOffsetsRef.current = [...container.querySelectorAll(HEADING_SELECTOR)]
        .map((node) => node.getBoundingClientRect().top - containerTop + container.scrollTop);
    };

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        ticking = false;
        const offsets = headingOffsetsRef.current;
        if (!offsets.length) return;
        const line = container.scrollTop + 60;
        let current = 0;
        for (let i = 0; i < offsets.length; i += 1) {
          if (offsets[i] <= line) current = i;
        }
        // 滚动到底时高亮最后一个标题（末尾内容不足一屏时永远差一点）
        if (container.scrollTop + container.clientHeight >= container.scrollHeight - 4) {
          current = offsets.length - 1;
        }
        setActiveHeading(current);
      });
    };

    measure();
    onScroll();
    container.addEventListener('scroll', onScroll, { passive: true });
    // 字体/图片加载或面板改宽都会挪动标题：重量一次，仍然不碰滚动路径
    const content = container.querySelector('.detail-content');
    const observer = content && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => { measure(); onScroll(); })
      : null;
    if (observer && content) observer.observe(content);
    return () => {
      container.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  }, [headings.length, renderedMarkdown, auxRendered, selectedFile, mode]);

  const treeData = useMemo(() => buildFileTree(fileTree), [fileTree]);

  // A2: 文件树过滤（含路径子串匹配）
  const filteredTreeData = useMemo(() => {
    const q = fileFilter.trim().toLowerCase();
    if (!q) return treeData;
    const filtered = fileTree.filter((f) => f.path.toLowerCase().includes(q));
    return buildFileTree(filtered);
  }, [treeData, fileFilter, fileTree]);

  // B5: frontmatter 键值对
  const frontmatterPairs = useMemo(() => parseFrontmatterPairs(documentParts.frontmatter), [documentParts.frontmatter]);

  const toggleDir = (dirPath) => {
    setOpenDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  };

  const hasSelectionInside = (node) => {
    if (!selectedFile) return false;
    if (node.file && node.file.path === selectedFile) return true;
    for (const child of node.children.values()) {
      if (hasSelectionInside(child)) return true;
    }
    return false;
  };

  const jumpToHeading = (index) => {
    const container = scrollRef.current;
    if (!container) return;
    const nodes = container.querySelectorAll(HEADING_SELECTOR);
    const target = nodes[index];
    if (!target) return;
    // offsetTop 的参照系是 offsetParent（.app-detail），不是滚动容器；
    // 用 rect 相对差值计算真实滚动位置
    const delta = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
    // 末尾标题补位：确保即使内容不足也能把标题滚到视口上部
    const needed = container.scrollTop + delta - 12;
    const maxScroll = container.scrollHeight - container.clientHeight;
    if (needed > maxScroll) {
      // 动态撑高底部 padding，让最后标题可达
      const content = container.querySelector('.detail-content');
      if (content) {
        const extra = needed - maxScroll;
        content.style.paddingBottom = `${Math.round(extra + 3 * 16)}px`;
        window.requestAnimationFrame(() => container.scrollTo({ top: needed, behavior: 'smooth' }));
        return;
      }
    }
    container.scrollTo({ top: container.scrollTop + delta - 12, behavior: 'smooth' });
  };

  const origin = window.location.origin;
  const agentPrompt = `请加载并使用技能：${origin}/s/${skill.slug}`;
  const cliCommand = `curl -fsSL ${origin}/s/${skill.slug}/install.sh | bash`;

  const copyToClipboard = async (text, type, toastLabel) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      if (toastLabel) showToast(`已复制${toastLabel}：${text}`);
      window.setTimeout(() => setCopied(''), 1800);
    } catch {
      setDetailError('复制失败，请检查浏览器的剪贴板权限。');
    }
  };

  const dirty = name !== (skill.name || '') || description !== (skill.description || '') || content !== savedContent;

  const handleSave = async () => {
    setSaving(true);
    const saved = await onSave({ ...skill, name, description, content });
    setSaving(false);
    if (saved) {
      setSavedContent(content);
      setMode('preview');
    }
  };

  const switchMode = (nextMode) => {
    if (nextMode === mode) return;
    if (nextMode === 'preview') {
      if (dirty) {
        handleSave();
      } else {
        setMode('preview');
      }
    } else {
      setMode('edit');
    }
  };

  // ⌘S / ⌘E 走 App 的统一快捷键注册表，这里只对外暴露动作
  const liveRef = useRef(null);
  useEffect(() => {
    liveRef.current = { mode, dirty, save: handleSave, toggleMode: () => switchMode(mode === 'edit' ? 'preview' : 'edit') };
    if (apiRef) apiRef.current = liveRef.current;
  });
  useEffect(() => () => { if (apiRef) apiRef.current = null; }, [apiRef]);

  // App 用 key={skill.id} 挂载本组件，切换技能会整体重挂载：
  // 编辑中的改动不能静默丢弃，与「切到预览自动保存」保持同一语义，卸载时补存一次。
  useEffect(() => () => {
    const live = liveRef.current;
    if (live?.mode === 'edit' && live.dirty) live.save();
  }, []);

  // 附属文件单独下载：/api/skills/:id/file 返回 JSON 包装，直接做成本地 Blob 更省事
  const downloadCurrentFile = () => {
    const url = URL.createObjectURL(new Blob([auxFileContent], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = selectedFile.split('/').pop();
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const openFile = (path) => {
    setFileError('');
    setAuxFileContent('');
    setSelectedFile(path);
    if (path !== 'SKILL.md') setLoadingFile(true);
  };

  return (
    <div className="detail-panel">
      <header className="detail-toolbar">
        <div className="detail-identity">
          <nav className="breadcrumb" aria-label="技能路径">
            {skill.folder_path.split('/').map((segment, i, arr) => (
              <span key={`${segment}-${i}`} className="crumb-segment">
                {/* 面包屑是导航：跳到该层目录，而不是把技能移动到它自己的目录 */}
                    <button type="button" className="crumb-link" onClick={() => onSelectFolder?.(arr.slice(0, i + 1).join('/'))} title={`在目录中查看：${arr.slice(0, i + 1).join('/')}`}>{segment}</button>
                {i < arr.length - 1 && <ChevronRight size={11} className="crumb-sep" aria-hidden="true" />}
              </span>
            ))}
            <ChevronRight size={11} className="crumb-sep" aria-hidden="true" />
            <span className="crumb-current">{skill.slug}</span>
          </nav>
          <h2 title={skill.name}>{skill.name}</h2>
        </div>

        {/* 头部中段原来是一大片空白：放只读身份信息（版本 / 更新时间 / 文件数 / 来源终端） */}
        <div className="detail-meta" aria-label="技能信息">
          {skill.version && <span className="chip" title={`版本 ${skill.version}`}>v{skill.version}</span>}
          {skill.updated_at && <span title={`更新于 ${skill.updated_at}`}>{relativeTime(skill.updated_at)}</span>}
          {fileTree.length > 1 && <span>{fileTree.length} 个文件</span>}
          {skill.terminal_source && <span className="chip row-source" title={`来自终端 ${skill.terminal_source}`}>{skill.terminal_source}</span>}
        </div>

        <div className="detail-actions">
          <button type="button" className="secondary-button" onClick={() => copyToClipboard(agentPrompt, 'agent')}>
            {copied === 'agent' ? <Check size={14} /> : <Copy size={14} />}
            {copied === 'agent' ? '已复制' : '复制 Agent 指令'}
          </button>
          <button type="button" className="secondary-button compact-action" onClick={() => copyToClipboard(cliCommand, 'cli')}>
            {copied === 'cli' ? <Check size={14} /> : <Terminal size={14} />}
            <span>{copied === 'cli' ? '已复制' : '复制 CLI'}</span>
          </button>
          <a className="icon-button bordered-button" href={`/s/${skill.slug}/archive.tar.gz`} download aria-label={`下载 ${skill.name} 完整技能包`}>
            <Download size={15} />
          </a>
          <button type="button" className="icon-button bordered-button" onClick={() => setShowVersions(true)} aria-label="历史版本" title="历史版本">
            <History size={15} />
          </button>
          {/* 溢出菜单：一键取值（slug / 路径 / 链接）与「复制技能」——后者后端早有 API，前端一直没入口 */}
          <div className="folder-menu-wrap detail-more">
            <button
              type="button"
              className="icon-button bordered-button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-label="更多操作"
              aria-expanded={moreOpen}
              title="更多操作"
            >
              <MoreHorizontal size={15} />
            </button>
            {moreOpen && (
              <div className="folder-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onCopySkill?.(skill.id); }}>复制为新技能</button>
                <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); copyToClipboard(skill.slug, 'slug', 'slug'); }}>复制 slug</button>
                <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); copyToClipboard(`${skill.folder_path}/${skill.slug}`, 'path', '仓库路径'); }}>复制仓库路径</button>
                <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); copyToClipboard(`[${skill.name}](${origin}/s/${skill.slug})`, 'link', 'Markdown 链接'); }}>复制 Markdown 链接</button>
                {selectedFile !== 'SKILL.md' && (
                  <>
                    <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); copyToClipboard(auxFileContent, 'file'); showToast(`已复制 ${selectedFile} 的内容`); }}>复制当前文件内容</button>
                    <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); downloadCurrentFile(); }}>下载当前文件</button>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="mode-switch" aria-label="详情模式">
            <button type="button" className={mode === 'preview' ? 'is-active' : ''} onClick={() => switchMode('preview')} aria-pressed={mode === 'preview'}><Eye size={14} />预览</button>
            <button type="button" className={`${mode === 'edit' ? 'is-active' : ''}${dirty ? ' is-dirty' : ''}`} onClick={() => switchMode('edit')} aria-pressed={mode === 'edit'} disabled={saving} title={dirty ? '有未保存的修改（⌘S 保存）' : '编辑（E）'}><Edit3 size={14} />{saving ? '保存中…' : '编辑'}{dirty && <i className="dirty-dot" aria-label="有未保存的修改" />}</button>
          </div>
        </div>
      </header>
      <VersionHistoryModal isOpen={showVersions} onClose={() => setShowVersions(false)} skillId={skill.id} onRestored={async () => {
            const fresh = await fetch(`/api/skills/${skill.id}`).then((r) => r.json()).catch(() => null);
            if (fresh) { setContent(fresh.content || ''); setSavedContent(fresh.content || ''); }
          }} />

      <div className="detail-body">
        {fileTree.length > 1 && fileBarCollapsed && (
          <button
            type="button"
            className="file-sidebar-rail"
            onClick={() => { fileBarManualRef.current = true; setFileBarCollapsed(false); }}
            aria-label={`展开技能文件（${fileTree.length} 个）`}
            title="展开技能文件"
          >
            <span className="rail-count">{fileTree.length}</span>
            <span className="rail-label">文件</span>
          </button>
        )}
        {fileTree.length > 1 && !fileBarCollapsed && (
          <aside className="file-sidebar" aria-label="技能文件" style={{ '--file-sidebar-w': `${fileSidebarWidth}px` }}>
            <div className="attachment-heading">
              <h3 id="attachments-heading">技能文件</h3>
              <span>{fileTree.length} 个</span>
              <button type="button" className="icon-button" onClick={() => { fileBarManualRef.current = false; setFileBarCollapsed(true); }} aria-label="收起技能文件" title="收起技能文件">
                <PanelLeftClose size={13} />
              </button>
            </div>
            <div className="file-filter">
              <input
                type="search"
                value={fileFilter}
                onChange={(event) => setFileFilter(event.target.value)}
                placeholder="过滤文件…"
                aria-label="过滤技能文件"
              />
            </div>
            <div className="file-sidebar-scroll">
              <FileTreeNode
                node={filteredTreeData}
                depth={0}
                selectedFile={selectedFile}
                openFile={openFile}
                openDirs={openDirs}
                toggleDir={toggleDir}
                hasSelectionInside={hasSelectionInside}
                filterActive={Boolean(fileFilter.trim())}
              />
              {fileFilter.trim() && filteredTreeData.children.size === 0 && (
                <p className="file-filter-empty">没有匹配「{fileFilter.trim()}」的文件</p>
              )}
            </div>
            <div {...fileSidebarResizer} />
          </aside>
        )}

        <div className={`detail-scroll${mode === 'preview' && !outlineHidden && outlineFits && headings.length > 1 ? ' has-outline' : ''}`} ref={scrollRef}>
          {mode === 'preview' && !outlineHidden && outlineFits && headings.length > 1 && (
            <nav className="doc-outline" aria-label="文档大纲">
              <div className="doc-outline-header">
                <span>大纲</span>
                <button
                  type="button"
                  className="doc-outline-toggle"
                  onClick={() => setOutlineHidden(true)}
                  aria-label="隐藏大纲"
                  title="隐藏大纲"
                >
                  <EyeOff size={13} />
                </button>
              </div>
              <ul>
                {headings.map((heading, index) => (
                  <li key={heading.id} className={index === activeHeading ? 'is-active' : ''} style={{ '--outline-level': heading.level - 1 }}>
                    <button type="button" onClick={() => jumpToHeading(index)} title={heading.text}>
                      {heading.text}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          {mode === 'preview' && outlineHidden && outlineFits && headings.length > 1 && (
            <button
              type="button"
              className="doc-outline-restore"
              onClick={() => setOutlineHidden(false)}
              aria-label="显示大纲"
              title="显示大纲"
            >
              <List size={14} />
            </button>
          )}
          <div className={`detail-content${isWideFileView ? ' is-wide-file' : ''}`}>
            <div className="sr-only" aria-live="polite">{copied ? '内容已复制' : ''}</div>
            {detailError && <div className="inline-error" role="alert">{detailError}</div>}

            {mode === 'preview' ? (
              <>
                {selectedFile !== 'SKILL.md' ? (
                  <section className="file-viewer" aria-label={selectedFile}>
                    <header>
                      <div><FileCode2 size={15} /><strong>{selectedFile}</strong></div>
                      <button type="button" onClick={() => openFile('SKILL.md')}>返回说明</button>
                    </header>
                    {loadingFile ? (
                      <div className="content-skeleton" role="status"><span>正在载入文件…</span><i /><i /><i /></div>
                    ) : fileError ? (
                      <div className="inline-error" role="alert">{fileError}</div>
                    ) : selectedFile.endsWith('.md') ? (
                      <div className="file-viewer-markdown markdown-document">
                        <div dangerouslySetInnerHTML={{ __html: auxRendered }} />
                      </div>
                    ) : (
                      <pre className="code-with-linenos" data-lang={languageForPath(selectedFile) || (selectedFile.split('.').pop() || 'text')}><code>
                        {fileHighlightedLines.length > 0
                          ? fileHighlightedLines.map((line, i) => (<span key={i} className="code-line" dangerouslySetInnerHTML={{ __html: line }} />))
                          : '// 文件为空'}
                      </code></pre>
                    )}
                  </section>
                ) : (
                  <>
                    {(description || skill.tags?.length > 0 || frontmatterPairs.length > 0) && (
                      <section className="skill-summary" aria-label="技能摘要">
                        {description && <p>{description}</p>}
                        {skill.tags?.length > 0 && (
                        <div>
                          {/* 标签可点直接筛选：原来只能记住名字再去侧栏下拉里找（4~5 步） */}
                          {skill.tags.map((tag) => (
                            <button key={tag} type="button" onClick={() => onSelectTag?.(tag)} title={`筛选标签 ${tag}`}>{tag}</button>
                          ))}
                        </div>
                      )}
                        {frontmatterPairs.length > 0 && (
                          <details className="frontmatter frontmatter-table">
                            <summary>属性</summary>
                            <table>
                              <tbody>
                                {frontmatterPairs.map((pair) => (
                                  <tr key={pair.key}>
                                    <th>{pair.key}</th>
                                    <td>{pair.value}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </details>
                        )}
                      </section>
                    )}

                    {loadingDetail && !content ? (
                      <div className="content-skeleton" role="status"><span>正在载入技能详情…</span><i /><i /><i /><i /></div>
                    ) : content ? (
                      <article className="markdown-document">
                        <div dangerouslySetInnerHTML={{ __html: renderedMarkdown }} />
                      </article>
                    ) : (
                      <div className="detail-state">
                        <strong>暂无正文</strong>
                        <span>切换到编辑模式添加 SKILL.md 内容。</span>
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
            <form className="skill-editor" onSubmit={(event) => { event.preventDefault(); handleSave(); }}>
              <div className="editor-fields">
                <label>技能名称<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
                <label>简短描述<input value={description} onChange={(event) => setDescription(event.target.value)} /></label>
              </div>
              <label>SKILL.md<textarea value={content} onChange={(event) => setContent(event.target.value)} rows={24} spellCheck="false" /></label>
              <p className="editor-hint">⌘S 保存 · 切换到预览时也会自动保存</p>
            </form>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
