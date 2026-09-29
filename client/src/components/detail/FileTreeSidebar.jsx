import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileCode2, FileText, Folder, PanelLeftClose } from 'lucide-react';
import useResizableWidth from '../../hooks/useResizableWidth';

function buildFileTree(files) {
  const root = { name: '', path: '', children: new Map(), file: null };
  for (const file of files) {
    const parts = file.path.split('/');
    let node = root;
    parts.forEach((part, depth) => {
      const isLeaf = depth === parts.length - 1;
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, path: parts.slice(0, depth + 1).join('/'), children: new Map(), file: null });
      }
      node = node.children.get(part);
      if (isLeaf) node.file = file;
    });
  }
  return root;
}

function FileTreeNode({ node, depth, selectedFile, openFile, openDirs, toggleDir, hasSelectionInside, filterActive }) {
  const dirEntries = [...node.children.values()].sort((a, b) => {
    const aDir = a.children.size > 0;
    const bDir = b.children.size > 0;
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <ul className="file-tree" role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? '技能文件目录' : undefined}>
      {dirEntries.map((entry) => {
        const isDir = entry.children.size > 0;
        // 过滤激活时强制展开所有目录，保证匹配文件可见
        const expanded = filterActive || openDirs.has(entry.path);
        if (isDir) {
          return (
            <li key={entry.path} role="none">
              <button
                type="button"
                className="file-tree-row file-tree-dir"
                style={{ '--tree-depth': depth }}
                aria-expanded={expanded}
                onClick={() => toggleDir(entry.path)}
              >
                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Folder size={13} />
                <span>{entry.name}</span>
              </button>
              {(expanded || hasSelectionInside(entry)) && (
                <FileTreeNode
                  node={entry}
                  depth={depth + 1}
                  selectedFile={selectedFile}
                  openFile={openFile}
                  openDirs={openDirs}
                  toggleDir={toggleDir}
                  hasSelectionInside={hasSelectionInside}
                  filterActive={filterActive}
                />
              )}
            </li>
          );
        }
        const file = entry.file;
        const active = selectedFile === file.path;
        return (
          <li key={file.path} role="none">
            <button
              type="button"
              role="treeitem"
              aria-selected={active}
              className={`file-tree-row file-tree-file${active ? ' is-active' : ''}`}
              style={{ '--tree-depth': depth }}
              onClick={() => openFile(file.path)}
            >
              <span className="file-tree-leaf-spacer" aria-hidden="true" />
              {file.isMain || file.path.endsWith('.md') ? <FileText size={13} /> : <FileCode2 size={13} />}
              <span>{file.name}</span>
              <small>{Math.max(1, Math.round(file.size / 1024))} KB</small>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// 技能文件栏：文件树 + 路径过滤 + 可拖宽。收起/展开由 SkillDetail 按滚动区宽度决定，这里只渲染两种形态。
export default function FileTreeSidebar({ files, selectedFile, onOpenFile, collapsed, onCollapse, onExpand }) {
  const [openDirs, setOpenDirs] = useState(() => new Set());
  // D1: 面板宽度持久化
  const [fileSidebarWidth, , fileSidebarResizer] = useResizableWidth('file-sidebar-width', { min: 160, max: 480, initial: 240, label: '调整技能文件栏宽度' });
  // A2: 文件树过滤
  const [fileFilter, setFileFilter] = useState('');

  const treeData = useMemo(() => buildFileTree(files), [files]);

  // A2: 文件树过滤（含路径子串匹配）
  const filteredTreeData = useMemo(() => {
    const q = fileFilter.trim().toLowerCase();
    if (!q) return treeData;
    const filtered = files.filter((f) => f.path.toLowerCase().includes(q));
    return buildFileTree(filtered);
  }, [treeData, fileFilter, files]);

  const toggleDir = (dirPath) => {
    setOpenDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  };

  const hasSelectionInside = (node) => {
    if (!selectedFile) return false;
    if (node.file && node.file.path === selectedFile) return true;
    for (const child of node.children.values()) {
      if (hasSelectionInside(child)) return true;
    }
    return false;
  };

  if (collapsed) {
    return (
      <button
        type="button"
        className="file-sidebar-rail"
        onClick={onExpand}
        aria-label={`展开技能文件（${files.length} 个）`}
        title="展开技能文件"
      >
        <span className="rail-count">{files.length}</span>
        <span className="rail-label">文件</span>
      </button>
    );
  }

  return (
    <aside className="file-sidebar" aria-label="技能文件" style={{ '--file-sidebar-w': `${fileSidebarWidth}px` }}>
      <div className="attachment-heading">
        <h3 id="attachments-heading">技能文件</h3>
        <span>{files.length} 个</span>
        <button type="button" className="icon-button" onClick={onCollapse} aria-label="收起技能文件" title="收起技能文件">
          <PanelLeftClose size={13} />
        </button>
      </div>
      <div className="file-filter">
        <input
          type="search"
          value={fileFilter}
          onChange={(event) => setFileFilter(event.target.value)}
          placeholder="过滤文件…"
          aria-label="过滤技能文件"
        />
      </div>
      <div className="file-sidebar-scroll">
        <FileTreeNode
          node={filteredTreeData}
          depth={0}
          selectedFile={selectedFile}
          openFile={onOpenFile}
          openDirs={openDirs}
          toggleDir={toggleDir}
          hasSelectionInside={hasSelectionInside}
          filterActive={Boolean(fileFilter.trim())}
        />
        {fileFilter.trim() && filteredTreeData.children.size === 0 && (
          <p className="file-filter-empty">没有匹配「{fileFilter.trim()}」的文件</p>
        )}
      </div>
      <div {...fileSidebarResizer} />
    </aside>
  );
}
