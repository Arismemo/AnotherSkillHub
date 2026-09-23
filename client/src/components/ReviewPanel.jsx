import { useState } from 'react';
import { AlertTriangle, Check, GitCompare, ShieldAlert, X } from 'lucide-react';
import { DialogShell } from './Modals';
import DiffView from './DiffView';
import { relativeTime } from '../utils/date';
import { requestJson } from '../utils/requestJson';
import { showToast } from './toastBus';
import './Review.css';

// 详情页顶部的审核条：待审核的新技能 / Agent 提交的待审更新 / 安全扫描提醒
export default function ReviewPanel({ detail, onChanged }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  if (!detail) return null;

  const pendingNew = detail.status === 'pending';
  const update = detail.pending_update;
  const warnings = detail.security_warnings || [];
  const updateWarnings = update?.meta?.security_warnings || [];
  if (!pendingNew && !update && !warnings.length) return null;

  const act = async (action) => {
    setBusy(action);
    setError('');
    try {
      await requestJson(`/api/skills/${detail.id}/${action}`, { method: 'POST' });
      setShowDiff(false);
      showToast({
        approve: update ? '已采纳 Agent 提交的更新，旧版本已存入历史' : '已通过审核，其他 Agent 现在可以拉取',
        reject: update ? '已拒绝这次更新' : '已拒绝，技能已移入废纸篓',
      }[action]);
      await onChanged?.(action);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const source = update?.meta?.terminal_source || detail.terminal_source || 'Agent';

  return (
    <section className="review-panel" aria-label="审核">
      {error && <div className="inline-error" role="alert">{error}</div>}
      {pendingNew && (
        <div className="review-banner is-pending">
          <ShieldAlert size={15} aria-hidden="true" />
          <p><strong>待审核的新技能</strong>来自 {source}。通过前其他 Agent 无法拉取（推送者可用 <code>--pending</code> 自用）。</p>
          <div className="review-actions">
            <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => act('approve')}><Check size={14} />{busy === 'approve' ? '处理中…' : '通过'}</button>
            <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => act('reject')}><X size={14} />拒绝</button>
          </div>
        </div>
      )}
      {update && (
        <div className="review-banner is-pending">
          <GitCompare size={15} aria-hidden="true" />
          <p><strong>{source} 提交了更新</strong>{update.submitted_at ? `（${relativeTime(update.submitted_at)}）` : ''}。采纳前其他 Agent 仍拉取当前版本。</p>
          <div className="review-actions">
            <button type="button" className="secondary-button" onClick={() => setShowDiff(true)}><GitCompare size={14} />查看差异</button>
            <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => act('approve')}><Check size={14} />{busy === 'approve' ? '处理中…' : '采纳'}</button>
            <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => act('reject')}><X size={14} />拒绝</button>
          </div>
        </div>
      )}
      {[...warnings.map((w) => ({ ...w, scope: '当前版本' })), ...updateWarnings.map((w) => ({ ...w, scope: '待审更新' }))].map((w, i) => (
        <div key={`${w.scope}-${i}`} className={`review-banner ${w.level === 'high' ? 'is-danger' : 'is-warning'}`}>
          <AlertTriangle size={15} aria-hidden="true" />
          <p><strong>安全提醒（{w.scope}）</strong>{w.msg}{w.level === 'high' ? '。高危模式，请仔细核对后再通过。' : ''}</p>
        </div>
      ))}
      {showDiff && update && (
        <DialogShell title="审核更新" description={`对比当前发布版本与 ${source} 提交的更新`} onClose={() => setShowDiff(false)} size="large">
          <DiffView
            before={detail.content}
            after={update.content}
            beforeLabel="当前发布版本"
            afterLabel="待审更新"
            beforeFiles={detail.files || []}
            afterFiles={update.files || []}
          />
          <footer className="dialog-footer">
            <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => act('reject')}>拒绝</button>
            <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => act('approve')}>{busy === 'approve' ? '处理中…' : '采纳更新'}</button>
          </footer>
        </DialogShell>
      )}
    </section>
  );
}
