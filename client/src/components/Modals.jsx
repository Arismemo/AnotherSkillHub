import React, { useState } from 'react';
import { X, Folder, Plus, Tag, Check, Move } from 'lucide-react';

export function NewSkillModal({ isOpen, onClose, onCreate, folders }) {
  if (!isOpen) return null;

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [folderPath, setFolderPath] = useState('inbox');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState([]);
  const [content, setContent] = useState(`---
name: my-new-skill
description: 技能说明与触发条件
tags: []
version: 1.0.0
---

# 新技能名称

## 触发场景
何时调用该技能。

## 指令流程
1. 第一步
2. 第二步
`);

  const handleNameChange = (e) => {
    const val = e.target.value;
    setName(val);
    if (!slug || slug === name.toLowerCase().replace(/[^a-z0-9_-]/g, '-')) {
      setSlug(val.toLowerCase().replace(/[^a-z0-9_-]/g, '-'));
    }
  };

  const handleAddTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!slug) return alert('请输入标识符 slug');
    onCreate({
      name: name || slug,
      slug,
      description,
      folder_path: folderPath || 'inbox',
      tags,
      content
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in duration-200">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-indigo-600/30 text-indigo-300 rounded-lg">
              <Plus size={16} />
            </div>
            <h3 className="text-sm font-bold text-white">创建新技能 (默认归入收件箱)</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">技能显示名称</label>
              <input
                type="text"
                placeholder="例如: Voyager Worldsim 仿真"
                value={name}
                onChange={handleNameChange}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">英文代号 (Slug / URL)</label>
              <input
                type="text"
                placeholder="voyager-worldsim"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-indigo-300 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">存放文件夹</label>
              <select
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="inbox">📥 收件箱 (Inbox) - 默认待整理</option>
                {folders.filter(f => f.path !== 'inbox').map(f => (
                  <option key={f.path} value={f.path}>📁 {f.path}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">添加标签 (Enter确认)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="输入标签名"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="px-3 bg-slate-800 hover:bg-slate-700 text-xs text-white rounded-lg"
                >
                  添加
                </button>
              </div>
            </div>
          </div>

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map(t => (
                <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-indigo-300 flex items-center space-x-1">
                  <span>#{t}</span>
                  <button type="button" onClick={() => setTags(tags.filter(x => x !== t))} className="hover:text-red-400">×</button>
                </span>
              ))}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">一句话描述 / 触发条件</label>
            <input
              type="text"
              placeholder="简要说明该技能的作用"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">SKILL.md 模板内容</label>
            <textarea
              rows={8}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="pt-3 border-t border-slate-800 flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 rounded-xl"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white rounded-xl shadow-md"
            >
              创建技能
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function MoveSkillModal({ isOpen, onClose, skill, folders, onMove }) {
  if (!isOpen || !skill) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-indigo-600/30 text-indigo-300 rounded-lg">
              <Move size={16} />
            </div>
            <h3 className="text-sm font-bold text-white">移动技能至目标文件夹</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
          <p className="text-xs text-slate-400 px-2 pb-1">
            选择目标文件夹归档 <span className="text-white font-medium">{skill.name}</span>:
          </p>

          <button
            onClick={() => { onMove(skill.id, 'inbox'); onClose(); }}
            className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center space-x-2 transition-all ${
              skill.folder_path === 'inbox' 
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium' 
                : 'hover:bg-slate-800 text-slate-300'
            }`}
          >
            <span>📥</span>
            <span>收件箱 (inbox)</span>
          </button>

          {folders.filter(f => f.path !== 'inbox').map(f => (
            <button
              key={f.path}
              onClick={() => { onMove(skill.id, f.path); onClose(); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center space-x-2 transition-all ${
                skill.folder_path === f.path 
                  ? 'bg-indigo-600 text-white font-medium' 
                  : 'hover:bg-slate-800 text-slate-300'
              }`}
            >
              <span>📁</span>
              <span>{f.path}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
