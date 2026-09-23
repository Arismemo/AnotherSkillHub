import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Folder, Inbox, Search } from 'lucide-react';
import { folderLabels } from '../utils/systemFolders';

// 可搜索的选择器（文件夹/标签通用）：输入过滤、键盘导航
// folders 模式: folders=[{path,...}], onChange(path)
// options 模式: options=[{value,label}], onChange(value)
export default function FolderPicker({
  folders, options, value, onChange,
  placeholder = '选择文件夹…', anyLabel, compact = false, iconOnly = false, title,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const inputRef = useRef(null);
  const [popStyle, setPopStyle] = useState(null);

  const closePicker = () => {
    triggerRef.current?.focus();
    setOpen(false);
  };

  const items = useMemo(() => {
    let list;
    if (options) {
      list = options.map((o) => ({ value: o.value, label: o.label }));
    } else {
      const paths = [...new Set(['inbox', ...folders.map((f) => f.path)])].sort((a, b) => a.localeCompare(b, 'zh'));
      list = paths.map((p) => ({ value: p, label: p === 'inbox' ? folderLabels.inbox : p }));
    }
    const q = query.trim().toLowerCase();
    return q ? list.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)) : list;
  }, [folders, options, query]);

  useEffect(() => {
    if (!open) return undefined;
    const updatePos = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const W = 256; // 16rem
      let left = r.left;
      if (left + W > window.innerWidth - 8) left = Math.max(8, r.right - W);
      let top = r.bottom + 6;
      // 真实高度渲染后二次校准（见下方 requestAnimationFrame）
      setPopStyle({ position: 'fixed', left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, width: `${W}px`, maxWidth: 'calc(100vw - 1rem)', right: 'auto' });
    };
    updatePos();
    // 渲染后用真实高度校准：向上翻转时保持紧贴 trigger 顶部
    const raf = requestAnimationFrame(() => {
      const pop = document.getElementById('ash-folder-popover');
      const tr = triggerRef.current?.getBoundingClientRect();
      if (!pop || !tr) return;
      const w = 256;
      let left = tr.left;
      if (left + w > window.innerWidth - 8) left = Math.max(8, tr.right - w);
      const CHROME = 58; // 搜索框 + padding 占位
      const spaceBelow = window.innerHeight - tr.bottom - 12;
      const spaceAbove = tr.top - 12;
      const naturalH = pop.offsetHeight; // 未限高的自然高度
      let top;
      let maxListH;
      if (spaceBelow >= Math.min(naturalH, 200)) {
        // 下方放得下：向下展开（紧贴 trigger 下方 6px）
        top = tr.bottom + 6;
        maxListH = spaceBelow >= naturalH ? 100000 : Math.max(140, spaceBelow - CHROME);
      } else if (spaceAbove >= 200) {
        // 上方更充裕：向上翻转，紧贴 trigger 上方 6px（高度与限高自洽）
        maxListH = Math.max(140, Math.min(naturalH - CHROME, spaceAbove - CHROME));
        const hUse = Math.min(naturalH, maxListH + CHROME);
        top = Math.max(8, tr.top - hUse - 6);
      } else {
        top = tr.bottom + 6;
        maxListH = 200;
      }
      const finish = (finalTop) => {
        setPopStyle({ position: 'fixed', left: `${Math.round(left)}px`, top: `${Math.round(finalTop)}px`, width: `${w}px`, maxWidth: 'calc(100vw - 1rem)', right: 'auto', '--pop-max-list': `${Math.round(maxListH)}px`, visibility: 'visible' });
      };
      if (top < tr.bottom) {
        // 上翻：等限高 var 生效后按真实高度贴底（双通道 rAF + timeout 兜底）
        const calibrate = () => {
          const pop2 = document.getElementById('ash-folder-popover');
          const tr2 = triggerRef.current?.getBoundingClientRect();
          if (!pop2 || !tr2) { finish(top); return; }
          const h2 = pop2.offsetHeight;
          finish(Math.max(8, tr2.top - h2 - 6));
        };
        // 先以 hidden 应用限高 var
        setPopStyle({ position: 'fixed', left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, width: `${w}px`, maxWidth: 'calc(100vw - 1rem)', right: 'auto', '--pop-max-list': `${Math.round(maxListH)}px`, visibility: 'hidden' });
        requestAnimationFrame(calibrate);
        window.setTimeout(calibrate, 30);
      } else {
        finish(top);
      }
    });
    const onDown = (event) => {
      if (!rootRef.current?.contains(event.target) && !document.getElementById('ash-folder-popover')?.contains(event.target)) closePicker();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', updatePos);
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      setQuery('');
      setActiveIndex(0);
    }, 0);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('mousedown', onDown); window.removeEventListener('resize', updatePos); window.clearTimeout(t); };
  }, [open]);

  const pick = (val) => {
    onChange(val);
    closePicker();
    setQuery('');
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closePicker(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((i) => Math.min(i + 1, items.length - 1)); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    if (event.key === 'Enter' && items[activeIndex]) { event.preventDefault(); pick(items[activeIndex].value); }
  };

  const current = items.find((o) => o.value === value) || { label: value || anyLabel || placeholder };

  return (
    <div className={`folder-picker${compact ? ' is-compact' : ''}${iconOnly ? ' iconOnly' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="folder-picker-trigger"
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (open && event.key === 'Escape') { event.preventDefault(); closePicker(); }
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={title || (iconOnly ? undefined : current.label)}
      >
        {iconOnly ? (
          <span className="folder-picker-icon" aria-hidden="true">{placeholder}</span>
        ) : (
          <span className="folder-picker-label">{current.label}</span>
        )}
        {!iconOnly && <ChevronDown size={13} aria-hidden="true" />}
      </button>
      {open && createPortal(
        <div
          id="ash-folder-popover"
          className="folder-picker-popover"
          role="listbox"
          style={popStyle || undefined}
          onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); closePicker(); } }}
        >
          <div className="folder-picker-search">
            <Search size={13} aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={options ? '搜索…' : '搜索文件夹…'}
              aria-label={options ? '搜索选项' : '搜索文件夹'}
            />
          </div>
          <ul>
            {anyLabel && !query.trim() && (
              <li
                role="option"
                aria-selected={value === null || value === undefined || value === ''}
                className={activeIndex === 0 ? 'is-active' : ''}
                onMouseEnter={() => setActiveIndex(-1)}
                onClick={() => pick(options ? '' : '')}
              >
                <span className="folder-picker-option-name">{anyLabel}</span>
                {(value === null || value === undefined || value === '') && <Check size={13} aria-hidden="true" />}
              </li>
            )}
            {items.length === 0 && <li className="folder-picker-empty">没有匹配项</li>}
            {items.map((option, index) => (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                className={index === activeIndex ? 'is-active' : ''}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => pick(option.value)}
              >
                <span className="folder-picker-option-name">
                  {!options && (option.value === 'inbox' ? <Inbox size={13} aria-hidden="true" /> : <Folder size={13} aria-hidden="true" />)}
                  {option.label}
                </span>
                {option.value === value && <Check size={13} aria-hidden="true" />}
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}
