// 分享页：/share/<token> 免登录查看别人分享的技能。marked / highlight.js 只在这里引入（懒加载 chunk），
// 公共的 markdown / hljs 样式来自 src/markdown.css；页面自身布局在 landing.css 的「分享页」一节。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, Lock, PackagePlus } from 'lucide-react';
import { requestJson } from '../utils/requestJson';
import { formatDateTime } from '../utils/date';
import { splitFrontmatter } from '../utils/markdownDoc';
import { cachedRender, highlightCode, languageForPath, renderMarkdown } from '../utils/highlight';
import { CopyCommand } from './Landing';
import '../markdown.css';

function humanSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

// 密码门：解锁成功后种下 httpOnly cookie，重新拉取即得全文
function PasswordGate({ token, onUnlocked }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!password) return;
    setBusy(true);
    setError('');
    try {
      await requestJson(`/api/share/${encodeURIComponent(token)}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      }, { onUnauthorized: null });
      onUnlocked();
    } catch (e) {
      setError(e.message); // 密码不正确 / 尝试次数过多，直接展示
      setBusy(false);
    }
  };

  return (
    <main className="share-page share-gate-page">
      <div className="share-state-card">
        <div className="share-gate-icon" aria-hidden="true"><Lock size={18} /></div>
        <h1>这个分享需要密码</h1>
        <p>输入分享者设置的访问密码继续查看。</p>
        <form className="share-gate-form" onSubmit={submit}>
          {error && <p className="share-inline-error" role="alert">{error}</p>}
          <label>
            访问密码
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" autoFocus required />
          </label>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !password}>{busy ? '验证中…' : '查看技能'}</button>
        </form>
      </div>
      <p className="share-footnote">由 <a href="/">AnotherSkillHub</a> 提供</p>
    </main>
  );
}

// 存到我的库：未登录给登录链接；本人禁用；409 同名时让用户改标识符再试
function SavePanel({ token, data }) {
  const viewer = data.viewer;
  const [phase, setPhase] = useState(viewer?.is_owner ? 'owner' : 'idle'); // idle | saving | saved | conflict | error
  const [slug, setSlug] = useState('');
  const [message, setMessage] = useState('');
  const [savedUrl, setSavedUrl] = useState('');

  if (!viewer) {
    return (
      <a className="btn btn-ghost" href={`/login?next=${encodeURIComponent(`/share/${token}`)}`}>
        <PackagePlus size={14} aria-hidden="true" />登录后存到我的库
      </a>
    );
  }
  if (viewer.is_owner) {
    return (
      <div className="share-save-owner">
        <button type="button" className="btn btn-ghost" disabled title="这是你自己的技能">
          <PackagePlus size={14} aria-hidden="true" />这是你的技能
        </button>
        <a className="share-text-link" href={`/app?skill=${encodeURIComponent(data.slug)}`}>在库中打开</a>
      </div>
    );
  }

  const save = async (event) => {
    event?.preventDefault?.();
    setPhase('saving');
    setMessage('');
    try {
      const result = await requestJson(`/api/share/${encodeURIComponent(token)}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slug.trim() ? { slug: slug.trim() } : {}),
      });
      setSavedUrl(result.url);
      setPhase('saved');
    } catch (e) {
      if (e.status === 409 && e.conflict) {
        setSlug(e.suggested_slug || '');
        setMessage(e.message);
        setPhase('conflict');
      } else {
        setMessage(e.message);
        setPhase('error');
      }
    }
  };

  if (phase === 'saved') {
    return (
      <p className="share-save-done" role="status">
        已存入你的库
        <a className="btn btn-ghost" href={savedUrl}>打开看看</a>
      </p>
    );
  }
  if (phase === 'conflict') {
    return (
      <form className="share-save-conflict" onSubmit={save}>
        <p className="share-inline-error" role="alert">{message}</p>
        <div className="share-save-row">
          <input value={slug} onChange={(event) => setSlug(event.target.value)} aria-label="新的标识符" spellCheck="false" placeholder="标识符，例如 my-skill-2" />
          <button type="submit" className="btn btn-ghost" disabled={phase === 'saving' || !slug.trim()}>保存</button>
        </div>
      </form>
    );
  }
  return (
    <>
      {phase === 'error' && <p className="share-inline-error" role="alert">{message}</p>}
      <button type="button" className="btn btn-ghost" onClick={save} disabled={phase === 'saving'}>
        <PackagePlus size={14} aria-hidden="true" />{phase === 'saving' ? '保存中…' : '存到我的库'}
      </button>
    </>
  );
}

