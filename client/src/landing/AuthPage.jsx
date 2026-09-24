import { useState } from 'react';
import { requestJson } from '../utils/requestJson';
import { Brand } from './SiteChrome';
import { safeNext } from './nextPath';

const USERNAME_RE = /^[a-z0-9_-]{3,32}$/;

export default function AuthPage({ mode, registration }) {
  const isRegister = mode === 'register';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const closed = isRegister && registration === 'closed';
  const next = safeNext(window.location.search);
  const switchHref = `${isRegister ? '/login' : '/register'}${next === '/app' ? '' : `?next=${encodeURIComponent(next)}`}`;

  const submit = async (event) => {
    event.preventDefault();
    const name = username.trim().toLowerCase();
    if (isRegister) {
      if (!USERNAME_RE.test(name)) return setError('用户名需为 3–32 位小写字母、数字、- 或 _');
      if (password.length < 8) return setError('密码至少 8 位');
      if (password !== confirm) return setError('两次输入的密码不一致');
    }
    setSubmitting(true);
    setError('');
    try {
      await requestJson(`/api/auth/${isRegister ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, password }),
      }, { onUnauthorized: null });
      window.location.assign(next);
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <a className="auth-brand" href="/"><Brand /></a>
      <main className="auth-card">
        <h1>{isRegister ? '创建账号' : '登录'}</h1>
        <p className="auth-lede">{isRegister ? '每个账号有自己的私有技能库，注册后自带几份示例技能。' : '登录后管理你的技能库，或为终端创建 API token。'}</p>
        {closed ? (
          <p className="auth-notice" role="status">当前实例未开放注册，请联系管理员为你创建账号。</p>
        ) : (
          <form className="auth-form" onSubmit={submit} noValidate>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <label>
              用户名
              <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck="false" required autoFocus />
              {isRegister && <span className="auth-hint">3–32 位小写字母、数字、- 或 _</span>}
            </label>
            <label>
              密码
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={isRegister ? 'new-password' : 'current-password'} required />
              {isRegister && <span className="auth-hint">至少 8 位</span>}
            </label>
            {isRegister && (
              <label>
                确认密码
                <input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" required />
              </label>
            )}
            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
              {submitting ? '请稍候…' : isRegister ? '注册并进入' : '登录'}
            </button>
          </form>
        )}
        <p className="auth-switch">
          {isRegister
            ? <>已有账号？<a href={switchHref}>登录</a></>
            : registration === 'closed' ? '没有账号？请联系管理员创建。' : <>还没有账号？<a href={switchHref}>免费注册</a></>}
        </p>
      </main>
    </div>
  );
}
