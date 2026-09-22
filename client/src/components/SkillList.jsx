import React from 'react';
import { 
  Search, Star, Clock, Folder, Tag, Plus, ArrowUpDown, 
  Terminal, ShieldCheck, MoreVertical, Copy, Move, Trash2, RotateCcw
} from 'lucide-react';

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
  onCopySkill,
  onTrashSkill,
  onRestoreSkill,
  onPermanentDelete,
  onNewSkill
}) {
  const isTrash = currentFolder === 'trash';

  return (
    <div className="w-80 h-full bg-slate-900 border-r border-slate-800 flex flex-col select-none">
      {/* 搜索与过滤顶栏 */}
      <div className="p-3 border-b border-slate-800 space-y-2">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="搜索技能名称、描述、标签..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700/80 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        <div className="flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center space-x-1">
            <span className="font-medium text-slate-300">
              {currentTag ? `#${currentTag}` : currentFolder === 'all' ? '全部技能' : currentFolder === 'inbox' ? '收件箱' : currentFolder}
            </span>
            <span className="text-[11px] text-slate-500">({skills.length})</span>
          </div>

          <div className="flex items-center space-x-1">
            <button
              onClick={() => onSortChange(sortBy === 'time' ? 'name' : 'time')}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 hover:text-white flex items-center space-x-1 text-[11px]"
              title="切换排序"
            >
              <ArrowUpDown size={11} />
              <span>{sortBy === 'time' ? '最新' : '名称'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 列表流 */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 p-2 space-y-1">
        {skills.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-4 text-slate-500">
            <Terminal size={32} className="mb-2 text-slate-600 stroke-[1.5]" />
            <p className="text-xs font-medium text-slate-400">暂无匹配技能</p>
            <p className="text-[11px] text-slate-500 mt-1 max-w-[200px]">
              可以通过上方搜索不同关键词，或点击下方按钮新建
            </p>
            {!isTrash && (
              <button
                onClick={onNewSkill}
                className="mt-3 px-3 py-1.5 bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white rounded-lg text-xs font-medium border border-indigo-500/30 transition-all flex items-center space-x-1"
              >
                <Plus size={13} />
                <span>新建技能</span>
              </button>
            )}
          </div>
        ) : (
          skills.map((skill) => {
            const isSelected = selectedSkillId === skill.id || selectedSkillId === skill.slug;
            const isInbox = skill.folder_path === 'inbox';

            return (
              <div
                key={skill.id}
                onClick={() => onSelectSkill(skill.id)}
                className={`group relative p-3 rounded-xl transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-indigo-950/70 border border-indigo-500/50 shadow-md shadow-indigo-950/50'
                    : 'bg-slate-900/50 hover:bg-slate-800/80 border border-transparent'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-1.5">
                      <h3 className={`text-xs font-semibold truncate ${isSelected ? 'text-indigo-200' : 'text-slate-100 group-hover:text-white'}`}>
                        {skill.name}
                      </h3>
                      {skill.version && (
                        <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-slate-800 text-slate-400">
                          v{skill.version}
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-400 line-clamp-2 mt-1 leading-relaxed">
                      {skill.description || '暂无描述信息'}
                    </p>
                  </div>

                  {/* 星标按钮 */}
                  {!isTrash && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleStar(skill.id);
                      }}
                      className="p-1 text-slate-500 hover:text-yellow-400 transition-colors"
                    >
                      <Star 
                        size={14} 
                        className={skill.is_starred ? 'text-yellow-400 fill-yellow-400' : 'hover:text-yellow-400'} 
                      />
                    </button>
                  )}
                </div>

                {/* 底部属性标签栏 */}
                <div className="mt-2.5 flex items-center justify-between text-[10px] text-slate-400">
                  <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                    {/* Inbox 醒目标签 */}
                    {isInbox && !isTrash && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-medium border border-amber-500/30 flex items-center space-x-0.5">
                        <span>待整理</span>
                      </span>
                    )}

                    {/* 所属分类 */}
                    {!isInbox && !isTrash && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 flex items-center space-x-0.5">
                        <Folder size={10} className="text-slate-400" />
                        <span className="truncate max-w-[90px]">{skill.folder_path}</span>
                      </span>
                    )}

                    {/* 来源终端 */}
                    {skill.terminal_source && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-800/80 text-indigo-300 font-mono flex items-center space-x-0.5">
                        <Terminal size={10} />
                        <span className="truncate max-w-[70px]">{skill.terminal_source}</span>
                      </span>
                    )}
                  </div>

                  {/* 悬浮快捷操作菜单 */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-0.5">
                    {!isTrash ? (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onQuickMove(skill);
                          }}
                          className="p-1 hover:bg-slate-700 text-slate-300 hover:text-white rounded"
                          title="移动到文件夹"
                        >
                          <Move size={12} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onCopySkill(skill);
                          }}
                          className="p-1 hover:bg-slate-700 text-slate-300 hover:text-white rounded"
                          title="克隆副本"
                        >
                          <Copy size={12} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onTrashSkill(skill.id);
                          }}
                          className="p-1 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded"
                          title="移入废纸篓"
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onRestoreSkill(skill.id);
                          }}
                          className="p-1 hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-400 rounded"
                          title="恢复"
                        >
                          <RotateCcw size={12} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onPermanentDelete(skill.id);
                          }}
                          className="p-1 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded"
                          title="永久删除"
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
