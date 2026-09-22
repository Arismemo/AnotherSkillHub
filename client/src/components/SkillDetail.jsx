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
  const [fileTree, setFileTree] = useState([]);
  const [selectedFile, setSelectedFile] = useState('SKILL.md');
  const [auxFileContent, setAuxFileContent] = useState('');
  const [isLoadingFile, setIsLoadingFile] = useState(false);

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
            if (data.file_tree) setFileTree(data.file_tree);
          }
        })
        .catch(err => console.error('Failed to load full skill content:', err))
        .finally(() => setIsLoadingDetail(false));
    }
  }, [skill.id, skill.content]);

  useEffect(() => {
    if (selectedFile === 'SKILL.md') {
      setAuxFileContent('');
      return;
    }
    setIsLoadingFile(true);
    fetch(`/api/skills/${skill.id}/file?path=${encodeURIComponent(selectedFile)}`)
      .then(res => res.json())
      .then(data => {
        setAuxFileContent(data.content || '');
      })
      .catch(err => setAuxFileContent('// 加载文件失败: ' + err.message))
      .finally(() => setIsLoadingFile(false));
  }, [selectedFile, skill.id]);

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
      {/* 顶栏控制条：大厂极简风格 */}
      <div className="px-6 py-3 border-b border-slate-800/80 bg-slate-950 flex items-center justify-between gap-4">
        {/* 左侧：面包屑与标题 */}
        <div className="flex items-center space-x-3 min-w-0">
          <div className="flex flex-col min-w-0">
            <div className="flex items-center space-x-2 text-[11px] text-slate-500 font-mono">
              <span>SkillHub</span>
              <span>/</span>
              <span className={isInbox ? "text-amber-400 font-medium" : "text-slate-400"}>{skill.folder_path}</span>
              <span>/</span>
              <span className="text-indigo-400 font-semibold">{skill.slug}</span>
            </div>
            <div className="flex items-center space-x-2 mt-0.5">
              <h2 className="text-base font-semibold text-slate-100 tracking-tight truncate">
                {skill.name}
              </h2>
              {skill.version && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700/60">
                  v{skill.version}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 右侧：操作按钮组 (清晰、克制、大厂质感) */}
        <div className="flex items-center space-x-2">
          {/* 复制 Agent 指令 */}
          <button
            onClick={() => copyToClipboard(agentPrompt, 'agent')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-1.5 ${
              copiedAgent 
                ? 'bg-emerald-600 text-white shadow-sm' 
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-600/20'
            }`}
            title="复制指令直接发给任意 Agent"
          >
            {copiedAgent ? <Check size={13} /> : <Copy size={13} />}
            <span>{copiedAgent ? '已复制指令' : '复制 Agent 指令'}</span>
          </button>

          {/* 复制 CLI 安装命令 */}
          <button
            onClick={() => copyToClipboard(cliCmd, 'cli')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center space-x-1.5 ${
              copiedCli 
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40' 
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-800 hover:text-white'
            }`}
            title="复制终端一键安装命令"
          >
            {copiedCli ? <Check size={13} /> : <Terminal size={13} />}
            <span>{copiedCli ? '已复制命令' : '复制 CLI'}</span>
          </button>

          {/* 下载 tar.gz 完整包 */}
          <a
            href={`/s/${skill.slug}/archive.tar.gz`}
            download
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800 transition-all text-xs flex items-center"
            title="下载完整技能包 (含 scripts 脚本与 references 资料)"
          >
            <Download size={13} />
          </a>

          <div className="h-4 w-px bg-slate-800 mx-1"></div>

          {/* 文件夹移动下拉 */}
          <select
            value={skill.folder_path}
            onChange={(e) => onMoveFolder(skill.id, e.target.value)}
            className="bg-slate-900 border border-slate-800 text-slate-300 hover:text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="inbox">📥 收件箱 (inbox)</option>
            {folders.filter(f => f.path !== 'inbox').map(f => (
              <option key={f.path} value={f.path}>📁 {f.path}</option>
            ))}
          </select>

          {/* 编辑 / 预览 */}
          <div className="bg-slate-900 border border-slate-800 p-0.5 rounded-lg flex items-center">
            <button
              onClick={() => setMode('preview')}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-all flex items-center space-x-1 ${
                mode === 'preview' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Eye size={12} />
              <span>预览</span>
            </button>
            <button
              onClick={() => setMode('edit')}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-all flex items-center space-x-1 ${
                mode === 'edit' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Edit3 size={12} />
              <span>编辑</span>
            </button>
          </div>

          {mode === 'edit' && (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-all flex items-center space-x-1"
            >
              <Save size={13} />
              <span>{isSaving ? '保存中...' : '保存'}</span>
            </button>
          )}
        </div>
      </div>

      {/* 主体区域 */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {mode === 'preview' ? (
          <div className="max-w-4xl mx-auto space-y-6">
            {/* 多文件浏览条 (当 skill 有除 SKILL.md 外的 scripts / references 时展示) */}
            {fileTree && fileTree.length > 1 && (
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-2.5">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80 px-1">
                  <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider flex items-center space-x-1">
                    <span>📦 技能包关联文件与脚本</span>
                    <span className="text-slate-600 font-mono">({fileTree.length} 个文件)</span>
                  </span>
                  <a
                    href={`/s/${skill.slug}/archive.tar.gz`}
                    download
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors flex items-center space-x-1"
                  >
                    <span>打包下载全部</span>
                    <span>&darr;</span>
                  </a>
                </div>
                <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 text-xs font-mono">
                  {fileTree.map(f => (
                    <button
                      key={f.path}
                      onClick={() => setSelectedFile(f.path)}
                      className={`px-2.5 py-1 rounded-lg transition-all flex items-center space-x-1.5 shrink-0 ${
                        selectedFile === f.path 
                          ? 'bg-indigo-600/30 text-indigo-200 border border-indigo-500/50 font-semibold' 
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 border border-transparent'
                      }`}
                    >
                      <span>{f.path.endsWith('.sh') || f.path.endsWith('.py') ? '📜' : f.path.endsWith('.md') ? '📄' : '📁'}</span>
                      <span>{f.path}</span>
                      <span className="text-[10px] text-slate-600">({(f.size / 1024).toFixed(1)}k)</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 如果选中的不是 SKILL.md，而是 scripts/install.sh 或 references/ 等附属文件，直接展示该文件代码 */}
            {selectedFile !== 'SKILL.md' ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center space-x-2 text-xs font-mono text-slate-300">
                    <span>查看文件:</span>
                    <span className="text-indigo-300 font-semibold bg-slate-900 px-2 py-0.5 rounded border border-slate-800">{selectedFile}</span>
                  </div>
                  <button
                    onClick={() => setSelectedFile('SKILL.md')}
                    className="text-xs text-slate-400 hover:text-white transition-colors flex items-center space-x-1"
                  >
                    <span>&larr; 返回 SKILL.md 说明</span>
                  </button>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 overflow-x-auto font-mono text-xs text-slate-200 leading-relaxed">
                  {isLoadingFile ? (
                    <p className="text-slate-500 animate-pulse">正在加载文件内容...</p>
                  ) : (
                    <pre><code>{auxFileContent || '// 文件内容为空'}</code></pre>
                  )}
                </div>
              </div>
            ) : (
              <>
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
              </>
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
