import { useMemo, useState } from 'react';
import { collapseDiff, diffFileLists, diffLines, diffStats } from '../utils/lineDiff';
import './Review.css';

// 行级差异视图：默认只显示改动附近 3 行上下文，可展开全文
export default function DiffView({ before, after, beforeLabel = '当前版本', afterLabel = '新版本', beforeFiles, afterFiles }) {
  const [expanded, setExpanded] = useState(false);
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  const stats = useMemo(() => diffStats(lines), [lines]);
  const shown = useMemo(() => (expanded ? lines : collapseDiff(lines)), [expanded, lines]);
  const fileChanges = useMemo(
    () => (beforeFiles && afterFiles ? diffFileLists(beforeFiles, afterFiles) : null),
    [beforeFiles, afterFiles],
  );
  const hasFileChanges = fileChanges && (fileChanges.added.length || fileChanges.removed.length || fileChanges.changed.length);

  return (
    <div className="diff-view">
      <div className="diff-summary">
        <span><i className="diff-swatch is-del" aria-hidden="true" />{beforeLabel}</span>
        <span><i className="diff-swatch is-add" aria-hidden="true" />{afterLabel}</span>
        <span className="diff-counts">SKILL.md <b className="is-add">+{stats.added}</b> <b className="is-del">−{stats.removed}</b></span>
        <button type="button" className="secondary-button" onClick={() => setExpanded((v) => !v)}>{expanded ? '只看改动' : '展开全文'}</button>
      </div>
      {hasFileChanges ? (
        <ul className="diff-files" aria-label="附属文件变化">
          {fileChanges.added.map((p) => <li key={`a-${p}`} className="is-add">+ {p}</li>)}
          {fileChanges.removed.map((p) => <li key={`r-${p}`} className="is-del">− {p}</li>)}
          {fileChanges.changed.map((p) => <li key={`c-${p}`}>~ {p}</li>)}
        </ul>
      ) : null}
      {stats.added === 0 && stats.removed === 0 ? (
        <p className="diff-empty">SKILL.md 正文没有变化。</p>
      ) : (
        <pre className="diff-lines" aria-label="SKILL.md 差异">
          {shown.map((line, index) => (line.type === 'skip' ? (
            <span key={index} className="diff-line is-skip">… {line.count} 行未改动 …</span>
          ) : (
            <span key={index} className={`diff-line is-${line.type}`}>
              <i aria-hidden="true">{line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}</i>{line.text || ' '}
            </span>
          )))}
        </pre>
      )}
    </div>
  );
}
