// 分享页：免登录查看技能（公开 / 密码访问）。从 /share/:token 进入，只读渲染 Markdown。
import { useEffect, useState } from 'react';
import { requestJson } from '../utils/requestJson';
import { splitFrontmatter } from '../utils/markdownDoc';
import { renderMarkdown } from '../utils/highlight';
import { KeyRound } from 'lucide-react';

export default function SharePage() {
  const [skill, setSkill] = useState(null);
  const [error, setError] = useState('');
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const token = window.location.pathname.replace(/^\/share\//, '');

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      requestJson(`/api/share/${token}`, {}, { onUnauthorized: null })
        .then((data) => { if (!cancelled) setSkill(data); })
        .catch((e) => {
          if (cancelled) return;
          if (e.status === 401 && e.password_required) setPasswordRequired(true);
          else setError(e.message || '链接不存在或已过期');
        });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [token]);

  if (!token) return <div className="share-page"><div className="share-error"><h1>链接不存在或已过期</h1></div></div>;

  const unlock = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await requestJson(`/api/share/${token}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      setSkill(data);
      setPasswordRequired(false);
    } catch (e) {
      setError(e.message || '密码错误');
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="share-page">
        <div className="share-error">
          <h1>链接不存在或已过期</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (passwordRequired) {
    return (
      <div className="share-page">
        <form className="share-password" onSubmit={unlock}>
          <KeyRound size={24} />
          <h1>需要密码</h1>
          <p>这个技能链接受密码保护，请输入密码查看。</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="访问密码"
            autoFocus
            required
          />
          <button type="submit" disabled={busy}>{busy ? '验证中…' : '查看'}</button>
        </form>
      </div>
    );
  }

  if (!skill) {
    return (
      <div className="share-page">
        <div className="share-loading">载入中…</div>
      </div>
    );
  }

  const { body } = splitFrontmatter(skill.content || '');
  const html = renderMarkdown(body || '');

  return (
    <div className="share-page">
      <article className="share-skill">
        <header>
          <h1>{skill.name}</h1>
          {skill.description && <p className="share-description">{skill.description}</p>}
          <div className="share-meta">
            <span>v{skill.version}</span>
            <span>更新于 {new Date(skill.updated_at).toLocaleDateString()}</span>
          </div>
        </header>
        <div className="markdown-document" dangerouslySetInnerHTML={{ __html: html }} />
      </article>
    </div>
  );
}
