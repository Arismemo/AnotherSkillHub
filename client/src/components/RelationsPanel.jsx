import { AlertTriangle, GitBranch, Info, Link2 } from 'lucide-react';
import './Usage.css';

const REF_STATUS = {
  ok: null,
  missing: { label: '库中没有', className: 'chip-danger' },
  pending: { label: '待审核', className: 'chip-pending' },
  foreign: { label: '其他账号', className: 'chip-muted' },
  'pin-mismatch': { label: '版本不符', className: 'chip-warning' },
};

function SkillLink({ skill, onOpenSkill }) {
  if (!skill?.id) return <code>{skill?.slug}</code>;
  return (
    <button type="button" className="similar-link" onClick={() => onOpenSkill?.(skill.id)} title={skill.slug}>
      <Link2 size={12} aria-hidden="true" />
      <span className="similar-name">{skill.name || skill.slug}</span>
      <code>{skill.slug}</code>
    </button>
  );
}

// 技能检查结果：审核条与详情页共用
export function LintList({ items }) {
  if (!items?.length) return null;
  return (
    <ul className="lint-list">
      {items.map((item, i) => (
        <li key={`${item.code}-${i}`} className={item.level === 'warn' ? 'is-warn' : 'is-info'}>
          {item.level === 'warn' ? <AlertTriangle size={12} aria-hidden="true" /> : <Info size={12} aria-hidden="true" />}
          <span>{item.msg}</span>
        </li>
      ))}
    </ul>
  );
}

// 与其他技能相同的命令段
export function SharedSteps({ items, onOpenSkill }) {
  if (!items?.length) return null;
  return (
    <ul className="shared-steps">
      {items.map((group, i) => (
        <li key={i}>
          <div className="shared-steps-with">
            与 {group.skills.map((s, j) => (
              <span key={s.id}>{j > 0 && '、'}<SkillLink skill={s} onOpenSkill={onOpenSkill} />{s.meta && <span className="chip chip-muted">元技能</span>}</span>
            ))} 有 {group.commands.length} 条相同的命令
          </div>
          <pre>{group.commands.join('\n')}</pre>
        </li>
      ))}
    </ul>
  );
}

// 详情页的引用关系：引用了谁、被谁引用、与谁有相同的步骤，以及技能检查（双语描述、引用写法、元技能契约）
export default function RelationsPanel({ detail, onOpenSkill }) {
  const refs = detail?.refs;
  if (!refs) return null;
  const lint = detail.status === 'pending' ? [] : (detail.lint || []);
  const shared = detail.shared_steps || [];
  const hasContent = refs.meta || refs.declared.length || refs.undeclared.length || refs.dependents.length || shared.length || lint.length;
  if (!hasContent) return null;

  return (
    <section className="usage-panel relations-panel" aria-label="引用关系">
      <header>
        <GitBranch size={14} aria-hidden="true" />
        <strong>引用关系</strong>
        {refs.meta && <span className="chip chip-muted" title="被别的技能在流程中引用的基础动作">元技能</span>}
        <span className="usage-stats">
          引用 {refs.declared.length} 个 · 被 {refs.dependents.length} 个技能引用
        </span>
      </header>
      {refs.declared.length > 0 && (
        <div className="relations-row">
          <span className="relations-label">引用</span>
          <ul className="similar-list">
            {refs.declared.map((ref) => (
              <li key={ref.raw}>
                <SkillLink skill={ref} onOpenSkill={onOpenSkill} />
                {ref.pin && <span className="chip chip-muted" title="固定的版本">@{ref.pin}</span>}
                {REF_STATUS[ref.status] && <span className={`chip ${REF_STATUS[ref.status].className}`}>{REF_STATUS[ref.status].label}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {refs.undeclared.length > 0 && (
        <div className="relations-row">
          <span className="relations-label">正文还引用了</span>
          <span className="usage-empty">{refs.undeclared.join('、')}（没写进 depends_on）</span>
        </div>
      )}
      {refs.dependents.length > 0 && (
        <div className="relations-row">
          <span className="relations-label">被引用</span>
          <ul className="similar-list">
            {refs.dependents.map((s) => <li key={s.id}><SkillLink skill={s} onOpenSkill={onOpenSkill} /></li>)}
          </ul>
        </div>
      )}
      {shared.length > 0 && (
        <details className="usage-section" open={lint.some((i) => i.code === 'copies-meta' || i.code === 'extract-candidate')}>
          <summary>与其他技能相同的步骤（{shared.length}）</summary>
          <SharedSteps items={shared} onOpenSkill={onOpenSkill} />
        </details>
      )}
      {lint.length > 0 && (
        <details className="usage-section" open={lint.some((i) => i.level === 'warn')}>
          <summary>技能检查（{lint.length}）</summary>
          <LintList items={lint} />
        </details>
      )}
    </section>
  );
}
