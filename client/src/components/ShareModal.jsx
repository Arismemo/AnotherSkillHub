import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { DialogShell } from './Modals';
import ShareLinkRow from './ShareLinkRow';
import { requestJson } from '../utils/requestJson';
import { showToast } from './toastBus';

const EXPIRES_OPTIONS = [
  { value: '7d', label: '7 天' },
  { value: '1d', label: '1 天' },
  { value: '30d', label: '30 天' },
  { value: 'never', label: '永久' },
];

// 分享弹窗：一个技能可以有多条链接（快照 / 跟随最新、公开 / 密码、不同有效期），各自可停用。
// 只在打开时挂载面板：每次打开表单都是干净的初始值（同 AccountModal）
export default function ShareModal({ isOpen, onClose, skill, onCountChange }) {
  return isOpen ? <SharePanel onClose={onClose} skill={skill} onCountChange={onCountChange} /> : null;
}

function SharePanel({ onClose, skill, onCountChange }) {
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [label, setLabel] = useState('');
  const [followLatest, setFollowLatest] = useState(false);
  const [access, setAccess] = useState('public');
  const [password, setPassword] = useState('');
  const [expires, setExpires] = useState('7d');
  const [creating, setCreating] = useState(false);
  const pending = skill?.status === 'pending';

  // 有效链接数同步给详情页工具栏的徽标
  const applyCount = (rows) => onCountChange?.(rows.filter((row) => !row.expired).length);

  useEffect(() => {
    const controller = new AbortController();
    requestJson(`/api/shares?skill=${skill.id}`, { signal: controller.signal })
      .then((data) => {
        const rows = Array.isArray(data?.shares) ? data.shares : [];
        setShares(rows);
        onCountChange?.(rows.filter((row) => !row.expired).length);
      })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [skill.id, onCountChange]);

  const create = async (event) => {
    event.preventDefault();
    if (access === 'password' && password.length < 4) {
      setError('访问密码至少 4 位。');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const body = { skill: skill.id, expires, follow_latest: followLatest };
      if (label.trim()) body.label = label.trim();
      if (access === 'password') body.password = password;
      const { share } = await requestJson('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setShares((rows) => [share, ...rows]);
      applyCount([share, ...shares]);
      setLabel('');
      setPassword('');
      try {
        await navigator.clipboard.writeText(share.url);
        showToast('链接已复制');
      } catch {
        showToast('链接已创建，自动复制失败，请手动复制。');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoked = (id) => {
    const next = shares.filter((row) => row.id !== id);
    setShares(next);
    applyCount(next);
    showToast('链接已停用');
  };

  return (
    <DialogShell title="分享技能" description="链接免登录可访问：对方能查看、安装、下载，或存进自己的库。" onClose={onClose} size="medium">
      <div className="share-content">
        {error && <div className="inline-error" role="alert">{error}</div>}

        <section aria-labelledby="share-links-heading">
          <h3 id="share-links-heading" className="share-form-title">已有链接</h3>
          {loading ? (
            <p className="step-note">加载中…</p>
          ) : shares.length > 0 ? (
            <div className="share-list">
              {shares.map((share) => (
                <ShareLinkRow key={share.id} share={share} onRevoked={handleRevoked} />
              ))}
            </div>
          ) : (
            <p className="step-note">还没有分享链接，用下面的表单创建一条。</p>
          )}
        </section>

        <form className="form-stack" onSubmit={create}>
          <fieldset className="share-form-fields" disabled={pending}>
            <h3 className="share-form-title">新建分享链接</h3>
            {pending && <p className="step-note">待审核的技能不能分享，采纳之后再试。</p>}
            <label>备注（可选）<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="给谁 / 用途" maxLength={80} /></label>
            <div className="form-grid">
              <fieldset className="radio-group">
                <legend>内容</legend>
                <label className="radio-option">
                  <input type="radio" name="share-content" checked={!followLatest} onChange={() => setFollowLatest(false)} />
                  <span>快照{skill.version ? ` v${skill.version}` : ''}<span className="radio-hint">之后的修改不会出现在这个链接里</span></span>
                </label>
                <label className="radio-option">
                  <input type="radio" name="share-content" checked={followLatest} onChange={() => setFollowLatest(true)} />
                  <span>始终最新<span className="radio-hint">对方看到的永远是当前已发布版本</span></span>
                </label>
              </fieldset>
              <fieldset className="radio-group">
                <legend>访问</legend>
                <label className="radio-option">
                  <input type="radio" name="share-access" checked={access === 'public'} onChange={() => setAccess('public')} />
                  <span>公开<span className="radio-hint">任何拿到链接的人都能查看</span></span>
                </label>
                <label className="radio-option">
                  <input type="radio" name="share-access" checked={access === 'password'} onChange={() => setAccess('password')} />
                  <span>需要密码<span className="radio-hint">至少 4 位</span></span>
                </label>
                {access === 'password' && (
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="访问密码"
                    minLength={4}
                    maxLength={200}
                    autoComplete="new-password"
                    aria-label="访问密码"
                    required
                  />
                )}
              </fieldset>
            </div>
            <label className="compact-field">有效期
              <select value={expires} onChange={(event) => setExpires(event.target.value)}>
                {EXPIRES_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </fieldset>
          <footer className="dialog-footer">
            <button type="button" className="secondary-button" onClick={onClose}>关闭</button>
            <button type="submit" className="primary-button" disabled={creating || pending}>
              <Plus size={14} />
              {creating ? '创建中…' : '创建链接'}
            </button>
          </footer>
        </form>
      </div>
    </DialogShell>
  );
}
