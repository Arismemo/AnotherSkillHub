import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 可拖宽面板的通用实现：鼠标拖拽 + 键盘 ←/→ + 双击复位 + localStorage 记忆。
 * 这套逻辑原本只写在 SkillDetail 的「技能文件栏」里，三栏主骨架用不上；
 * 抽出来之后侧栏 / 列表 / 文件栏共用同一份行为与无障碍语义。
 *
 * 只支持「拖拽条在面板右缘」的场景（向右拖 = 变宽），这也是本项目仅有的形态。
 */
export default function useResizableWidth(key, { min, max, initial, step = 24, label }) {
  const storageKey = `ash:${key}`;
  const clamp = useCallback((value) => Math.min(Math.max(Math.round(value), min), max), [min, max]);

  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(JSON.parse(window.localStorage.getItem(storageKey)));
      return saved >= min && saved <= max ? saved : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(width));
    } catch { /* 存储不可用则静默降级为内存态 */ }
  }, [storageKey, width]);

  const dragRef = useRef(null);
  useEffect(() => {
    const stop = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.classList.remove('is-resizing');
    };
    const onMove = (event) => {
      if (!dragRef.current) return;
      setWidth(clamp(dragRef.current.startWidth + event.clientX - dragRef.current.startX));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stop);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', stop);
      stop();
    };
  }, [clamp]);

  const resizerProps = {
    className: 'pane-resizer',
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-label': label,
    'aria-valuenow': width,
    'aria-valuemin': min,
    'aria-valuemax': max,
    tabIndex: 0,
    onMouseDown: (event) => {
      dragRef.current = { startX: event.clientX, startWidth: width };
      document.body.classList.add('is-resizing');
      event.preventDefault();
    },
    onDoubleClick: () => setWidth(initial),
    onKeyDown: (event) => {
      if (event.key === 'ArrowLeft') setWidth((w) => clamp(w - step));
      if (event.key === 'ArrowRight') setWidth((w) => clamp(w + step));
    },
  };

  return [width, setWidth, resizerProps];
}
