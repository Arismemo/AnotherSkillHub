// 分享页文件树：把平铺的文件列表按目录折叠展示。折叠状态（记的是「收起的目录」）只归这里管，
// 切换选中文件不影响展开状态；分组逻辑复用 utils/fileTree，与详情页同一棵树。
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileCode2, FileText, Folder } from 'lucide-react';
import { buildFileTree } from '../utils/fileTree';

function humanSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

// SKILL.md 永远排最前，其次目录、再其余文件；同级内按名称稳定排序
function compareEntries(a, b) {
  if (a.file?.isMain) return -1;
  if (b.file?.isMain) return 1;
  const aDir = a.children.size > 0;
  const bDir = b.children.size > 0;
  if (aDir !== bDir) return aDir ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function ShareTreeNode({ node, depth, selectedFile, onOpenFile, collapsedDirs, toggleDir }) {
  const entries = [...node.children.values()].sort(compareEntries);

  return (
    <ul className="share-tree-list">
      {entries.map((entry) => {
        if (entry.children.size > 0) {
          const expanded = !collapsedDirs.has(entry.path);
          return (
            <li key={entry.path}>
              <button
                type="button"
                className="share-tree-row share-tree-dir"
                style={{ '--tree-depth': depth }}
                aria-expanded={expanded}
                onClick={() => toggleDir(entry.path)}
              >
                {expanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
                <Folder size={13} aria-hidden="true" />
                <span>{entry.name}</span>
              </button>
              {expanded && (
                <ShareTreeNode
                  node={entry}
                  depth={depth + 1}
                  selectedFile={selectedFile}
                  onOpenFile={onOpenFile}
                  collapsedDirs={collapsedDirs}
                  toggleDir={toggleDir}
                />
              )}
            </li>
          );
        }
        const file = entry.file;
        const active = selectedFile === file.path;
        return (
          <li key={file.path}>
            <button
              type="button"
              className={`share-tree-row share-tree-file${active ? ' is-active' : ''}`}
              style={{ '--tree-depth': depth }}
              aria-current={active ? 'true' : undefined}
              title={file.path}
              onClick={() => onOpenFile(file.path)}
            >
              <span className="share-tree-spacer" aria-hidden="true" />
              {file.isMain || file.path.endsWith('.md') ? <FileText size={13} aria-hidden="true" /> : <FileCode2 size={13} aria-hidden="true" />}
              <span>{entry.name}</span>
              <small>{humanSize(file.size)}</small>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// 技能文件栏：标题 + 文件数，树整体在唯一的滚动容器里；原生 button 自带 Tab/Enter/Space，
// 没做方向键轮巡，所以不声明 role=tree，只用嵌套列表 + aria-expanded 折叠语义。
export default function ShareFileTree({ files, selectedFile, onOpenFile }) {
  const [collapsedDirs, setCollapsedDirs] = useState(() => new Set()); // 默认全部展开

  const tree = useMemo(() => buildFileTree(files), [files]);

  const toggleDir = (dirPath) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  };

  return (
    <aside className="share-files" aria-label="技能文件">
      <div className="share-files-heading">
        <h3>技能文件</h3>
        <span>{files.length} 个</span>
      </div>
      <div className="share-tree-scroll">
        <ShareTreeNode
          node={tree}
          depth={0}
          selectedFile={selectedFile}
          onOpenFile={onOpenFile}
          collapsedDirs={collapsedDirs}
          toggleDir={toggleDir}
        />
      </div>
    </aside>
  );
}
