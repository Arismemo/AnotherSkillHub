import { useEffect, useMemo, useRef, useState } from 'react';
import { VersionHistoryModal } from './Modals';
import ShareModal from './ShareModal';
import ReviewPanel from './ReviewPanel';
import UsagePanel from './UsagePanel';
import RelationsPanel from './RelationsPanel';
import DetailToolbar from './detail/DetailToolbar';
import DocOutline from './detail/DocOutline';
import FileTreeSidebar from './detail/FileTreeSidebar';
import { showToast } from './toastBus';
import { requestJson } from '../utils/requestJson';
import { extractHeadings, parseFrontmatterPairs, slugifyHeading, splitFrontmatter } from '../utils/markdownDoc';
import useDocOutline, { HEADING_SELECTOR } from '../hooks/useDocOutline';
import { cachedRender, highlightCode, languageForPath, renderMarkdown, splitHighlightedLines } from '../utils/highlight';
import { FileCode2 } from 'lucide-react';

function readSkillDraft(skillId) {
  try {
    const draft = JSON.parse(window.localStorage.getItem(`ash:skill-draft:${skillId}`));
    if (draft && typeof draft.name === 'string' && typeof draft.description === 'string' && typeof draft.content === 'string') return draft;
  } catch { /* 存储不可用或草稿损坏时从服务端继续载入 */ }
  return null;
}

export default function SkillDetail({ skill, onSave, onSelectFolder, onSelectTag, onCopySkill, onChanged, onOpenSkill, apiRef }) {
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
  const [showVersions, setShowVersions] = useState(false);
  const [showShare, setShowShare] = useState(false);
  // 工具栏分享按钮上的计数：分享弹窗增删链接时通过 onCountChange 回写；详情接口的 share_count 到达后校准
  const [shareCount, setShareCount] = useState(skill.share_count || 0);
  // 文件栏在滚动区 <640px 时自动收成细条（点击恢复），正文优先
  const [fileBarCollapsed, setFileBarCollapsed] = useState(false);
  const fileBarManualRef = useRef(false); // 用户手动展开过则不再自动收起
  const scrollRef = useRef(null);

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
        if (Number.isFinite(detail.share_count)) setShareCount(detail.share_count);
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

  const outline = useDocOutline({ scrollRef, headings, mode, renderedMarkdown, auxRendered, selectedFile });

  // B5: frontmatter 键值对
  const frontmatterPairs = useMemo(() => parseFrontmatterPairs(documentParts.frontmatter), [documentParts.frontmatter]);

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
        onShare={() => setShowShare(true)}
        shareCount={shareCount}
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
      <ShareModal
        isOpen={showShare}
        onClose={() => setShowShare(false)}
        skill={skill}
        onCountChange={setShareCount}
      />

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

        <div className={`detail-scroll${outline.visible && !outline.hidden ? ' has-outline' : ''}`} ref={scrollRef}>
          {outline.visible && (
            <DocOutline
              headings={headings}
              activeIndex={outline.activeHeading}
              hidden={outline.hidden}
              onJump={outline.jumpToHeading}
              onHide={() => outline.setHidden(true)}
              onShow={() => outline.setHidden(false)}
            />
          )}
          <div className={`detail-content${isWideFileView ? ' is-wide-file' : ''}`}>
            <div className="sr-only" aria-live="polite">{copied ? '内容已复制' : ''}</div>
            {detailError && <div className="inline-error" role="alert">{detailError}</div>}
            <ReviewPanel detail={reviewDetail} onOpenSkill={onOpenSkill} onChanged={async () => { setReloadKey((k) => k + 1); await onChanged?.(); }} />

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

                    <UsagePanel detail={reviewDetail} onOpenSkill={onOpenSkill} />
                    <RelationsPanel detail={reviewDetail} onOpenSkill={onOpenSkill} />

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
