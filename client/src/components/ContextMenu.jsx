import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// 通用右键菜单：portal 渲染 + 视口夹取，点外部/滚动/Esc 关闭。
// 行内操作原本只有 hover 才出现的 4 个 16px 图标，右键菜单把它们变成可发现、可键盘到达的入口。
export default function ContextMenu({ x, y, items, onClose }) {
  const panelRef = useRef(null);
  const [position, setPosition] = useState({ left: x, top: y, visibility: 'hidden' });

  useLayoutEffect(() => {
    const element = panelRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
      visibility: 'visible',
    });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', close);
    document.addEventListener('scroll', close, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', close);
    panelRef.current?.querySelector('button')?.focus();
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('scroll', close, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  return createPortal(
    <div ref={panelRef} className="context-menu" role="menu" style={position}>
      {items.filter(Boolean).map((item, index) => (item.separator ? (
        <hr key={`sep-${index}`} />
      ) : (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={item.danger ? 'danger-item' : ''}
          onClick={() => { onClose(); item.onSelect(); }}
        >
          <span>{item.label}</span>
          {item.hint && <kbd>{item.hint}</kbd>}
        </button>
      )))}
    </div>,
    document.body,
  );
}
