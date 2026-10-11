import { useState } from 'react';
import { Ban, Check, Copy, Link2, Lock, Globe } from 'lucide-react';
import { requestJson } from '../utils/requestJson';
import { showToast } from './toastBus';
import { relativeTime } from '../utils/date';

// 到期剩余时间：永久 / 相对剩余 / 已过期（红）。expired 标记来自服务端，本地再按时间戳兜底判一次
function formatExpiry(share, now = Date.now()) {
  if (!share.expires_at) return '永久';
  const minutes = Math.round((share.expires_at - now) / 60000);
  if (share.expired || minutes <= 0) return '已过期';
  if (minutes < 60) return `${minutes} 分钟后到期`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时后到期`;
  return `${Math.round(hours / 24)} 天后到期`;
}

// 分享链接列表里的一行：徽标 + 统计 + 链接复制 + 停用（停用后对方立即 404）。
// 详情页弹窗只显示备注；「我的分享」总览额外传 showSkill / onOpenSkill 显示技能名入口。
export default function ShareLinkRow({ share, onRevoked, showSkill = false, onOpenSkill }) {
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState('');
  const expiry = formatExpiry(share);
  const expired = expiry === '已过期';

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(share.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      showToast('复制失败，请手动选中复制。');
    }
  };

  const revoke = async () => {
    const name = showSkill ? `${share.skill_name}（${share.label || '未命名链接'}）` : (share.label || '未命名链接');
    if (!window.confirm(`停用「${name}」？对方将立即无法访问。`)) return;
    setRevoking(true);
    setError('');
    try {
      await requestJson(`/api/shares/${share.id}`, { method: 'DELETE' });
      onRevoked?.(share.id);
    } catch (e) {
      setError(e.message);
      setRevoking(false);
    }
  };

  return (
    <div className={`share-row${expired ? ' is-expired' : ''}`}>
      <div className="share-row-head">
        {showSkill && onOpenSkill && (
          <button
            type="button"
            className="share-skill-link"
            onClick={() => onOpenSkill(share.skill_slug)}
            title={`在库中查看「${share.skill_name}」`}
          >
            {share.skill_name}
            <Link2 size={12} aria-hidden="true" />
          </button>
        )}
        <strong className="share-row-title" title={share.label || undefined}>{share.label || '未命名链接'}</strong>
        <span className="share-badges">
          <span className="chip">{share.follow_latest ? '跟随最新' : `快照${share.version ? ` v${share.version}` : ''}`}</span>
          <span className="chip">{share.protected ? <><Lock size={11} aria-hidden="true" />密码</> : <><Globe size={11} aria-hidden="true" />公开</>}</span>
          <span className={`chip${expired ? ' chip-expired' : ''}`}>{expiry}</span>
        </span>
      </div>
      <span className="share-row-stats">
        浏览 {share.view_count} · 取用 {share.download_count} · {share.last_accessed_at ? `最近访问 ${relativeTime(share.last_accessed_at)}` : '从未访问'}
      </span>
      <div className="share-row-url">
        <code title={share.url}>{share.url}</code>
        <button type="button" className="secondary-button" onClick={copyUrl} aria-label={copied ? '已复制链接' : '复制链接'}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? '已复制' : '复制'}
        </button>
        <button type="button" className="danger-text-button" onClick={revoke} disabled={revoking}>
          <Ban size={13} aria-hidden="true" />
          {revoking ? '停用中…' : '停用'}
        </button>
      </div>
      {error && <div className="inline-error" role="alert">{error}</div>}
    </div>
  );
}
