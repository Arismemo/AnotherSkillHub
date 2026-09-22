import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js/lib/common';
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
} from 'lucide-react';

marked.setOptions({ breaks: true, gfm: true });

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

function highlightCode(code, language) {
  if (!code) return '';
  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return code.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  }
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

export default function SkillDetail({ skill, onSave, onMoveFolder, folders }) {
  const [mode, setMode] = useState('preview');
  const [content, setContent] = useState(skill.content || '');
  const [name, setName] = useState(skill.name || '');
  const [description, setDescription] = useState(skill.description || '');
  const [fileTree, setFileTree] = useState([]);
  const [selectedFile, setSelectedFile] = useState('SKILL.md');
  const [auxFileContent, setAuxFileContent] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(!skill.content);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [fileError, setFileError] = useState('');
  const [copied, setCopied] = useState('');
  const [openDirs, setOpenDirs] = useState(() => new Set());
  // D1: 面板宽度/大纲显隐持久化
  const [fileSidebarWidth, setFileSidebarWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem('skillhub:file-sidebar-width'));
    return saved >= 160 && saved <= 480 ? saved : 240;
  });
  const [outlineHidden, setOutlineHidden] = useState(() => window.localStorage.getItem('skillhub:outline-hidden') === '1');
  // A2: 文件树过滤
  const [fileFilter, setFileFilter] = useState('');
  // B1: 大纲当前高亮索引
  const [activeHeading, setActiveHeading] = useState(0);
  const scrollRef = useRef(null);
  const resizingRef = useRef(null);

  useEffect(() => {
    window.localStorage.setItem('skillhub:file-sidebar-width', String(fileSidebarWidth));
  }, [fileSidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem('skillhub:outline-hidden', outlineHidden ? '1' : '0');
  }, [outlineHidden]);

  // 技能文件栏拖拽调宽
  useEffect(() => {
    const onMove = (event) => {
      if (!resizingRef.current) return;
      const startX = resizingRef.current.startX;
      const startWidth = resizingRef.current.startWidth;
      const next = Math.min(Math.max(startWidth + event.clientX - startX, 160), 480);
      setFileSidebarWidth(next);
    };
    const onUp = () => {
      if (resizingRef.current) {
        resizingRef.current = null;
        document.body.classList.remove('is-resizing');
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startResize = (event) => {
    resizingRef.current = { startX: event.clientX, startWidth: fileSidebarWidth };
    document.body.classList.add('is-resizing');
    event.preventDefault();
  };

  useEffect(() => {
    let cancelled = false;
    getJson(`/api/skills/${skill.id}`)
      .then((detail) => {
        if (cancelled) return;
        setContent(detail.content || '');
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

  const renderedMarkdown = useMemo(
    () => highlightMarkdownHtml(marked.parse(documentParts.body || content || '')),
    [content, documentParts.body],
  );

  const auxRendered = useMemo(
    () => (selectedFile !== 'SKILL.md' && selectedFile.endsWith('.md')
      ? highlightMarkdownHtml(marked.parse(splitFrontmatter(auxFileContent || '').body || ''))
      : ''),
    [auxFileContent, selectedFile],
  );

  // 文件查看器（非 markdown）的语法高亮 HTML + 行号
  // 逐行高亮：每行包 <span class="code-line">，行号由 CSS counter 渲染
  const fileHighlightedLines = useMemo(() => {
    if (selectedFile === 'SKILL.md' || selectedFile.endsWith('.md')) return [];
    const raw = auxFileContent || '';
    if (!raw) return [];
    const language = languageForPath(selectedFile);
    const lines = raw.replace(/\n$/, '').split('\n');
    return lines.map((line) => {
      const highlighted = highlightCode(line, language);
      return highlighted || '&nbsp;';
    });
  }, [auxFileContent, selectedFile]);

  // 渲染后为标题 DOM 补 id，与大纲的 slug 保持一致（marked v18 renderer 回调
  // 内部没有 parser 引用，覆写 heading renderer 会在运行时崩溃，故改为 DOM 补丁）
  // B3: 同时为代码块注入「复制」按钮（事件委托，避免重复绑定）
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return undefined;
    const used = new Set();
    container.querySelectorAll('.markdown-document h1, .markdown-document h2, .markdown-document h3, .markdown-document h4').forEach((node) => {
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

  // B1: 大纲跟随滚动高亮（scroll-spy）：当前视口顶部所在章节即高亮项
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || headings.length < 2) return undefined;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const nodes = container.querySelectorAll('.markdown-document h1, .markdown-document h2, .markdown-document h3, .markdown-document h4');
        const containerTop = container.getBoundingClientRect().top;
        let current = 0;
        nodes.forEach((node, index) => {
          if (node.getBoundingClientRect().top - containerTop <= 60) current = index;
        });
        setActiveHeading(current);
        ticking = false;
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => container.removeEventListener('scroll', onScroll);
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
    const nodes = container.querySelectorAll('.markdown-document h1, .markdown-document h2, .markdown-document h3, .markdown-document h4');
    const target = nodes[index];
    if (!target) return;
    // offsetTop 的参照系是 offsetParent（.app-detail），不是滚动容器；
    // 用 rect 相对差值计算真实滚动位置
    const delta = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTo({ top: container.scrollTop + delta - 12, behavior: 'smooth' });
  };

  const origin = window.location.origin;
  const agentPrompt = `请加载并使用技能：${origin}/s/${skill.slug}`;
  const cliCommand = `curl -fsSL ${origin}/s/${skill.slug}/install.sh | bash`;

  const copyToClipboard = async (text, type) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      window.setTimeout(() => setCopied(''), 1800);
    } catch {
      setDetailError('复制失败，请检查浏览器的剪贴板权限。');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const saved = await onSave({ ...skill, name, description, content });
    setSaving(false);
    if (saved) setMode('preview');
  };

  const switchMode = (nextMode) => {
    if (nextMode === mode) return;
    if (nextMode === 'preview') {
      const dirty = name !== (skill.name || '') || description !== (skill.description || '') || content !== (skill.content || '');
      if (dirty) {
        handleSave();
      } else {
        setMode('preview');
      }
    } else {
      setMode('edit');
    }
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
                <button type="button" className="crumb-link" onClick={() => onMoveFolder(skill.id, skill.folder_path)} title="在目录中查看">{segment}</button>
                {i < arr.length - 1 && <i aria-hidden="true">/</i>}
              </span>
            ))}
            <i aria-hidden="true">/</i>
            <span className="crumb-current">{skill.slug}</span>
          </nav>
          <h2>{skill.name}</h2>
        </div>

        <div className="detail-actions">
          <button type="button" className="primary-button" onClick={() => copyToClipboard(agentPrompt, 'agent')}>
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
          <label className="move-select">
            <span className="sr-only">移动到文件夹</span>
            <select value={skill.folder_path} onChange={(event) => onMoveFolder(skill.id, event.target.value)}>
              <option value="inbox">收件箱</option>
              {folders.filter((folder) => folder.path !== 'inbox').map((folder) => (
                <option key={folder.path} value={folder.path}>{folder.path}</option>
              ))}
            </select>
          </label>
          <div className="mode-switch" aria-label="详情模式">
            <button type="button" className={mode === 'preview' ? 'is-active' : ''} onClick={() => switchMode('preview')} aria-pressed={mode === 'preview'}><Eye size={14} />预览</button>
            <button type="button" className={mode === 'edit' ? 'is-active' : ''} onClick={() => switchMode('edit')} aria-pressed={mode === 'edit'} disabled={saving}><Edit3 size={14} />{saving ? '保存中…' : '编辑'}</button>
          </div>
        </div>
      </header>

      <div className="detail-body">
        {fileTree.length > 1 && (
          <aside className="file-sidebar" aria-label="技能文件" style={{ width: fileSidebarWidth }}>
            <div className="attachment-heading">
              <h3 id="attachments-heading">技能文件</h3>
              <span>{fileTree.length} 个</span>
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
            <div
              className="file-sidebar-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="调整技能文件栏宽度"
              tabIndex="0"
              onMouseDown={startResize}
              onDoubleClick={() => setFileSidebarWidth(240)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') setFileSidebarWidth((w) => Math.max(160, w - 24));
                if (event.key === 'ArrowRight') setFileSidebarWidth((w) => Math.min(480, w + 24));
              }}
            />
          </aside>
        )}

        <div className="detail-scroll" ref={scrollRef}>
          {mode === 'preview' && !outlineHidden && headings.length > 1 && (
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
          {mode === 'preview' && outlineHidden && headings.length > 1 && (
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
          <div className="detail-content">
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
                    {(description || skill.tags?.length > 0) && (
                      <section className="skill-summary" aria-label="技能摘要">
                        {description && <p>{description}</p>}
                        {skill.tags?.length > 0 && <div>{skill.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
                      </section>
                    )}

                    {loadingDetail && !content ? (
                      <div className="content-skeleton" role="status"><span>正在载入技能详情…</span><i /><i /><i /><i /></div>
                    ) : content ? (
                      <article className="markdown-document">
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
              <p className="editor-hint">切换到预览时自动保存</p>
            </form>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
