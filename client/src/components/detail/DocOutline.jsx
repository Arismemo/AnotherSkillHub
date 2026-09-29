import { EyeOff, List } from 'lucide-react';

// 悬浮大纲本体；隐藏时只渲染「显示大纲」按钮。状态与滚动逻辑见 hooks/useDocOutline。
export default function DocOutline({ headings, activeIndex, hidden, onJump, onHide, onShow }) {
  if (hidden) {
    return (
      <button
        type="button"
        className="doc-outline-restore"
        onClick={onShow}
        aria-label="显示大纲"
        title="显示大纲"
      >
        <List size={14} />
      </button>
    );
  }

  return (
    <nav className="doc-outline" aria-label="文档大纲">
      <div className="doc-outline-header">
        <span>大纲</span>
        <button
          type="button"
          className="doc-outline-toggle"
          onClick={onHide}
          aria-label="隐藏大纲"
          title="隐藏大纲"
        >
          <EyeOff size={13} />
        </button>
      </div>
      <ul>
        {headings.map((heading, index) => (
          <li key={heading.id} className={index === activeIndex ? 'is-active' : ''} style={{ '--outline-level': heading.level - 1 }}>
            <button type="button" onClick={() => onJump(index)} title={heading.text}>
              {heading.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
