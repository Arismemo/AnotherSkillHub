import React, { useState } from 'react';
import { 
  Inbox, Star, Archive, Trash2, Folder, FolderPlus, 
  ChevronRight, ChevronDown, Tag, MoreVertical, Edit2, Plus, Terminal, Check
} from 'lucide-react';

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
  onOpenSetup
}) {
  const [expanded, setExpanded] = useState({ 'inbox': true, 'ADL4': true });
  const [menuOpen, setMenuOpen] = useState(null);

  const toggleExpand = (path) => {
    setExpanded(prev => ({ ...prev, [path]: !prev[path] }));
  };

  // 构造多级树结构
  const buildTree = (folderList) => {
    const tree = [];
    const map = {};

    folderList.forEach(f => {
      if (f.path === 'inbox') return; // inbox 单独展示在最上面
      map[f.path] = { ...f, children: [] };
    });

    folderList.forEach(f => {
      if (f.path === 'inbox') return;
      if (f.parent_path && map[f.parent_path]) {
        map[f.parent_path].children.push(map[f.path]);
      } else {
        tree.push(map[f.path]);
      }
    });
    return tree;
  };

  const tree = buildTree(folders);

  // 渲染单个树节点
  const renderTreeNode = (node, depth = 0) => {
    const isSelected = currentFolder === node.path && !currentTag;
    const isExpanded = !!expanded[node.path];
    const hasChildren = node.children && node.children.length > 0;

    return (
      <div key={node.path} className="select-none">
        <div 
          onClick={() => onSelectFolder(node.path)}
          className={`group flex items-center justify-between px-3 py-1.5 rounded-lg text-sm transition-all cursor-pointer ${
            isSelected 
              ? 'bg-indigo-600 text-white font-medium shadow-sm' 
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}
          style={{ paddingLeft: `${Math.max(12, depth * 16 + 12)}px` }}
        >
          <div className="flex items-center space-x-2 truncate">
            {hasChildren ? (
              <button 
                onClick={(e) => { e.stopPropagation(); toggleExpand(node.path); }}
                className="p-0.5 hover:bg-slate-700/50 rounded"
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              <span className="w-3.5" />
            )}
            <Folder size={16} className={isSelected ? 'text-white' : 'text-indigo-400'} />
            <span className="truncate">{node.name}</span>
          </div>

          <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${isSelected ? 'bg-indigo-700 text-indigo-100' : 'bg-slate-800 text-slate-400'}`}>
              {node.count || 0}
            </span>
            <div className="relative">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(menuOpen === node.path ? null : node.path);
                }}
                className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white"
              >
                <MoreVertical size={13} />
              </button>

              {menuOpen === node.path && (
                <div 
                  className="absolute right-0 top-6 w-36 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1 z-30 text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button 
                    onClick={() => {
                      setMenuOpen(null);
                      const sub = prompt('请输入子分类名称:');
                      if (sub) onCreateFolder(`${node.path}/${sub}`);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-slate-700 flex items-center space-x-1.5"
                  >
                    <Plus size={12} />
                    <span>新建子目录</span>
                  </button>
                  <button 
                    onClick={() => {
                      setMenuOpen(null);
                      const newName = prompt('修改文件夹名称:', node.name);
                      if (newName && newName !== node.name) {
                        const segments = node.path.split('/');
                        segments[segments.length - 1] = newName;
                        onRenameFolder(node.path, segments.join('/'), newName);
                      }
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-slate-700 flex items-center space-x-1.5"
                  >
                    <Edit2 size={12} />
                    <span>重命名</span>
                  </button>
                  <button 
                    onClick={() => {
                      setMenuOpen(null);
                      if (confirm(`确定删除文件夹 "${node.name}" 吗？其内部的 Skill 将移回收件箱。`)) {
                        onDeleteFolder(node.path);
                      }
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-red-500/20 text-red-400 flex items-center space-x-1.5"
                  >
                    <Trash2 size={12} />
                    <span>删除目录</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div className="mt-0.5 space-y-0.5">
            {node.children.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-64 h-full bg-slate-950 border-r border-slate-800 flex flex-col select-none">
      {/* 顶栏品牌区 */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
            <Terminal size={18} />
          </div>
          <div>
            <h1 className="font-bold text-sm tracking-tight text-white flex items-center gap-1.5">
              SkillHub
              <span className="text-[10px] uppercase font-mono px-1 py-0.2 bg-indigo-500/20 text-indigo-400 rounded border border-indigo-500/30">Hub</span>
            </h1>
            <p className="text-[11px] text-slate-400">统一 Agent 技能中心</p>
          </div>
        </div>

        <button 
          onClick={onNewSkill}
          className="p-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors shadow-sm"
          title="创建新技能"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* 快捷操作栏：大厂高频工具 */}
      <div className="px-3 py-2.5 grid grid-cols-3 gap-1.5 border-b border-slate-800/80 bg-slate-950">
        <button
          onClick={onNewSkill}
          className="px-2 py-1.5 bg-slate-900 hover:bg-slate-800/90 border border-slate-800 rounded-lg text-[11px] font-medium text-slate-300 hover:text-white flex items-center justify-center space-x-1 transition-all"
          title="手动新建技能"
        >
          <Plus size={12} className="text-slate-400" />
          <span>新建</span>
        </button>

        <button
          onClick={onPasteImport}
          className="px-2 py-1.5 bg-indigo-950/40 hover:bg-indigo-900/60 border border-indigo-500/40 rounded-lg text-[11px] font-medium text-indigo-300 hover:text-white flex items-center justify-center space-x-1 transition-all"
          title="直接粘贴整段 Markdown 自动解析创建技能"
        >
          <span>📋 粘贴</span>
        </button>

        <button
          onClick={onOpenSetup}
          className="px-2 py-1.5 bg-slate-900 hover:bg-slate-800/90 border border-slate-800 rounded-lg text-[11px] font-medium text-emerald-400 hover:text-emerald-300 flex items-center justify-center space-x-1 transition-all"
          title="获取任意终端 Agent 一键接入命令"
        >
          <Terminal size={12} />
          <span>接入</span>
        </button>
      </div>

      {/* 滚动目录区 */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
        {/* 系统主分类（类似邮箱） */}
        <div className="space-y-1">
          {/* Inbox 收件箱 */}
          <button
            onClick={() => onSelectFolder('inbox')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all ${
              currentFolder === 'inbox' && !currentTag
                ? 'bg-amber-500/20 text-amber-300 font-medium border border-amber-500/30'
                : 'text-slate-300 hover:bg-slate-900 hover:text-white'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Inbox size={18} className={currentFolder === 'inbox' ? 'text-amber-400' : 'text-slate-400'} />
              <span>收件箱 (Inbox)</span>
            </div>
            {stats.inbox > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-amber-500 text-slate-950 animate-pulse">
                {stats.inbox}
              </span>
            )}
          </button>

          {/* Starred 收藏夹 */}
          <button
            onClick={() => onSelectFolder('starred')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all ${
              currentFolder === 'starred' && !currentTag
                ? 'bg-indigo-600 text-white font-medium'
                : 'text-slate-300 hover:bg-slate-900 hover:text-white'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Star size={18} className={currentFolder === 'starred' ? 'text-yellow-300 fill-yellow-300' : 'text-slate-400'} />
              <span>收藏 (Starred)</span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
              {stats.starred}
            </span>
          </button>

          {/* All 全部 */}
          <button
            onClick={() => onSelectFolder('all')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all ${
              currentFolder === 'all' && !currentTag
                ? 'bg-indigo-600 text-white font-medium'
                : 'text-slate-300 hover:bg-slate-900 hover:text-white'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Archive size={18} className={currentFolder === 'all' ? 'text-white' : 'text-slate-400'} />
              <span>全部技能 (All)</span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
              {stats.all}
            </span>
          </button>

          {/* Trash 废纸篓 */}
          <button
            onClick={() => onSelectFolder('trash')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all ${
              currentFolder === 'trash' && !currentTag
                ? 'bg-red-500/20 text-red-300 font-medium border border-red-500/30'
                : 'text-slate-400 hover:bg-slate-900 hover:text-white'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Trash2 size={18} className={currentFolder === 'trash' ? 'text-red-400' : 'text-slate-500'} />
              <span>废纸篓</span>
            </div>
            {stats.trash > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                {stats.trash}
              </span>
            )}
          </button>
        </div>

        {/* 自定义文件夹树 */}
        <div className="pt-2">
          <div className="flex items-center justify-between px-2 mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <span>分类文件夹</span>
            <button 
              onClick={() => {
                const name = prompt('请输入新目录名称 (支持路径如: ADL4/Planning):');
                if (name) onCreateFolder(name);
              }}
              className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-indigo-300 flex items-center gap-1"
              title="新建文件夹"
            >
              <FolderPlus size={14} />
            </button>
          </div>

          <div className="space-y-0.5">
            {tree.length === 0 ? (
              <p className="text-xs text-slate-500 px-3 py-2 italic">暂无自定义目录</p>
            ) : (
              tree.map(node => renderTreeNode(node))
            )}
          </div>
        </div>

        {/* 标签列表 */}
        {tags && tags.length > 0 && (
          <div className="pt-2">
            <div className="px-2 mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
              <Tag size={13} />
              <span>标签筛选</span>
            </div>
            <div className="flex flex-wrap gap-1.5 px-1">
              {tags.map(t => {
                const isSelected = currentTag === t;
                return (
                  <button
                    key={t}
                    onClick={() => onSelectTag(isSelected ? null : t)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                      isSelected
                        ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                        : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    #{t}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 底部终端 Agent 指引 */}
      <div className="p-3 bg-slate-900/60 border-t border-slate-800/80 text-[11px] text-slate-400 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="font-medium text-slate-300">终端推送支持</span>
          <span className="inline-flex items-center gap-1 text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
            就绪
          </span>
        </div>
        <div className="bg-slate-950 p-2 rounded border border-slate-800 font-mono text-[10px] text-slate-300 select-all overflow-x-auto">
          skillhub push ./my-skill
        </div>
      </div>
    </div>
  );
}
