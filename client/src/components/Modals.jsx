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

              // 快速粘贴 Markdown 导入技能弹窗 (大厂极简风格)
              export function PasteSkillModal({ isOpen, onClose, onImport, folders }) {
              if (!isOpen) return null;

              const [rawText, setRawText] = useState('');
              const [folderPath, setFolderPath] = useState('inbox');
              const [parsedInfo, setParsedInfo] = useState(null);

              const handleParseAndChange = (text) => {
              setRawText(text);
              if (!text.trim()) {
              setParsedInfo(null);
              return;
              }

              let name = '';
              let slug = '';
              let description = '';
              let tags = [];

              // 解析 YAML Frontmatter
              const trimmed = text.trim();
              if (trimmed.startsWith('---')) {
              const end = trimmed.indexOf('---', 3);
              if (end !== -1) {
              const fm = trimmed.slice(3, end);
              const nameMatch = fm.match(/^name:\s*(.+)$/m);
              const descMatch = fm.match(/^description:\s*(.+)$/m);
              const tagsMatch = fm.match(/^tags:\s*\[(.*)\]/m);

              if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, '');
              if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, '');
              if (tagsMatch) {
              tags = tagsMatch[1].split(',').map(t => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
              }
              }
              }

              // 从一级标题匹配名称
              if (!name) {
              const h1Match = text.match(/^#\s+(.+)$/m);
              if (h1Match) name = h1Match[1].trim();
              }

              if (name) {
              slug = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
              } else {
              slug = 'skill-' + Date.now().toString().slice(-4);
              name = slug;
              }

              setParsedInfo({ name, slug, description, tags });
              };

              const handleSubmit = (e) => {
              e.preventDefault();
              if (!rawText.trim()) return alert('请粘贴 Markdown 技能内容');

              const info = parsedInfo || {
              name: 'imported-skill',
              slug: 'imported-skill-' + Date.now().toString().slice(-4),
              description: '',
              tags: []
              };

              onImport({
              name: info.name,
              slug: info.slug,
              description: info.description,
              folder_path: folderPath || 'inbox',
              tags: info.tags,
              content: rawText
              });
              onClose();
              };

              return (
              <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl animate-in fade-in duration-200 flex flex-col max-h-[90vh]">
              <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-sm font-semibold">
                📋
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-100">快速粘贴导入技能</h3>
                <p className="text-xs text-slate-400">支持直接粘贴带 Frontmatter 的完整 SKILL.md，自动提取元数据</p>
              </div>
              </div>
              <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-all">
              <X size={16} />
              </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 flex-1 flex flex-col space-y-4 overflow-y-auto">
              {parsedInfo && (
              <div className="p-3.5 bg-slate-950/70 border border-indigo-500/30 rounded-xl flex items-center justify-between text-xs">
                <div className="flex items-center space-x-3">
                  <span className="text-indigo-400 font-semibold font-mono">识别成功:</span>
                  <span className="text-slate-200 font-medium">{parsedInfo.name}</span>
                  <span className="font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded">/{parsedInfo.slug}</span>
                </div>
                <div className="flex items-center space-x-2 text-slate-400">
                  <span>目标:</span>
                  <select
                    value={folderPath}
                    onChange={(e) => setFolderPath(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 outline-none"
                  >
                    <option value="inbox">📥 收件箱 (inbox)</option>
                    {folders.filter(f => f.path !== 'inbox').map(f => (
                      <option key={f.path} value={f.path}>📁 {f.path}</option>
                    ))}
                  </select>
                </div>
              </div>
              )}

              <div className="flex-1 flex flex-col">
              <label className="text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
                <span>粘贴 SKILL.md 内容</span>
                <span className="text-[11px] text-slate-500">自动解析 YAML 属性与正文</span>
              </label>
              <textarea
                required
                rows={14}
                value={rawText}
                onChange={(e) => handleParseAndChange(e.target.value)}
                placeholder="在此处直接 Cmd+V 粘贴技能 Markdown 内容，例如：&#10;---&#10;name: my-skill&#10;description: 技能说明&#10;---&#10;# 标题&#10;..."
                className="w-full flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs font-mono text-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none resize-none leading-relaxed"
              />
              </div>

              <div className="pt-2 flex justify-end space-x-3 flex-shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 transition-all flex items-center space-x-1.5"
              >
                <span>立即导入入库</span>
              </button>
              </div>
              </form>
              </div>
              </div>
              );
              }

              // 终端 Agent 万能接入命令弹窗
              export function AgentSetupModal({ isOpen, onClose }) {
              if (!isOpen) return null;

              const [copiedCmd, setCopiedCmd] = useState(false);
              const [copiedPrompt, setCopiedPrompt] = useState(false);

              const setupCmd = 'curl -fsSL https://skillhub.709970.xyz/setup.sh | bash';
              const agentPrompt = `你已接入企业技能中心 SkillHub (https://skillhub.709970.xyz)。
              • 需要新技能时运行: skillhub pull <slug>
              • 沉淀技能时运行: skillhub push <dir>
              • 搜索技能: skillhub search <keyword>`;

              const copyText = (text, type) => {
              navigator.clipboard.writeText(text);
              if (type === 'cmd') {
              setCopiedCmd(true);
              setTimeout(() => setCopiedCmd(false), 2000);
              } else {
              setCopiedPrompt(true);
              setTimeout(() => setCopiedPrompt(false), 2000);
              }
              };

              return (
              <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in duration-200">
              <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-sm font-semibold">
                ⚡
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-100">任意 Agent 终端一键接入</h3>
                <p className="text-xs text-slate-400">运行一条命令，任意终端（Mac / Linux / 4090 / 台架）即刻拥有技能中心调度能力</p>
              </div>
              </div>
              <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-all">
              <X size={16} />
              </button>
              </div>

              <div className="p-6 space-y-5 text-xs text-slate-300">
              <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-slate-200">1. 终端一键安装命令 (Bash / Shell):</span>
                <button
                  onClick={() => copyText(setupCmd, 'cmd')}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center space-x-1"
                >
                  <span>{copiedCmd ? '✓ 已复制' : '复制命令'}</span>
                </button>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 font-mono text-emerald-400 flex items-center justify-between select-all">
                <code>{setupCmd}</code>
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">
                该命令会自动安装 <code className="text-slate-400 font-mono">skillhub</code> 命令，并为当前终端 Agent 注入元技能。
              </p>
              </div>

              <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-slate-200">2. 发给 Agent 对话窗的系统引导指令 (可选):</span>
                <button
                  onClick={() => copyText(agentPrompt, 'prompt')}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center space-x-1"
                >
                  <span>{copiedPrompt ? '✓ 已复制' : '复制 Prompt'}</span>
                </button>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 font-mono text-slate-300 whitespace-pre-wrap leading-relaxed select-all">
                {agentPrompt}
              </div>
              </div>

              <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5 space-y-1.5 text-[11px] text-slate-400">
              <div className="font-semibold text-slate-300">常用终端指令参考:</div>
              <div>• <code className="text-indigo-300">skillhub pull &lt;slug&gt;</code> — 下载并完整解压技能包（含 scripts 脚本和文档）</div>
              <div>• <code className="text-indigo-300">skillhub push &lt;dir&gt;</code> — 将本地技能一键打包上传至云端收件箱</div>
              <div>• <code className="text-indigo-300">skillhub list</code> — 查看所有可用技能列表</div>
              </div>
              </div>
              </div>
              </div>
              );
              }
