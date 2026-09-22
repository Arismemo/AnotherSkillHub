import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

// 可搜索的选择器（文件夹/标签通用）：深色主题、输入过滤、键盘导航
// folders 模式: folders=[{path,...}], onChange(path)
// options 模式: options=[{value,label}], onChange(value)
export default function FolderPicker({
  folders, options, value, onChange,
  placeholder = '选择文件夹…', anyLabel, compact = false, iconOnly = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const items = useMemo(() => {
    let list;
    if (options) {
      list = options.map((o) => ({ value: o.value, label: o.label }));
    } else {
      const paths = [...new Set(['inbox', ...folders.map((f) => f.path)])].sort((a, b) => a.localeCompare(b, 'zh'));
      list = paths.map((p) => ({ value: p, label: p === 'inbox' ? '收件箱' : p }));
    }
    const q = query.trim().toLowerCase();
    return q ? list.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)) : list;
  }, [folders, options, query]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      setQuery('');
      setActiveIndex(0);
    }, 0);
    return () => { document.removeEventListener('mousedown', onDown); window.clearTimeout(t); };
  }, [open]);

  const pick = (val) => {
    onChange(val);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') { setOpen(false); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((i) => Math.min(i + 1, items.length - 1)); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    if (event.key === 'Enter' && items[activeIndex]) { event.preventDefault(); pick(items[activeIndex].value); }
  };

  const current = items.find((o) => o.value === value) || { label: value || anyLabel || placeholder };

  return (
    <div className={`folder-picker${compact ? ' is-compact' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="folder-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {iconOnly ? (
          <span className="folder-picker-icon" aria-hidden="true">{placeholder}</span>
        ) : (
          <span className="folder-picker-label">{current.label}</span>
        )}
        {!iconOnly && <ChevronDown size={13} aria-hidden="true" />}
      </button>
      {open && (
        <div className="folder-picker-popover" role="listbox">
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
                  {!options && (option.value === 'inbox' ? '📥 ' : '📁 ')}
                  {option.label}
                </span>
                {option.value === value && <Check size={13} aria-hidden="true" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
