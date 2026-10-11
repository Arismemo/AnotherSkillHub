import { useEffect, useState } from 'react';
import { Check, Copy, Globe, KeyRound, Share2, Trash2 } from 'lucide-react';
import { DialogShell } from './Modals';
import { requestJson } from '../utils/requestJson';
import { showToast } from './toastBus';

// 分享弹窗：公开访问（无需登录）或密码访问，生成链接可复制
export default function ShareModal({ isOpen, onClose, skill }) {
  const [mode, setMode] = useState('public');
  const [password, setPassword] = useState('');
  const [expiresIn, setExpiresIn] = useState(''); // 秒，空 = 永久
  const [share, setShare] = useState(null); // 当前分享状态
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !skill?.id) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setError('');
      requestJson(`/api/skills/${skill.id}/share`)
        .then((data) => {
          if (cancelled) return;
          setShare(data);
          if (data.mode) setMode(data.mode);
        })
        .catch(() => { if (!cancelled) setShare(null); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [isOpen, skill?.id]);

  if (!isOpen) return null;

  const createShare = async () => {
    setBusy(true);
    setError('');
    try {
      const body = { mode };
      if (mode === 'password') body.password = password;
      if (expiresIn) body.expires_in = Number(expiresIn);
      const result = await requestJson(`/api/skills/${skill.id}/share`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setShareUrl(result.share_url);
      setShare({ mode, has_password: mode === 'password', expires_at: result.expires_at });
      showToast('分享链接已生成');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const removeShare = async () => {
    if (!window.confirm('停止分享？现有链接将立即失效。')) return;
    setBusy(true);
    try {
      await requestJson(`/api/skills/${skill.id}/share`, { method: 'DELETE' });
      setShare(null);
      setShareUrl('');
      showToast('已停止分享');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('复制失败，请手动选中复制。');
    }
  };

  return (
    <DialogShell title="分享技能" description={`「${skill.name}」的只读链接`} onClose={onClose} size="medium">
      <div className="form-stack">
        {error && <div className="inline-error" role="alert">{error}</div>}

        {share?.mode ? (
          <div className="share-current">
            <p className="step-note">
              当前分享：{share.mode === 'public' ? '公开访问' : '密码访问'}
              {share.expires_at ? ` · ${new Date(share.expires_at).toLocaleDateString()} 过期` : ' · 永久'}
            </p>
            {shareUrl && (
              <div className="token-reveal-row">
                <code>{shareUrl}</code>
                <button type="button" className="secondary-button" onClick={copyUrl}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制'}
                </button>
              </div>
            )}
            <div className="dialog-footer" style={{ justifyContent: 'flex-start', gap: '0.5rem' }}>
              <button type="button" className="secondary-button" onClick={createShare} disabled={busy}>
                重新生成链接
              </button>
              <button type="button" className="secondary-button danger-button" onClick={removeShare} disabled={busy}>
                <Trash2 size={14} />停止分享
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="share-mode-picker" role="radiogroup" aria-label="访问方式">
              <label className={`share-mode-option${mode === 'public' ? ' is-active' : ''}`}>
                <input type="radio" name="share-mode" value="public" checked={mode === 'public'} onChange={() => setMode('public')} />
                <Globe size={16} />
                <div>
                  <strong>公开访问</strong>
                  <span>任何人通过链接查看，无需登录</span>
                </div>
              </label>
              <label className={`share-mode-option${mode === 'password' ? ' is-active' : ''}`}>
                <input type="radio" name="share-mode" value="password" checked={mode === 'password'} onChange={() => setMode('password')} />
                <KeyRound size={16} />
                <div>
                  <strong>密码访问</strong>
                  <span>需要输入密码才能查看</span>
                </div>
              </label>
            </div>

            {mode === 'password' && (
              <label>
                访问密码
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 4 位" minLength={4} required />
              </label>
            )}

            <label>
              有效期
              <select value={expiresIn} onChange={(e) => setExpiresIn(e.target.value)}>
                <option value="">永久</option>
                <option value="86400">1 天</option>
                <option value="604800">7 天</option>
                <option value="2592000">30 天</option>
              </select>
            </label>

            <footer className="dialog-footer">
              <button type="button" className="secondary-button" onClick={onClose}>取消</button>
              <button type="button" className="primary-button" onClick={createShare} disabled={busy || (mode === 'password' && password.length < 4)}>
                <Share2 size={14} />{busy ? '生成中…' : '生成分享链接'}
              </button>
            </footer>
          </>
        )}
      </div>
    </DialogShell>
  );
}
