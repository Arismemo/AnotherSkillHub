import { useEffect, useState } from 'react';
import { DialogShell } from './Modals';
import ShareLinkRow from './ShareLinkRow';
import { requestJson } from '../utils/requestJson';

// 「我的分享」：跨技能的全部分享链接；点技能名关掉弹窗并跳到该技能。
// 只在打开时挂载面板，每次打开重新拉取最新列表
export default function SharesModal({ isOpen, onClose, onOpenSkill }) {
  return isOpen ? <SharesPanel onClose={onClose} onOpenSkill={onOpenSkill} /> : null;
}

function SharesPanel({ onClose, onOpenSkill }) {
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    requestJson('/api/shares', { signal: controller.signal })
      .then((data) => setShares(Array.isArray(data?.shares) ? data.shares : []))
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const handleRevoked = (id) => setShares((rows) => rows.filter((row) => row.id !== id));

  return (
    <DialogShell title="我的分享" description="你创建过的所有分享链接；停用后对方立即无法访问。" onClose={onClose} size="large">
      <div className="share-content">
        {error && <div className="inline-error" role="alert">{error}</div>}
        {loading ? (
          <p className="step-note">加载中…</p>
        ) : shares.length > 0 ? (
          <div className="share-list">
            {shares.map((share) => (
              <ShareLinkRow key={share.id} share={share} showSkill onOpenSkill={onOpenSkill} onRevoked={handleRevoked} />
            ))}
          </div>
        ) : (
          <p className="step-note">还没有分享过任何技能——在技能详情的工具栏点「分享」创建链接。</p>
        )}
      </div>
    </DialogShell>
  );
}
