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

  const dragRef = useRef(null);

  const persist = useCallback((value) => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch { /* 存储不可用则静默降级为内存态 */ }
  }, [storageKey]);

  // 拖拽期间不落盘：mousemove 每像素一次同步 localStorage 写入，必掉帧
  useEffect(() => {
    if (dragRef.current) return;
    persist(width);
  }, [persist, width]);

  useEffect(() => {
    const stop = () => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.frame) window.cancelAnimationFrame(drag.frame);
      dragRef.current = null;
      document.body.classList.remove('is-resizing');
      // 最后一帧可能还没提交，这里用最终坐标补上，再一次性落盘
      const final = clamp(drag.startWidth + drag.clientX - drag.startX);
      setWidth(final);
      persist(final);
    };
    // mousemove 可以比刷新率还密：按 rAF 合并，一帧最多一次 setState
    const onMove = (event) => {
      const drag = dragRef.current;
      if (!drag) return;
      drag.clientX = event.clientX;
      if (drag.frame) return;
      drag.frame = window.requestAnimationFrame(() => {
        if (!dragRef.current) return;
        dragRef.current.frame = 0;
        setWidth(clamp(dragRef.current.startWidth + dragRef.current.clientX - dragRef.current.startX));
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stop);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', stop);
      stop();
    };
  }, [clamp, persist]);

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
      dragRef.current = { startX: event.clientX, startWidth: width, clientX: event.clientX, frame: 0 };
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
