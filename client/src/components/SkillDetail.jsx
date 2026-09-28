import { useEffect, useMemo, useRef, useState } from 'react';
import { VersionHistoryModal } from './Modals';
import ReviewPanel from './ReviewPanel';
import DetailToolbar from './detail/DetailToolbar';
import FileTreeSidebar from './detail/FileTreeSidebar';
import { showToast } from './toastBus';
import { requestJson } from '../utils/requestJson';
import { extractHeadings, parseFrontmatterPairs, slugifyHeading, splitFrontmatter } from '../utils/markdownDoc';
import { cachedRender, highlightCode, languageForPath, renderMarkdown, splitHighlightedLines } from '../utils/highlight';
import {
  EyeOff,
  FileCode2,
  List,
} from 'lucide-react';

// 悬浮大纲的视口阈值：与 index.css 的 .doc-outline 收窄断点保持一致
const OUTLINE_MIN_VIEWPORT = '(min-width: 1280px)';

const HEADING_SELECTOR = '.markdown-document h1, .markdown-document h2, .markdown-document h3, .markdown-document h4';

function readSkillDraft(skillId) {
  try {
    const draft = JSON.parse(window.localStorage.getItem(`ash:skill-draft:${skillId}`));
    if (draft && typeof draft.name === 'string' && typeof draft.description === 'string' && typeof draft.content === 'string') return draft;
  } catch { /* 存储不可用或草稿损坏时从服务端继续载入 */ }
  return null;
}

