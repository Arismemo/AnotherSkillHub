import { useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';
import {
  Check,
  Copy,
  Download,
  Edit3,
  Eye,
  FileCode2,
  FileText,
  Save,
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
  const renderedMarkdown = useMemo(
    () => marked.parse(documentParts.body || content || ''),
    [content, documentParts.body],
  );
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
            <button type="button" className={mode === 'preview' ? 'is-active' : ''} onClick={() => setMode('preview')} aria-pressed={mode === 'preview'}><Eye size={14} />预览</button>
            <button type="button" className={mode === 'edit' ? 'is-active' : ''} onClick={() => setMode('edit')} aria-pressed={mode === 'edit'}><Edit3 size={14} />编辑</button>
          </div>
          {mode === 'edit' && (
            <button type="button" className="primary-button" onClick={handleSave} disabled={saving}>
              <Save size={14} />{saving ? '保存中…' : '保存'}
            </button>
          )}
        </div>
      </header>

      <div className="detail-scroll">
        <div className="detail-content">
          <div className="sr-only" aria-live="polite">{copied ? '内容已复制' : ''}</div>
          {detailError && <div className="inline-error" role="alert">{detailError}</div>}

          {mode === 'preview' ? (
            <>
              {fileTree.length > 1 && (
                <section className="attachment-strip" aria-labelledby="attachments-heading">
                  <div className="attachment-heading">
                    <h3 id="attachments-heading">技能文件</h3>
                    <span>{fileTree.length} 个</span>
                  </div>
                  <div className="attachment-list">
                    {fileTree.map((file) => (
                      <button
                        type="button"
                        key={file.path}
                        className={selectedFile === file.path ? 'is-active' : ''}
                        onClick={() => openFile(file.path)}
                        aria-pressed={selectedFile === file.path}
                      >
                        {file.isMain || file.path.endsWith('.md') ? <FileText size={14} /> : <FileCode2 size={14} />}
                        <span>{file.path}</span>
                        <small>{Math.max(1, Math.round(file.size / 1024))} KB</small>
                      </button>
                    ))}
                  </div>
                </section>
              )}

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
  );
}
