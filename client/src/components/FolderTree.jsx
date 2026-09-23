import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
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

const navItems = [
  { id: 'inbox', label: '收件箱', icon: Inbox },
  { id: 'starred', label: '收藏', icon: Star },
  { id: 'all', label: '全部技能', icon: Archive },
  { id: 'trash', label: '废纸篓', icon: Trash2 },
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
        <div className={`folder-row${isDropTarget ? ' is-drop-target' : ''}`} style={{ '--folder-depth': depth }} {...dropHandlers(node.path)}>
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

  return (
    <div className="sidebar-content">
      <div className="sidebar-actions" aria-label="快捷操作">
        <button type="button" onClick={onNewSkill}><Plus size={14} />新建</button>
        <button type="button" onClick={onPasteImport}>粘贴导入</button>
      </div>

      <div className="sidebar-scroll" ref={treeRef}>
        <nav aria-label="系统分类">
          <ul className="nav-list">
            {navItems.map(({ id, label, icon: Icon }) => {
              const active = currentFolder === id && !currentTag;
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={`nav-item ${active ? 'is-active' : ''}`}
                    onClick={() => onSelectFolder(id)}
                    aria-current={active ? 'page' : undefined}
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
                  <button type="button" className="nav-item nav-bundle" onClick={() => onSelectBundle(b)} title={b.name}>
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
    </div>
  );
}
