import React, { useState, useEffect } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import { 
  Copy, Check, Terminal, ExternalLink, Edit3, Eye, 
  Save, Folder, Tag, Star, Clock, AlertCircle, Share2, 
  Download, Sparkles, CornerUpRight, Move
} from 'lucide-react';

marked.setOptions({
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch (err) {}
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true
});

const splitFrontmatter = (text) => {
  if (!text) return { frontmatter: '', body: '' };
  const trimmed = text.trim();
  if (trimmed.startsWith('---')) {
    const end = trimmed.indexOf('---', 3);
    if (end !== -1) {
      return {
        frontmatter: trimmed.slice(3, end).trim(),
        body: trimmed.slice(end + 3).trim()
      };
    }
  }
  return { frontmatter: '', body: trimmed };
};

export default function SkillDetail({
  skill,
  onSave,
  onMoveFolder,
  onToggleStar,
  folders,
  allTags
}) {
  if (!skill) {
    return (
      <div className="flex-1 h-full bg-slate-950 flex flex-col items-center justify-center text-slate-500">
        <Sparkles size={40} className="text-slate-700 mb-3" />
        <p className="text-sm font-medium text-slate-400">选择左侧列表中的技能以查看详情</p>
        <p className="text-xs text-slate-600 mt-1">支持实时在线编辑、文件夹归档与一键复制给 Agent 使用</p>
      </div>
    );
  }

  const [mode, setMode] = useState('preview'); // 'preview' | 'edit'
  const [content, setContent] = useState(skill.content || '');
  const [name, setName] = useState(skill.name || '');
  const [description, setDescription] = useState(skill.description || '');
  const [copiedAgent, setCopiedAgent] = useState(false);
  const [copiedCli, setCopiedCli] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  useEffect(() => {
    setName(skill.name || '');
    setDescription(skill.description || '');
    setMode('preview');

    if (skill.content) {
      setContent(skill.content);
    } else {
      setIsLoadingDetail(true);
      fetch(`/api/skills/${skill.id}`)
        .then(res => res.json())
        .then(data => {
          if (data && data.content) {
            setContent(data.content);
            if (data.name) setName(data.name);
            if (data.description) setDescription(data.description);
          }
        })
        .catch(err => console.error('Failed to load full skill content:', err))
        .finally(() => setIsLoadingDetail(false));
    }
  }, [skill.id, skill.content]);

  const origin = window.location.origin;
  const agentUrl = `${origin}/s/${skill.slug}`;
  const agentPrompt = `请加载并使用技能：${agentUrl}`;
  const cliCmd = `curl -fsSL ${origin}/s/${skill.slug}/install.sh | bash`;

  const copyToClipboard = (text, type) => {
    navigator.clipboard.writeText(text).then(() => {
      if (type === 'agent') {
        setCopiedAgent(true);
        setTimeout(() => setCopiedAgent(false), 2500);
      } else if (type === 'cli') {
        setCopiedCli(true);
        setTimeout(() => setCopiedCli(false), 2500);
      } else if (type === 'link') {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2500);
      }
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave({
        ...skill,
        name,
        description,
        content
      });
      setMode('preview');
    } finally {
      setIsSaving(false);
    }
  };

  const isInbox = skill.folder_path === 'inbox';

  return (
    <div className="flex-1 h-full bg-slate-950 flex flex-col overflow-hidden select-text">
      {/* 顶栏控制条 */}
      <div className="px-6 py-3.5 border-b border-slate-800 bg-slate-950/80 backdrop-blur flex items-center justify-between gap-4">
        {/* 左侧：标题与归档状态 */}
        <div className="flex items-center space-x-3 min-w-0">
          <div className="flex flex-col min-w-0">
            <div className="flex items-center space-x-2">
              <h2 className="text-base font-bold text-white tracking-tight truncate">
                {skill.name}
              </h2>
              {skill.version && (
                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                  v{skill.version}
                </span>
              )}
            </div>

            <div className="flex items-center space-x-2 text-xs text-slate-400 mt-0.5">
              <span className="font-mono text-indigo-400">/{skill.slug}</span>
              <span>•</span>
              <div className="flex items-center space-x-1">
                <Folder size={12} className={isInbox ? 'text-amber-400' : 'text-slate-400'} />
                <span className={isInbox ? 'text-amber-300 font-medium' : 'text-slate-300'}>
                  {skill.folder_path}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧：动作按钮 */}
        <div className="flex items-center space-x-2">
          {/* 移动到其他文件夹下拉 */}
          <div className="relative">
            <select
              value={skill.folder_path}
              onChange={(e) => onMoveFolder(skill.id, e.target.value)}
              className="bg-slate-900 border border-slate-700 text-slate-300 hover:text-white text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="inbox">📁 放入收件箱 (inbox)</option>
              {folders
                .filter(f => f.path !== 'inbox')
                .map(f => (
                  <option key={f.path} value={f.path}>
                    📂 移至 {f.path}
                  </option>
                ))
              }
            </select>
          </div>

          {/* 预览 / 编辑切换 */}
          <div className="bg-slate-900 border border-slate-800 p-0.5 rounded-lg flex items-center">
            <button
              onClick={() => setMode('preview')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all flex items-center space-x-1 ${
                mode === 'preview' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Eye size={13} />
              <span>预览</span>
            </button>
            <button
              onClick={() => setMode('edit')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all flex items-center space-x-1 ${
                mode === 'edit' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Edit3 size={13} />
              <span>编辑</span>
            </button>
          </div>

          {mode === 'edit' && (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-all flex items-center space-x-1 shadow-sm"
            >
              <Save size={13} />
              <span>{isSaving ? '保存中...' : '保存修改'}</span>
            </button>
          )}
        </div>
      </div>

      {/* 核心操作横幅：一键复制给 Agent */}
      <div className="bg-gradient-to-r from-indigo-950/60 via-slate-900 to-slate-950 border-b border-indigo-900/30 p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-start space-x-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-300 shrink-0">
              <Sparkles size={18} />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-indigo-200">直接发给 Agent 使用</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-500/20 text-indigo-300 font-mono">
                  Prompt / CLI 通用
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 max-w-xl">
                点击下方按钮复制指令或链接，发送到任意 Agent（Hermes、Codex、Claude 等）即可直接调用。
              </p>
            </div>
          </div>

          {/* 操作按钮组 */}
          <div className="flex items-center space-x-2 flex-wrap gap-y-2">
            {/* 核心大按钮：复制 Agent 加载指令 */}
            <button
              onClick={() => copyToClipboard(agentPrompt, 'agent')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all flex items-center space-x-1.5 shadow-md ${
                copiedAgent 
                  ? 'bg-emerald-600 text-white shadow-emerald-900/40' 
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-900/40 hover:scale-[1.02]'
              }`}
            >
              {copiedAgent ? <Check size={14} /> : <Copy size={14} />}
              <span>{copiedAgent ? '已复制 Agent 指令！' : '📋 复制 Agent 指令'}</span>
            </button>

            {/* 复制 CLI 安装命令 */}
            <button
              onClick={() => copyToClipboard(cliCmd, 'cli')}
              className={`px-3 py-2 rounded-xl text-xs font-medium border transition-all flex items-center space-x-1.5 ${
                copiedCli 
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/50' 
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
              }`}
              title="复制 curl 安装到终端的命令"
            >
              {copiedCli ? <Check size={13} /> : <Terminal size={13} />}
              <span>{copiedCli ? '已复制 CLI 命令' : '⚡ 复制安装命令'}</span>
            </button>

            {/* 复制原始链接 */}
            <button
              onClick={() => copyToClipboard(agentUrl, 'link')}
              className={`px-2.5 py-2 rounded-xl text-xs border transition-all flex items-center space-x-1 ${
                copiedLink 
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/50' 
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border-slate-800 hover:text-white'
              }`}
              title="复制技能 URL"
            >
              {copiedLink ? <Check size={13} /> : <Share2 size={13} />}
            </button>

            {/* 打开原始 Markdown */}
            <a
              href={`${agentUrl}.md`}
              target="_blank"
              rel="noreferrer"
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800 transition-all text-xs flex items-center"
              title="直接查看原始 Markdown"
            >
              <ExternalLink size={13} />
            </a>
          </div>
        </div>
      </div>

      {/* 主体区域 */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {mode === 'preview' ? (
          <div className="max-w-4xl mx-auto space-y-6">
            {/* 元信息卡片 */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">技能描述</span>
                  <p className="text-sm text-slate-200 mt-1 leading-relaxed">
                    {skill.description || '无详细描述'}
                  </p>
                </div>
              </div>

              {/* 标签列表 */}
              {skill.tags && skill.tags.length > 0 && (
                <div className="flex items-center space-x-2 pt-2 border-t border-slate-800/60 flex-wrap gap-y-1">
                  <span className="text-xs text-slate-400 flex items-center space-x-1">
                    <Tag size={12} />
                    <span>标签:</span>
                  </span>
                  {skill.tags.map(t => (
                    <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-indigo-300 font-mono border border-slate-700/60">
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Markdown 正文渲染 */}
            {isLoadingDetail ? (
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-8 text-center text-slate-500 animate-pulse">
                <div className="h-4 bg-slate-800 rounded w-1/3 mx-auto mb-3"></div>
                <div className="h-3 bg-slate-800/60 rounded w-2/3 mx-auto mb-2"></div>
                <div className="h-3 bg-slate-800/40 rounded w-1/2 mx-auto"></div>
              </div>
            ) : content ? (
              <div className="space-y-4">
                {splitFrontmatter(content).frontmatter && (
                  <details className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-3 text-xs font-mono text-slate-400">
                    <summary className="cursor-pointer text-slate-400 hover:text-slate-200 font-sans font-medium flex items-center space-x-1 select-none">
                      <span>⚙️ 原始 Frontmatter 元数据 (点击展开)</span>
                    </summary>
                    <pre className="mt-2.5 p-3 rounded-lg bg-slate-950/80 text-indigo-300 overflow-x-auto text-xs leading-relaxed border border-slate-800/60">
                      {splitFrontmatter(content).frontmatter}
                    </pre>
                  </details>
                )}

                <div className="prose prose-invert max-w-none prose-pre:bg-slate-900 prose-pre:border prose-pre:border-slate-800 prose-headings:text-slate-100 prose-headings:font-bold prose-a:text-indigo-400 prose-code:text-indigo-300 prose-code:bg-slate-900/80 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none leading-relaxed bg-slate-900/30 p-6 rounded-2xl border border-slate-800/60 shadow-sm">
                  <div 
                    dangerouslySetInnerHTML={{ 
                      __html: marked.parse(splitFrontmatter(content).body || content) 
                    }} 
                  />
                </div>
              </div>
            ) : (
              <div className="bg-slate-900/40 border border-dashed border-slate-800 rounded-2xl p-8 text-center text-slate-500">
                <p className="text-sm font-medium text-slate-400">暂无详细正文说明</p>
                <p className="text-xs text-slate-600 mt-1">点击右上角“编辑”按钮即可开始编写 SKILL.md 文档与指令</p>
              </div>
            )}
          </div>
        ) : (
          /* 编辑模式 */
          <div className="max-w-4xl mx-auto space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">技能显示名称</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">一句话描述 / Trigger</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">SKILL.md 正文内容 (Markdown + Frontmatter)</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={22}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500 leading-relaxed resize-y"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
