import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ClipboardPaste,
  ChevronDown,
  ChevronRight,
  Clock3,
  Package,
  Folder,
  FolderPlus,
  Inbox,
  MoreHorizontal,
  Plus,
  Settings,
  Star,
  Trash2,
} from 'lucide-react';
import FolderPicker from './FolderPicker';
import ContextMenu from './ContextMenu';

// droppable：拖技能过来有明确语义（归档 / 加星 / 删除）；「全部技能」不是归属地，不接收拖放
const navItems = [
  { id: 'inbox', label: '收件箱', icon: Inbox, droppable: true },
  { id: 'starred', label: '收藏', icon: Star, droppable: true },
  { id: 'all', label: '全部技能', icon: Archive },
  { id: 'trash', label: '废纸篓', icon: Trash2, droppable: true },
];

function findNode(nodes, path) {
  for (const node of nodes) {
    if (node.path === path) return node;
    const found = findNode(node.children, path);
    if (found) return found;
  }
  return null;
}

export default function FolderTree({
  collapsed = false,
  bundles = [],
  onSelectBundle,
  onNewBundle,

  currentFolder,
  onSelectFolder,
  currentTag,
  onSelectTag,
  stats,
  folders,
  tags,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onNewSkill,
  onPasteImport,
  onOpenSetup,
  recentSkills = [],
  onDropOnFolder,
}) {
  const [expanded, setExpanded] = useState({ ADL4: true });
  const [menuOpen, setMenuOpen] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const treeRef = useRef(null);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMenuOpen(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  // 点击菜单外部时关闭文件夹操作菜单
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event) => {
      if (!event.target.closest('.folder-menu-wrap')) {
        setMenuOpen(null);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [menuOpen]);

  const tree = useMemo(() => {
    const roots = [];
    const map = {};
    folders.forEach((folder) => {
      if (folder.path !== 'inbox') map[folder.path] = { ...folder, children: [] };
    });
    folders.forEach((folder) => {
      if (folder.path === 'inbox') return;
      if (folder.parent_path && map[folder.parent_path]) {
        map[folder.parent_path].children.push(map[folder.path]);
      } else {
        roots.push(map[folder.path]);
      }
    });
    return roots;
  }, [folders]);

  // A3: 树键盘导航（↑↓ 移动、→ 展开、← 收起、Enter 打开）
  useEffect(() => {
    const el = treeRef.current;
    if (!el) return undefined;
    const onKeyDown = (event) => {
      if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) return;
      const buttons = [...el.querySelectorAll('.folder-select')];
      const currentIndex = buttons.indexOf(document.activeElement);
      if (currentIndex === -1) return;
      event.preventDefault();
      const path = document.activeElement.dataset.path;
      const node = findNode(tree, path);
      switch (event.key) {
        case 'ArrowDown':
          buttons[currentIndex + 1]?.focus();
          break;
        case 'ArrowUp':
          buttons[currentIndex - 1]?.focus();
          break;
        case 'ArrowRight':
          if (node && node.children.length > 0 && !expanded[node.path]) {
            setExpanded((value) => ({ ...value, [node.path]: true }));
          }
          break;
        case 'ArrowLeft':
          if (node && expanded[node.path]) {
            setExpanded((value) => ({ ...value, [node.path]: false }));
          }
          break;
        case 'Enter':
        case ' ':
          onSelectFolder(path);
          break;
        default:
          break;
      }
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  });

  const createFolder = (parentPath = '') => {
    const name = window.prompt(parentPath ? '输入子文件夹名称' : '输入文件夹名称或路径');
    if (!name?.trim()) return;
    onCreateFolder(parentPath ? `${parentPath}/${name.trim()}` : name.trim());
  };

  const renameFolder = (node) => {
    const newName = window.prompt('输入新的文件夹名称', node.name);
    if (!newName?.trim() || newName.trim() === node.name) return;
    const pathParts = node.path.split('/');
    pathParts[pathParts.length - 1] = newName.trim();
    onRenameFolder(node.path, pathParts.join('/'), newName.trim());
  };

  const deleteFolder = (node) => {
    if (window.confirm(`删除“${node.name}”？其中的技能会移回收件箱。`)) {
      onDeleteFolder(node.path);
    }
  };

  // C3: 拖放目标高亮
  const dropHandlers = (path) => ({
    onDragOver: (event) => {
      event.preventDefault();
      setDropTarget(path);
    },
    onDragLeave: () => setDropTarget((p) => (p === path ? null : p)),
    onDrop: (event) => {
      setDropTarget(null);
      onDropOnFolder?.(event, path);
    },
  });

  const renderTreeNode = (node, depth = 0) => {
    const isSelected = currentFolder === node.path && !currentTag;
    const hasChildren = node.children.length > 0;
    const isExpanded = Boolean(expanded[node.path]);
    const isDropTarget = dropTarget === node.path;

    return (
      <li key={node.path}>
        <div
          className={`folder-row${isDropTarget ? ' is-drop-target' : ''}`}
          style={{ '--folder-depth': depth }}
          onContextMenu={(event) => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, node }); }}
          {...dropHandlers(node.path)}
        >
          {hasChildren ? (
            <button
              type="button"
              className="icon-button folder-disclosure"
              onClick={() => setExpanded((value) => ({ ...value, [node.path]: !value[node.path] }))}
              aria-label={`${isExpanded ? '收起' : '展开'} ${node.name}`}
              aria-expanded={isExpanded}
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : <span className="folder-disclosure-spacer" />}
          <button
            type="button"
            className={`folder-select ${isSelected ? 'is-active' : ''}`}
            onClick={() => onSelectFolder(node.path)}
            aria-current={isSelected ? 'page' : undefined}
            data-path={node.path}
          >
            <Folder size={15} aria-hidden="true" />
            <span className="truncate">{node.name}</span>
            {node.count > 0 && <span className="nav-count">{node.count}</span>}
          </button>
          <div className="folder-menu-wrap">
            <button
              type="button"
              className="icon-button folder-more"
              onClick={() => setMenuOpen(menuOpen === node.path ? null : node.path)}
              aria-label={`${node.name} 文件夹操作`}
              aria-expanded={menuOpen === node.path}
            >
              <MoreHorizontal size={15} />
            </button>
            {menuOpen === node.path && (
              <div className="folder-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(null); createFolder(node.path); }}>新建子文件夹</button>
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(null); renameFolder(node); }}>重命名</button>
                <button type="button" role="menuitem" className="danger-item" onClick={() => { setMenuOpen(null); deleteFolder(node); }}>删除</button>
              </div>
            )}
          </div>
        </div>
        {hasChildren && isExpanded && <ul>{node.children.map((child) => renderTreeNode(child, depth + 1))}</ul>}
      </li>
    );
  };

  // 折叠态不是一条空白竖条：系统分类 + 最近浏览 + 顶层文件夹都保留成图标入口，
  // 计数收成右上角小圆点，hover 出完整标题。
  if (collapsed) {
    const railItems = [
      ...navItems.map((item) => ({ ...item, count: stats[item.id] || 0 })),
      { id: 'recent', label: '最近浏览', icon: Clock3, count: recentSkills.length },
    ];
    return (
      <div className="sidebar-content sidebar-rail">
        <ul className="nav-list" aria-label="系统分类">
          {railItems.map(({ id, label, icon: Icon, count, droppable }) => {
            const active = currentFolder === id && !currentTag;
            return (
              <li key={id}>
                <button
                  type="button"
                  className={`nav-item rail-item ${active ? 'is-active' : ''}${dropTarget === id ? ' is-drop-target' : ''}`}
                  onClick={() => onSelectFolder(id)}
                  aria-current={active ? 'page' : undefined}
                  aria-label={count > 0 ? `${label}（${count}）` : label}
                  title={count > 0 ? `${label}（${count}）` : label}
                  {...(droppable ? dropHandlers(id) : {})}
                >
                  <Icon size={16} aria-hidden="true" />
                  {count > 0 && <span className="rail-dot" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        {tree.length > 0 && (
          <ul className="nav-list rail-folders" aria-label="文件夹">
            {tree.slice(0, 8).map((node) => {
              const active = currentFolder === node.path && !currentTag;
              return (
                <li key={node.path}>
                  <button
                    type="button"
                    className={`nav-item rail-item ${active ? 'is-active' : ''}`}
                    onClick={() => onSelectFolder(node.path)}
                    aria-current={active ? 'page' : undefined}
                    aria-label={node.count > 0 ? `${node.name}（${node.count}）` : node.name}
                    title={node.count > 0 ? `${node.name}（${node.count}）` : node.name}
                    {...dropHandlers(node.path)}
                  >
                    <Folder size={15} aria-hidden="true" />
                    {node.count > 0 && <span className="rail-dot" aria-hidden="true">{node.count > 99 ? '99+' : node.count}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="sidebar-footer">
          <button type="button" className="nav-item rail-item" onClick={onNewSkill} aria-label="新建技能" title="新建技能"><Plus size={16} /></button>
          <button type="button" className="nav-item rail-item" onClick={onPasteImport} aria-label="粘贴导入" title="粘贴导入"><ClipboardPaste size={16} /></button>
          <button type="button" className="nav-item rail-item" onClick={onOpenSetup} aria-label="终端接入" title="终端接入"><Settings size={16} /></button>
        </div>
      </div>
    );
  }

  return (
    <div className="sidebar-content">
      <div className="sidebar-actions" aria-label="快捷操作">
        <button type="button" onClick={onNewSkill}><Plus size={14} />新建</button>
        <button type="button" onClick={onPasteImport}>粘贴导入</button>
      </div>

      <div className="sidebar-scroll" ref={treeRef}>
        <nav aria-label="系统分类">
          <ul className="nav-list">
            {navItems.map(({ id, label, icon: Icon, droppable }) => {
              const active = currentFolder === id && !currentTag;
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={`nav-item ${active ? 'is-active' : ''}${dropTarget === id ? ' is-drop-target' : ''}`}
                    onClick={() => onSelectFolder(id)}
                    aria-current={active ? 'page' : undefined}
                    {...(droppable ? dropHandlers(id) : {})}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span>{label}</span>
                    {stats[id] > 0 && <span className="nav-count">{stats[id]}</span>}
                  </button>
                </li>
              );
            })}
                          <li>
                <button
                  type="button"
                  className={`nav-item ${currentFolder === 'recent' && !currentTag ? 'is-active' : ''}`}
                  onClick={() => onSelectFolder('recent')}
                  aria-current={currentFolder === 'recent' && !currentTag ? 'page' : undefined}
                >
                  <Clock3 size={16} aria-hidden="true" />
                  <span>最近浏览</span>
                  <span className="nav-count">{recentSkills.length}</span>
                </button>
              </li>
          </ul>
        </nav>

        <section className="sidebar-section" aria-labelledby="folders-heading">
          <div className="section-heading">
            <h2 id="folders-heading">文件夹</h2>
            <button type="button" className="icon-button" onClick={() => createFolder()} aria-label="新建文件夹">
              <FolderPlus size={15} />
            </button>
          </div>
          {tree.length ? <ul className="folder-tree">{tree.map((node) => renderTreeNode(node))}</ul> : <p className="sidebar-empty">暂无文件夹</p>}
        </section>

        <section className="sidebar-section" aria-labelledby="bundles-heading">
          <div className="section-heading">
            <h2 id="bundles-heading">技能组合</h2>
            <button type="button" className="icon-button" onClick={onNewBundle} aria-label="新建技能组合" title="新建技能组合">
              <FolderPlus size={15} />
            </button>
          </div>
          {bundles.length ? (
            <ul className="nav-list">
              {bundles.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    className={`nav-item nav-bundle${dropTarget === `bundle:${b.id}` ? ' is-drop-target' : ''}`}
                    onClick={() => onSelectBundle(b)}
                    title={`${b.name}（可把技能拖到这里加入组合）`}
                    {...dropHandlers(`bundle:${b.id}`)}
                  >
                    <Package size={16} aria-hidden="true" />
                    <span className="truncate">{b.name}</span>
                    <span className="nav-count">{b.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sidebar-empty">暂无组合——组合是技能的快捷方式集合，可一次安装全部</p>
          )}
        </section>

        {tags.length > 0 && (
          <section className="sidebar-section" aria-labelledby="tags-heading">
            <div className="section-heading"><h2 id="tags-heading">标签</h2></div>
            <FolderPicker
              options={tags.map((t) => ({ value: t, label: t }))}
              value={currentTag || ''}
              onChange={(v) => onSelectTag(v || null)}
              anyLabel="全部标签"
              placeholder="全部标签"
              compact
            />
          </section>
        )}
      </div>

      <div className="sidebar-footer">
        <button type="button" className="nav-item" onClick={onOpenSetup}>
          <Settings size={16} aria-hidden="true" />
          <span>终端接入</span>
        </button>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            { label: '在此目录中查看', onSelect: () => onSelectFolder(contextMenu.node.path) },
            { label: '新建子文件夹', onSelect: () => createFolder(contextMenu.node.path) },
            { label: '重命名', onSelect: () => renameFolder(contextMenu.node) },
            { separator: true },
            { label: '删除文件夹', danger: true, onSelect: () => deleteFolder(contextMenu.node) },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