export default function SkillDetail({ skill, onSave, onSelectFolder, onSelectTag, onCopySkill, onChanged, apiRef }) {
  const [mode, setMode] = useState('preview');
  const [content, setContent] = useState('');
  // 列表接口不再回传 content，详情接口是唯一来源；savedContent 是「服务端上那一份」，用来判 dirty
  const [savedContent, setSavedContent] = useState('');
  const [savedName, setSavedName] = useState(skill.name || '');
  const [savedDescription, setSavedDescription] = useState(skill.description || '');
  const [name, setName] = useState(skill.name || '');
  const [description, setDescription] = useState(skill.description || '');
  const [fileTree, setFileTree] = useState([]);
  const [selectedFile, setSelectedFile] = useState('SKILL.md');
  // 非 md 文件（脚本/json 等）用宽版式：代码行普遍较长，40rem 窄列反而难读
  const isWideFileView = selectedFile !== 'SKILL.md' && !selectedFile.endsWith('.md');
  const [auxFileContent, setAuxFileContent] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(true);
  // 审核相关字段（状态 / 待审更新 / 安全提醒）；审核操作后 reloadKey 触发重新拉取详情
  const [reviewDetail, setReviewDetail] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [fileError, setFileError] = useState('');
  const [copied, setCopied] = useState('');
  // D1: 大纲显隐持久化
  const [showVersions, setShowVersions] = useState(false);
  const [outlineHidden, setOutlineHidden] = useState(() => {
    try { return window.localStorage.getItem('ash:outline-hidden') === '1'; }
    catch { return false; }
  });
  // 大纲按「视口宽度」判定，而不是滚动区宽度：滚动区永远是视口减去左两栏，
  // 用它做阈值会让大纲在 1684px 以下的视口里永远不出现。
  const [outlineFits, setOutlineFits] = useState(() => window.matchMedia(OUTLINE_MIN_VIEWPORT).matches);
  // 文件栏在滚动区 <640px 时自动收成细条（点击恢复），正文优先
  const [fileBarCollapsed, setFileBarCollapsed] = useState(false);
  const fileBarManualRef = useRef(false); // 用户手动展开过则不再自动收起
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
    try { window.localStorage.setItem('ash:outline-hidden', outlineHidden ? '1' : '0'); }
    catch { /* 存储不可用时仍可在当前会话切换大纲 */ }
  }, [outlineHidden]);

  useEffect(() => {
    let cancelled = false;
    requestJson(`/api/skills/${skill.id}`)
      .then((detail) => {
        if (cancelled) return;
        const next = detail.content || '';
        const nextName = detail.name || '';
        const nextDescription = detail.description || '';
        const draft = readSkillDraft(skill.id);
        const restoreDraft = draft && (draft.content !== next || draft.name !== nextName || draft.description !== nextDescription);
        // 草稿来自本机持久化；切技能或刷新后继续编辑，不依赖卸载时的异步补存是否成功。
        setContent((prev) => prev === (restoreDraft ? draft.content : next) ? prev : (restoreDraft ? draft.content : next));
        setSavedContent(next);
        setSavedName(nextName);
        setSavedDescription(nextDescription);
        setName(restoreDraft ? draft.name : nextName);
        setDescription(restoreDraft ? draft.description : nextDescription);
        if (restoreDraft) setMode('edit');
        setFileTree(Array.isArray(detail.file_tree) ? detail.file_tree : []);
        setReviewDetail(detail);
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
  }, [skill.id, reloadKey]);

  useEffect(() => {
    if (selectedFile === 'SKILL.md') return undefined;
    let cancelled = false;
    requestJson(`/api/skills/${skill.id}/file?path=${encodeURIComponent(selectedFile)}`)
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

  // B5: frontmatter 键值对
  const frontmatterPairs = useMemo(() => parseFrontmatterPairs(documentParts.frontmatter), [documentParts.frontmatter]);

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

  const dirty = name !== savedName || description !== savedDescription || content !== savedContent;

  useEffect(() => {
    if (loadingDetail) return;
    try {
      const key = `ash:skill-draft:${skill.id}`;
      if (dirty) window.localStorage.setItem(key, JSON.stringify({ name, description, content }));
      else window.localStorage.removeItem(key);
    } catch { /* 存储不可用时仍可继续编辑 */ }
  }, [skill.id, loadingDetail, dirty, name, description, content]);

  const handleSave = async () => {
    setSaving(true);
    const saved = await onSave({ ...skill, name, description, content });
    setSaving(false);
    if (saved) {
      setSavedContent(content);
      setSavedName(name);
      setSavedDescription(description);
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
    liveRef.current = { mode, dirty, draft: { name, description, content }, save: handleSave, toggleMode: () => switchMode(mode === 'edit' ? 'preview' : 'edit') };
    if (apiRef) apiRef.current = liveRef.current;
  });
  useEffect(() => () => { if (apiRef) apiRef.current = null; }, [apiRef]);

  // 切技能时同步刷一次草稿；异步自动保存会在卸载后改写列表并可能抢走新选中项。
  useEffect(() => () => {
    const live = liveRef.current;
    if (live?.dirty) {
      try { window.localStorage.setItem(`ash:skill-draft:${skill.id}`, JSON.stringify(live.draft)); }
      catch { /* 存储不可用时由上面的常规草稿 effect 尽力保存 */ }
    }
  }, [skill.id]);

  const openFile = (path) => {
    setFileError('');
    setAuxFileContent('');
    setSelectedFile(path);
    if (path !== 'SKILL.md') setLoadingFile(true);
  };

  return (
    <div className="detail-panel">
      <DetailToolbar
        skill={skill}
        fileCount={fileTree.length}
        selectedFile={selectedFile}
        auxFileContent={auxFileContent}
        copied={copied}
        onCopy={copyToClipboard}
        onShowVersions={() => setShowVersions(true)}
        mode={mode}
        dirty={dirty}
        saving={saving}
        onSwitchMode={switchMode}
        onSelectFolder={onSelectFolder}
        onCopySkill={onCopySkill}
      />
      <VersionHistoryModal isOpen={showVersions} onClose={() => setShowVersions(false)} skillId={skill.id} onRestored={async () => {
            const fresh = await requestJson(`/api/skills/${skill.id}`).catch(() => null);
            if (fresh) { setContent(fresh.content || ''); setSavedContent(fresh.content || ''); }
          }} />

      <div className="detail-body">
        {fileTree.length > 1 && (
          <FileTreeSidebar
            files={fileTree}
            selectedFile={selectedFile}
            onOpenFile={openFile}
            collapsed={fileBarCollapsed}
            onCollapse={() => { fileBarManualRef.current = false; setFileBarCollapsed(true); }}
            onExpand={() => { fileBarManualRef.current = true; setFileBarCollapsed(false); }}
          />
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
            <ReviewPanel detail={reviewDetail} onChanged={async () => { setReloadKey((k) => k + 1); await onChanged?.(); }} />

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
