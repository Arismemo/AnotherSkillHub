import FolderPicker from './FolderPicker';
import {
  ArrowDownAZ,
  Clock3,
  FolderInput,
  Plus,
  RotateCcw,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';

const folderLabels = {
  all: '全部技能',
  inbox: '收件箱',
  starred: '收藏',
  trash: '废纸篓',
};

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value));
}

export default function SkillList({
  skills,
  selectedSkillId,
  selectedIds,
  onSelectSkill,
  searchQuery,
  onSearchChange,
  currentFolder,
  currentTag,
  sortBy,
  onSortChange,
  onToggleStar,
  onQuickMove,
  onTrashSkill,
  onRestoreSkill,
  onPermanentDelete,
  onNewSkill,
  onBatchMove,
  onBatchTrash,
  folders,
  onClearSelection,
  loading,
  error,
  onRetry,
}) {
  const isTrash = currentFolder === 'trash';
  const listTitle = currentTag ? `标签：${currentTag}` : folderLabels[currentFolder] || currentFolder;
  const multiCount = selectedIds.size > 1 ? selectedIds.size : 0;

  const selectFromKeyboard = (event, skillId) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectSkill(skillId, event.metaKey || event.ctrlKey ? event : null);
    }
  };

  // C3: 拖拽携带单个/多个技能 id
  const dragStart = (event, skill) => {
    const ids = selectedIds.has(skill.id) ? [...selectedIds] : [skill.id];
    event.dataTransfer.setData('text/skill-id', String(skill.id));
    event.dataTransfer.setData('text/skill-ids', JSON.stringify(ids));
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="skill-list-panel">
      <div className="list-toolbar">
        <div className="search-field">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            placeholder="搜索技能"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            aria-label="搜索技能"
          />
        </div>
        <div className="list-heading-row">
          <div>
            <h2>{listTitle}</h2>
            <span>{skills.length} 个</span>
          </div>
          <button
            type="button"
            className="sort-button"
            onClick={() => onSortChange(sortBy === 'updated' ? 'name' : 'updated')}
            aria-label={sortBy === 'updated' ? '当前按更新时间排序，点击切换为名称' : '当前按名称排序，点击切换为更新时间'}
          >
            {sortBy === 'updated' ? <Clock3 size={13} /> : <ArrowDownAZ size={13} />}
            {sortBy === 'updated' ? '最近更新' : '名称'}
          </button>
        </div>
      </div>

      {multiCount > 0 && (
        <div className="batch-bar" role="toolbar" aria-label={`已选 ${multiCount} 个技能`}>
          <span>已选 {multiCount} 项</span>
          {!isTrash && (
            <FolderPicker
              folders={folders}
              value=""
              onChange={(path) => path && onBatchMove(path)}
              placeholder="移动到…"
              compact
            />
          )}
          <button type="button" className="danger-text-button" onClick={onBatchTrash}>
            <Trash2 size={13} />移入废纸篓
          </button>
          <button type="button" className="icon-button" onClick={onClearSelection} aria-label="清除选择">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="skill-list-scroll">
        {loading ? (
          <div className="list-skeleton" role="status" aria-label="正在载入技能列表">
            {[0, 1, 2].map((i) => (
              <div key={i}><i /><i /><i /></div>
            ))}
          </div>
        ) : error && skills.length === 0 ? (
          <div className="list-state" role="alert">
            <strong>载入失败</strong>
            <span>{error}</span>
            <button type="button" onClick={onRetry}>重试</button>
          </div>
        ) : skills.length === 0 ? (
          <div className="list-state">
            <strong>{searchQuery ? '没有匹配的技能' : isTrash ? '废纸篓为空' : '这里还没有技能'}</strong>
            <span>{searchQuery ? '尝试缩短关键词或清除筛选。' : isTrash ? '移入废纸篓的技能会显示在这里。' : '创建技能后即可开始整理。'}</span>
            {!isTrash && !searchQuery && <button type="button" onClick={onNewSkill}><Plus size={14} />新建技能</button>}
          </div>
        ) : (
          <ul className="skill-list" role="listbox" aria-label={listTitle}>
            {skills.map((skill) => {
              const isSelected = selectedSkillId === skill.id;
              const isChecked = selectedIds.has(skill.id) && multiCount > 0;
              return (
                <li
                  key={skill.id}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  className={`skill-row${isSelected ? ' is-selected' : ''}${isChecked ? ' is-checked' : ''}`}
                  onClick={(event) => onSelectSkill(skill.id, event)}
                  onKeyDown={(event) => selectFromKeyboard(event, skill.id)}
                  draggable
                  onDragStart={(event) => dragStart(event, skill)}
                >
                  <article>
                    <div className="skill-row-title">
                      {multiCount > 0 && <span className={`row-check${isChecked ? ' is-on' : ''}`} aria-hidden="true">{isChecked ? '✓' : ''}</span>}
                      <h3>{skill.name}</h3>
                      <button
                        type="button"
                        className={`icon-button star-button${skill.is_starred ? ' is-starred' : ''}`}
                        onClick={(event) => { event.stopPropagation(); onToggleStar(skill.id); }}
                        aria-label={`${skill.is_starred ? '取消收藏' : '收藏'} ${skill.name}`}
                        aria-pressed={Boolean(skill.is_starred)}
                      >
                        <Star size={14} aria-hidden="true" />
                      </button>
                    </div>
                    {skill.description && <p>{skill.description}</p>}
                    <footer>
                      <span className="skill-location">{skill.folder_path}</span>
                      <span className="skill-updated">{formatDate(skill.updated_at)}</span>
                      <span className="row-actions">
                        {!isTrash ? (
                          <>
                            <button type="button" className="icon-button" onClick={(event) => { event.stopPropagation(); onQuickMove(skill); }} aria-label={`移动 ${skill.name}`}><FolderInput size={14} /></button>
                            <button type="button" className="icon-button danger-button" onClick={(event) => { event.stopPropagation(); onTrashSkill(skill.id); }} aria-label={`将 ${skill.name} 移入废纸篓`}><Trash2 size={14} /></button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="icon-button" onClick={(event) => { event.stopPropagation(); onRestoreSkill(skill.id); }} aria-label={`恢复 ${skill.name}`}><RotateCcw size={14} /></button>
                            <button type="button" className="icon-button danger-button" onClick={(event) => { event.stopPropagation(); onPermanentDelete(skill.id); }} aria-label={`永久删除 ${skill.name}`}><Trash2 size={14} /></button>
                          </>
                        )}
                      </span>
                    </footer>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