// 正文与文件查看
function ShareBody({ token, data }) {
  const [selectedFile, setSelectedFile] = useState('SKILL.md');
  const [fileState, setFileState] = useState({ phase: 'idle' }); // idle | loading | ready | error
  const fileCacheRef = useRef(new Map()); // path -> content，来回切换不重复拉取

  const openFile = (path) => {
    setSelectedFile(path);
    const cached = path === 'SKILL.md' ? undefined : fileCacheRef.current.get(path);
    if (path === 'SKILL.md') setFileState({ phase: 'idle' });
    else if (cached !== undefined) setFileState({ phase: 'ready', content: cached });
    else setFileState({ phase: 'loading' });
  };

  useEffect(() => {
    if (selectedFile === 'SKILL.md' || fileState.phase !== 'loading') return undefined;
    let cancelled = false;
    requestJson(`/api/share/${encodeURIComponent(token)}/file?path=${encodeURIComponent(selectedFile)}`, {}, { onUnauthorized: null })
      .then((result) => {
        fileCacheRef.current.set(selectedFile, result.content);
        if (!cancelled) setFileState({ phase: 'ready', content: result.content });
      })
      .catch((error) => { if (!cancelled) setFileState({ phase: 'error', message: error.message }); });
    return () => { cancelled = true; };
  }, [selectedFile, fileState.phase, token]);

  const bodyHtml = useMemo(() => {
    if (selectedFile !== 'SKILL.md') return '';
    return cachedRender('md', splitFrontmatter(data.content || '').body || '', renderMarkdown);
  }, [data.content, selectedFile]);

  const auxHtml = useMemo(() => {
    if (selectedFile === 'SKILL.md' || !selectedFile.endsWith('.md') || fileState.phase !== 'ready') return '';
    return cachedRender('md', splitFrontmatter(fileState.content || '').body || '', renderMarkdown);
  }, [fileState.phase, fileState.content, selectedFile]);

  const codeHtml = useMemo(() => {
    if (selectedFile === 'SKILL.md' || selectedFile.endsWith('.md') || fileState.phase !== 'ready') return '';
    const language = languageForPath(selectedFile);
    return cachedRender(`file:${language || 'text'}`, (fileState.content || '').replace(/\n$/, ''), (text) => highlightCode(text, language));
  }, [fileState.phase, fileState.content, selectedFile]);

  const skillMdSize = useMemo(() => humanSize(new Blob([data.content || '']).size), [data.content]);

  return (
    <div className="container share-body">
      <aside className="share-files" aria-label="技能文件">
        <ul>
          <li>
            <button type="button" className={selectedFile === 'SKILL.md' ? 'is-active' : ''} onClick={() => openFile('SKILL.md')}>
              <FileText size={13} aria-hidden="true" />
              <span>SKILL.md</span>
              <small>{skillMdSize}</small>
            </button>
          </li>
          {data.files.map((file) => (
            <li key={file.path}>
              <button type="button" className={selectedFile === file.path ? 'is-active' : ''} onClick={() => openFile(file.path)} title={file.path}>
                <FileText size={13} aria-hidden="true" />
                <span>{file.path}</span>
                <small>{humanSize(file.size)}</small>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="share-content">
        {selectedFile === 'SKILL.md' ? (
          <article className="markdown-document" aria-label="SKILL.md">
            <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
          </article>
        ) : (
          <section className="share-file-viewer" aria-label={selectedFile}>
            <header>
              <strong>{selectedFile}</strong>
              <button type="button" onClick={() => openFile('SKILL.md')}>返回说明</button>
            </header>
            {fileState.phase === 'loading' ? (
              <p className="share-hint" role="status">正在载入文件…</p>
            ) : fileState.phase === 'error' ? (
              <p className="share-inline-error" role="alert">{fileState.message}</p>
            ) : selectedFile.endsWith('.md') ? (
              <div className="markdown-document share-file-md">
                <div dangerouslySetInnerHTML={{ __html: auxHtml }} />
              </div>
            ) : (
              <pre className="share-code" data-lang={languageForPath(selectedFile) || (selectedFile.split('.').pop() || 'text')}>
                <code className="hljs" dangerouslySetInnerHTML={{ __html: codeHtml }} />
              </pre>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function ShareView({ token, data }) {
  const [installTab, setInstallTab] = useState('curl'); // curl | ash

  return (
    <main className="share-page">
      <header className="container share-header">
        <div>
          <p className="share-owner">来自 <strong>{data.owner}</strong> 的分享</p>
          <h1>{data.name}</h1>
          {data.description && <p className="share-description">{data.description}</p>}
          <p className="share-meta">
            {data.version && <span className="share-chip">v{data.version}</span>}
            <span className="share-chip">{data.follow_latest ? '跟随最新' : '快照'}</span>
            {data.updated_at && <span>更新于 {formatDateTime(data.updated_at)}</span>}
            {data.tags?.length > 0 && data.tags.map((tag) => <span key={tag} className="share-chip share-tag">{tag}</span>)}
          </p>
        </div>
        <div className="share-actions-panel">
          <section className="share-panel-block" aria-labelledby="share-install-heading">
            <h2 id="share-install-heading">安装</h2>
            <div className="share-install-tabs" role="tablist" aria-label="安装方式">
              <button type="button" role="tab" aria-selected={installTab === 'curl'} className={installTab === 'curl' ? 'is-active' : ''} onClick={() => setInstallTab('curl')}>一键安装</button>
              <button type="button" role="tab" aria-selected={installTab === 'ash'} className={installTab === 'ash' ? 'is-active' : ''} onClick={() => setInstallTab('ash')}>ash</button>
            </div>
            <CopyCommand command={installTab === 'curl' ? data.install.curl : data.install.ash} />
          </section>
          <section className="share-panel-block" aria-labelledby="share-get-heading">
            <h2 id="share-get-heading">获取</h2>
            <div className="share-get-row">
              <a className="btn btn-ghost" href={data.download_url}>
                <Download size={14} aria-hidden="true" />下载 zip
              </a>
            </div>
            <SavePanel token={token} data={data} />
          </section>
        </div>
      </header>
      <ShareBody token={token} data={data} />
      <footer className="share-footnote">
        <a href="/">由 AnotherSkillHub 提供</a>
      </footer>
    </main>
  );
}

export default function SharePage({ token }) {
  const [data, setData] = useState(null);
  const [locked, setLocked] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    requestJson(`/api/share/${encodeURIComponent(token)}`, {}, { onUnauthorized: null })
      .then((payload) => {
        setData(payload);
        setLocked(false);
        setNotFound(false);
      })
      .catch((error) => {
        if (error.status === 401 && error.password_required) setLocked(true);
        else if (error.status === 404) setNotFound(true);
        else setLoadError(error.message);
      })
      .finally(() => setLoading(false));
  }, [token]);

  // 异步启动首拉，避免在 effect 里同步 setState 触发级联渲染（同 App / VersionHistoryModal）
  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loading && !data && !locked && !notFound && !loadError) {
    return <div className="share-loading" role="status">正在载入分享…</div>;
  }
  if (notFound) {
    return (
      <main className="share-page share-state-page">
        <div className="share-state-card">
          <h1>链接不可用</h1>
          <p>链接不存在、已过期或已被停用。</p>
          <a className="btn btn-primary" href="/">回到首页</a>
        </div>
      </main>
    );
  }
  if (locked && !data) return <PasswordGate token={token} onUnlocked={() => { setLocked(false); load(); }} />;
  if (loadError && !data) {
    return (
      <main className="share-page share-state-page">
        <div className="share-state-card">
          <h1>载入失败</h1>
          <p className="share-inline-error">{loadError}</p>
          <button type="button" className="btn btn-primary" onClick={load}>重试</button>
        </div>
      </main>
    );
  }
  return <ShareView token={token} data={data} />;
}
