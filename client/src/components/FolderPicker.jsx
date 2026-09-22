import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

// 可搜索的文件夹选择器：深色主题、输入过滤、键盘导航
// value: 当前路径（'' 表示未选），onChange(path)，folders: [{path, name}]
export default function FolderPicker({ folders, value, onChange, placeholder = '选择文件夹…', allowInbox = true, compact = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const options = useMemo(() => {
    const list = [];
    if (allowInbox) list.push({ path: 'inbox', name: '收件箱' });
    folders.filter((f) => f.path !== 'inbox').forEach((f) => list.push({ path: f.path, name: f.path }));
    const q = query.trim().toLowerCase();
    return q ? list.filter((o) => o.path.toLowerCase().includes(q) || o.name.toLowerCase().includes(q)) : list;
  }, [folders, query, allowInbox]);


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

  const pick = (path) => {
    onChange(path);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') { setOpen(false); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((i) => Math.min(i + 1, options.length - 1)); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    if (event.key === 'Enter' && options[activeIndex]) { event.preventDefault(); pick(options[activeIndex].path); }
  };

  const current = options.find((o) => o.path === value) || (value === 'inbox' ? { name: '收件箱' } : { name: placeholder });

  return (
    <div className={`folder-picker${compact ? ' is-compact' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="folder-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="folder-picker-label">{current.name}</span>
        <ChevronDown size={13} aria-hidden="true" />
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
              placeholder="搜索文件夹…"
              aria-label="搜索文件夹"
            />
          </div>
          <ul>
            {options.length === 0 && <li className="folder-picker-empty">没有匹配的文件夹</li>}
            {options.map((option, index) => (
              <li
                key={option.path}
                role="option"
                aria-selected={option.path === value}
                className={index === activeIndex ? 'is-active' : ''}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => pick(option.path)}
              >
                <span className="folder-picker-option-name">
                  {option.path === 'inbox' ? '📥 ' : '📁 '}
                  {option.name}
                </span>
                {option.path === value && <Check size={13} aria-hidden="true" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
