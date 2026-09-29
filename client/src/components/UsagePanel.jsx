import { Activity, Check, Link2, X } from 'lucide-react';
import { formatDateTime, relativeTime } from '../utils/date';
import './Usage.css';

const HEALTH_CLASS = { failing: 'chip-danger', duplicate: 'chip-warning' };

// 相似技能：详情页的「可能重复」与审核条的「相似的已有技能」共用
export function SimilarSkills({ items, onOpenSkill, emptyText = '' }) {
  if (!items?.length) return emptyText ? <p className="usage-empty">{emptyText}</p> : null;
  return (
    <ul className="similar-list">
      {items.map((s) => (
        <li key={s.id}>
          <button type="button" className="similar-link" onClick={() => onOpenSkill?.(s.id)} title={s.description || s.slug}>
            <Link2 size={12} aria-hidden="true" />
            <span className="similar-name">{s.name}</span>
            <code>{s.slug}</code>
          </button>
          {typeof s.similarity === 'number' && (
            <span className={`chip ${s.duplicate ? 'chip-warning' : 'chip-muted'}`} title="名称、描述、标签与标题的相似度">
              {s.duplicate ? '疑似重复 · ' : ''}{Math.round(s.similarity * 100)}%
            </span>
          )}
          {s.status === 'pending' && <span className="chip chip-pending">待审</span>}
        </li>
      ))}
    </ul>
  );
}

export function FeedbackList({ items }) {
  if (!items?.length) return null;
  return (
    <ul className="feedback-list">
      {items.map((f, i) => (
        <li key={`${f.created_at}-${i}`} className={f.outcome === 'fail' ? 'is-fail' : 'is-ok'}>
          {f.outcome === 'fail' ? <X size={12} aria-label="失败" /> : <Check size={12} aria-label="成功" />}
          <span className="feedback-note">{f.note || (f.outcome === 'fail' ? '（未写原因）' : '走通了')}</span>
          <span className="feedback-meta" title={formatDateTime(f.created_at)}>
            {f.terminal || '未知来源'} · {relativeTime(f.created_at)}{f.current ? '' : ' · 旧版本'}
          </span>
        </li>
      ))}
    </ul>
  );
}

// 详情页的使用情况：安装、阅读、Agent 反馈与健康信号，外加可能重复的技能。整理技能库时看这里
export default function UsagePanel({ detail, onOpenSkill }) {
  const usage = detail?.usage;
  if (!usage || detail.status === 'pending') return null;
  const feedbackTotal = usage.ok + usage.fail;
  const currentTotal = usage.ok_current + usage.fail_current;
  const similar = detail.similar || [];
  const stats = [
    `30 天安装 ${usage.installs_30d} 次`,
    usage.machines ? `装在 ${usage.machines} 台机器上` : null,
    usage.views_30d ? `阅读 ${usage.views_30d} 次` : null,
    feedbackTotal
      ? `反馈 ${usage.ok} 成功 / ${usage.fail} 失败${currentTotal !== feedbackTotal ? `（当前版本 ${usage.ok_current} / ${usage.fail_current}）` : ''}`
      : '暂无反馈',
    usage.last_used_at ? `最近使用 ${relativeTime(usage.last_used_at)}` : null,
  ].filter(Boolean);

  return (
    <section className="usage-panel" aria-label="使用情况">
      <header>
        <Activity size={14} aria-hidden="true" />
        <strong>使用情况</strong>
        <span className="usage-stats">{stats.join(' · ')}</span>
      </header>
      {usage.health.length > 0 && (
        <div className="usage-health">
          {usage.health.map((h) => (
            <span key={h.code} className={`chip ${HEALTH_CLASS[h.code] || 'chip-muted'}`}>{h.label}</span>
          ))}
          <span className="usage-health-detail">{usage.health.map((h) => h.detail).join('；')}</span>
        </div>
      )}
      {usage.recent_feedback.length > 0 && (
        <details className="usage-section" open={usage.fail_current > 0}>
          <summary>最近的反馈（{usage.recent_feedback.length}）</summary>
          <FeedbackList items={usage.recent_feedback} />
        </details>
      )}
      {similar.length > 0 && (
        <details className="usage-section" open={similar.some((s) => s.duplicate)}>
          <summary>相似技能（{similar.length}）</summary>
          <SimilarSkills items={similar} onOpenSkill={onOpenSkill} />
        </details>
      )}
    </section>
  );
}
