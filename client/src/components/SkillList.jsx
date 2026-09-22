import {
  ArrowDownAZ,
  Clock3,
  FolderInput,
  Plus,
  RotateCcw,
  Search,
  Star,
  Trash2,
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
  loading,
  error,
  onRetry,
}) {
  const isTrash = currentFolder === 'trash';
  const listTitle = currentTag ? `标签：${currentTag}` : folderLabels[currentFolder] || currentFolder;

  const selectFromKeyboard = (event, skillId) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectSkill(skillId);
    }
  };

  return (
    <div className="skill-list-panel">
      <header className="list-toolbar">
        <label className="search-field">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">搜索技能</span>
          <input
            type="search"
            placeholder="搜索技能"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
        <div className="list-heading-row">
          <div>
            <h2>{listTitle}</h2>
            <span>{loading ? '载入中' : `${skills.length} 个技能`}</span>
          </div>
          <button
            type="button"
            className="sort-button"
            onClick={() => onSortChange(sortBy === 'updated' ? 'name' : 'updated')}
            aria-label={`当前按${sortBy === 'updated' ? '更新时间' : '名称'}排序，点击切换`}
          >
            {sortBy === 'updated' ? <Clock3 size={14} /> : <ArrowDownAZ size={14} />}
            <span>{sortBy === 'updated' ? '最近更新' : '名称'}</span>
          </button>
        </div>
      </header>

      <div className="skill-list-scroll" role="listbox" aria-label={listTitle} aria-busy={loading}>
        {loading && skills.length === 0 ? (
          <div className="list-skeleton" role="status" aria-live="polite">
            <span className="sr-only">正在载入技能</span>
            {[0, 1, 2, 3].map((item) => <div key={item}><i /><i /><i /></div>)}
          </div>
        ) : error && skills.length === 0 ? (
          <div className="list-state" role="alert">
            <strong>无法载入技能</strong>
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
          skills.map((skill) => {
            const selected = selectedSkillId === skill.id;
            return (
              <article
                key={skill.id}
                className={`skill-row ${selected ? 'is-selected' : ''}`}
                role="option"
                aria-selected={selected}
                tabIndex={0}
                onClick={() => onSelectSkill(skill.id)}
                onKeyDown={(event) => selectFromKeyboard(event, skill.id)}
              >
                <div className="skill-row-title">
                  <h3>{skill.name}</h3>
                  {!isTrash && (
                    <button
                      type="button"
                      className={`icon-button star-button ${skill.is_starred ? 'is-starred' : ''}`}
                      onClick={(event) => { event.stopPropagation(); onToggleStar(skill.id); }}
                      aria-label={`${skill.is_starred ? '取消收藏' : '收藏'} ${skill.name}`}
                      aria-pressed={Boolean(skill.is_starred)}
                    >
                      <Star size={15} fill={skill.is_starred ? 'currentColor' : 'none'} />
                    </button>
                  )}
                </div>
                <p>{skill.description || '暂无描述'}</p>
                <footer>
                  <span className="skill-location">{skill.folder_path === 'inbox' ? '收件箱' : skill.folder_path}</span>
                  <span className="skill-updated">{formatDate(skill.updated_at)}</span>
                  <div className="row-actions" aria-label={`${skill.name} 操作`}>
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
                  </div>
                </footer>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
