import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';

// ⌘K 命令面板：模糊搜索技能 + 执行命令，键盘全程操作（Linear/Raycast 式）
// 模糊匹配：连续命中加分、前缀命中加分、精确匹配最高
function fuzzyScore(query, text) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) {
    return t.startsWith(q) ? 100 - t.length * 0.1 : 60 - t.length * 0.1;
  }
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (let qi = 0; qi < q.length; qi += 1) {
    const ch = q[qi];
    let found = -1;
    for (let i = ti; i < t.length; i += 1) {
      if (t[i] === ch) { found = i; break; }
    }
    if (found === -1) return 0;
    streak = found === ti ? streak + 1 : 1;
    score += 10 + streak * 2 + (found === 0 ? 8 : 0);
    ti = found + 1;
  }
  return score;
}

export default function CommandPalette({
  isOpen,
  onClose,
  skills,
  folders,
  onSelectSkill,
  onSelectFolder,
  onNewSkill,
  onPasteImport,
  onOpenSetup,
  onToggleSidebar,
}) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    // 打开时重置并聚焦（setState 在 setTimeout 中，避免 effect 同步级联渲染警告）
    const timer = window.setTimeout(() => {
      setQuery('');
      setActiveIndex(0);
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  const commands = useMemo(() => {
    const items = [];
    skills.forEach((s) => {
      items.push({
        type: 'skill',
        key: `skill-${s.id}`,
        title: s.name,
        subtitle: `/${s.slug} · ${s.folder_path}`,
        keywords: `${s.slug} ${s.name} ${s.description || ''} ${(s.tags || []).join(' ')}`,
        action: () => onSelectSkill(s.id),
      });
    });
    folders.filter((f) => f.path !== 'inbox').forEach((f) => {
      items.push({
        type: 'folder',
        key: `folder-${f.path}`,
        title: f.name,
        subtitle: `目录 · ${f.path}`,
        keywords: f.path,
        action: () => onSelectFolder(f.path),
      });
    });
    items.push(
      { type: 'command', key: 'cmd-inbox', title: '打开收件箱', subtitle: '导航', keywords: 'inbox 收件箱', action: () => onSelectFolder('inbox') },
      { type: 'command', key: 'cmd-all', title: '查看全部技能', subtitle: '导航', keywords: 'all 全部', action: () => onSelectFolder('all') },
      { type: 'command', key: 'cmd-starred', title: '查看收藏', subtitle: '导航', keywords: 'starred 收藏', action: () => onSelectFolder('starred') },
      { type: 'command', key: 'cmd-new', title: '新建技能', subtitle: '创建', keywords: 'new create 新建 创建', action: onNewSkill },
      { type: 'command', key: 'cmd-paste', title: '粘贴导入技能', subtitle: '创建', keywords: 'paste import 粘贴 导入', action: onPasteImport },
      { type: 'command', key: 'cmd-setup', title: '终端接入命令', subtitle: '设置', keywords: 'setup terminal cli 终端 接入', action: onOpenSetup },
      { type: 'command', key: 'cmd-sidebar', title: '收起/展开导航栏', subtitle: '视图', keywords: 'sidebar toggle 导航 收起 展开', action: onToggleSidebar },
    );
    return items;
  }, [skills, folders, onSelectSkill, onSelectFolder, onNewSkill, onPasteImport, onOpenSetup, onToggleSidebar]);

  const results = useMemo(() => {
    if (!query.trim()) return commands.slice(0, 12);
    return commands
      .map((c) => ({ command: c, score: Math.max(fuzzyScore(query.trim(), c.title), fuzzyScore(query.trim(), c.keywords) * 0.8) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((r) => r.command);
  }, [commands, query]);

  const execute = useCallback((item) => {
    if (!item) return;
    item.action();
    onClose();
  }, [onClose]);

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      execute(results[activeIndex]);
    }
  };

  useEffect(() => {
    const el = listRef.current?.children[activeIndex];
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!isOpen) return null;

  return (
    <div className="palette-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette-panel" role="dialog" aria-modal="true" aria-label="命令面板">
        <div className="palette-input-row">
          <span className="palette-icon" aria-hidden="true"><Search size={15} /></span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            onKeyDown={onKeyDown}
            placeholder="搜索技能、目录或命令…"
            aria-label="搜索"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
          />
          <kbd>Esc</kbd>
        </div>
        <ul id="palette-list" ref={listRef} role="listbox">
          {results.length === 0 && (
            <li className="palette-empty">没有匹配「{query.trim()}」的结果</li>
          )}
          {results.map((item, index) => (
            <li
              key={item.key}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'is-active' : ''}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => execute(item)}
            >
              <span className="palette-item-title">{item.title}</span>
              <span className="palette-item-sub">{item.subtitle}</span>
              {item.type === 'skill' && <i className="palette-badge" aria-hidden="true">技能</i>}
              {item.type === 'folder' && <i className="palette-badge" aria-hidden="true">目录</i>}
              {item.type === 'command' && <i className="palette-badge is-cmd" aria-hidden="true">命令</i>}
            </li>
          ))}
        </ul>
        <div className="palette-footer">
          <span><kbd>↑↓</kbd> 选择</span>
          <span><kbd>↵</kbd> 执行</span>
          <span><kbd>Esc</kbd> 关闭</span>
        </div>
      </div>
    </div>
  );
}
