import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  Eye,
  FileCode2,
  FileText,
  Folder,
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

function FileTreeNode({ node, depth, selectedFile, openFile, openDirs, toggleDir, hasSelectionInside }) {
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
        const expanded = openDirs.has(entry.path);
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
  const scrollRef = useRef(null);

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
    () => marked.parse(documentParts.body || content || ''),
    [content, documentParts.body],
  );

  const auxRendered = useMemo(
    () => (selectedFile !== 'SKILL.md' && selectedFile.endsWith('.md')
      ? marked.parse(splitFrontmatter(auxFileContent || '').body || '')
      : ''),
    [auxFileContent, selectedFile],
  );

  // 渲染后为标题 DOM 补 id，与大纲的 slug 保持一致（marked v18 renderer 回调
  // 内部没有 parser 引用，覆写 heading renderer 会在运行时崩溃，故改为 DOM 补丁）
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return undefined;
    const used = new Set();
    container.querySelectorAll('.markdown-document h1, .markdown-document h2, .markdown-document h3, .markdown-document h4').forEach((node) => {
      const text = node.textContent || '';
      node.id = slugifyHeading(text, used);
    });
    return undefined;
  }, [renderedMarkdown, auxRendered, selectedFile]);

  const treeData = useMemo(() => buildFileTree(fileTree), [fileTree]);

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

  const jumpToHeading = (id) => {
    const container = scrollRef.current;
    const target = container?.querySelector(`#${CSS.escape(id)}`);
    if (!container || !target) return;
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
          <div className="breadcrumb" aria-label="技能路径">
            <span>{skill.folder_path}</span><span aria-hidden="true">/</span><span>{skill.slug}</span>
          </div>
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
          <aside className="file-sidebar" aria-label="技能文件">
            <div className="attachment-heading">
              <h3 id="attachments-heading">技能文件</h3>
              <span>{fileTree.length} 个</span>
            </div>
            <div className="file-sidebar-scroll">
              <FileTreeNode
                node={treeData}
                depth={0}
                selectedFile={selectedFile}
                openFile={openFile}
                openDirs={openDirs}
                toggleDir={toggleDir}
                hasSelectionInside={hasSelectionInside}
              />
            </div>
          </aside>
        )}

        <div className="detail-scroll" ref={scrollRef}>
          {headings.length > 1 && (
            <nav className="doc-outline" aria-label="文档大纲">
              <div className="doc-outline-header">
                <span>大纲</span>
                <small>{headings.length} 个标题</small>
              </div>
              <ul>
                {headings.map((heading) => (
                  <li key={heading.id} style={{ '--outline-level': heading.level - 1 }}>
                    <button type="button" onClick={() => jumpToHeading(heading.id)} title={heading.text}>
                      {heading.text}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
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
                      <pre><code>{auxFileContent || '// 文件为空'}</code></pre>
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
                        {documentParts.frontmatter && (
                          <details className="frontmatter">
                            <summary>Frontmatter</summary>
                            <pre>{documentParts.frontmatter}</pre>
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
            </form>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
