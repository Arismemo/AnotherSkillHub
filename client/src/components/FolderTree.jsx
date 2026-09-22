import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Inbox,
  MoreHorizontal,
  Plus,
  Star,
  Terminal,
  Trash2,
} from 'lucide-react';

const navItems = [
  { id: 'inbox', label: '收件箱', icon: Inbox },
  { id: 'starred', label: '收藏', icon: Star },
  { id: 'all', label: '全部技能', icon: Archive },
  { id: 'trash', label: '废纸篓', icon: Trash2 },
];

export default function FolderTree({
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
}) {
  const [expanded, setExpanded] = useState({ ADL4: true });
  const [menuOpen, setMenuOpen] = useState(null);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMenuOpen(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

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

  const renderTreeNode = (node, depth = 0) => {
    const isSelected = currentFolder === node.path && !currentTag;
    const hasChildren = node.children.length > 0;
    const isExpanded = Boolean(expanded[node.path]);

    return (
      <li key={node.path}>
        <div className="folder-row" style={{ '--folder-depth': depth }}>
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
      <header className="brand-row">
        <div className="brand-mark" aria-hidden="true"><Terminal size={17} /></div>
        <div className="min-w-0">
          <h1>SkillHub</h1>
          <p>Agent 技能库</p>
        </div>
      </header>

      <div className="sidebar-actions" aria-label="快捷操作">
        <button type="button" onClick={onNewSkill}><Plus size={14} />新建</button>
        <button type="button" onClick={onPasteImport}>粘贴导入</button>
        <button type="button" onClick={onOpenSetup}>终端接入</button>
      </div>

      <div className="sidebar-scroll">
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

        {tags.length > 0 && (
          <section className="sidebar-section" aria-labelledby="tags-heading">
            <div className="section-heading"><h2 id="tags-heading">标签</h2></div>
            <label className="tag-filter">
              <span className="sr-only">按标签筛选</span>
              <select value={currentTag || ''} onChange={(event) => onSelectTag(event.target.value || null)}>
                <option value="">全部标签</option>
                {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
              </select>
            </label>
          </section>
        )}
      </div>
    </div>
  );
}
