import { useEffect, useState } from 'react';
import { Check, ChevronRight, Copy, Download, Edit3, Eye, History, MoreHorizontal, Terminal } from 'lucide-react';
import { showToast } from '../toastBus';
import { installCommand, skillPrompt } from '../../utils/agentPrompts';
import { formatDateTime, relativeTime } from '../../utils/date';

// 详情头部：面包屑 + 身份信息 + 复制/下载/历史/更多 + 预览/编辑切换。
// 复制反馈（copied）、版本弹窗和保存逻辑仍归 SkillDetail，这里只负责展示与触发。
export default function DetailToolbar({
  skill,
  fileCount,
  selectedFile,
  auxFileContent,
  copied,
  onCopy,
  onShowVersions,
  mode,
  dirty,
  saving,
  onSwitchMode,
  onSelectFolder,
  onCopySkill,
}) {
  const [moreOpen, setMoreOpen] = useState(false);

  // 溢出菜单：点外部或按 Esc 关闭
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onPointerDown = (event) => { if (!event.target.closest('.detail-more')) setMoreOpen(false); };
    const onKeyDown = (event) => { if (event.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moreOpen]);

  const origin = window.location.origin;
  const agentPrompt = skillPrompt(origin, { ...skill, file_count: fileCount || skill.file_count });
  const cliCommand = installCommand(origin, skill.slug);

  // 附属文件单独下载：/api/skills/:id/file 返回 JSON 包装，直接做成本地 Blob 更省事
  const downloadCurrentFile = () => {
    const url = URL.createObjectURL(new Blob([auxFileContent], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = selectedFile.split('/').pop();
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <header className="detail-toolbar">
      <div className="detail-identity">
        <nav className="breadcrumb" aria-label="技能路径">
          {skill.folder_path.split('/').map((segment, i, arr) => (
            <span key={`${segment}-${i}`} className="crumb-segment">
              {/* 面包屑是导航：跳到该层目录，而不是把技能移动到它自己的目录 */}
                  <button type="button" className="crumb-link" onClick={() => onSelectFolder?.(arr.slice(0, i + 1).join('/'))} title={`在目录中查看：${arr.slice(0, i + 1).join('/')}`}>{segment}</button>
              {i < arr.length - 1 && <ChevronRight size={11} className="crumb-sep" aria-hidden="true" />}
            </span>
          ))}
          <ChevronRight size={11} className="crumb-sep" aria-hidden="true" />
          <span className="crumb-current">{skill.slug}</span>
        </nav>
        <h2 title={skill.name}>{skill.name}</h2>
      </div>

      {/* 头部中段原来是一大片空白：放只读身份信息（版本 / 更新时间 / 文件数 / 来源终端） */}
      <div className="detail-meta" aria-label="技能信息">
        {skill.version && <span className="chip" title={`版本 ${skill.version}`}>v{skill.version}</span>}
        {skill.updated_at && <span title={`更新于 ${formatDateTime(skill.updated_at)}`}>{relativeTime(skill.updated_at)}</span>}
        {fileCount > 1 && <span>{fileCount} 个文件</span>}
        {skill.terminal_source && <span className="chip row-source" title={`来自终端 ${skill.terminal_source}`}>{skill.terminal_source}</span>}
      </div>

      <div className="detail-actions">
        <button type="button" className="secondary-button" onClick={() => onCopy(agentPrompt, 'agent')}>
          {copied === 'agent' ? <Check size={14} /> : <Copy size={14} />}
          {copied === 'agent' ? '已复制' : '复制 Agent 指令'}
        </button>
        <button type="button" className="secondary-button compact-action" onClick={() => onCopy(cliCommand, 'cli')}>
          {copied === 'cli' ? <Check size={14} /> : <Terminal size={14} />}
          <span>{copied === 'cli' ? '已复制' : '复制 CLI'}</span>
        </button>
        <a className="icon-button bordered-button" href={`/s/${skill.slug}/archive.tar.gz`} download aria-label={`下载 ${skill.name} 完整技能包`}>
          <Download size={15} />
        </a>
        <button type="button" className="icon-button bordered-button" onClick={onShowVersions} aria-label="历史版本" title="历史版本">
          <History size={15} />
        </button>
        {/* 溢出菜单：一键取值（slug / 路径 / 链接）与「复制技能」——后者后端早有 API，前端一直没入口 */}
        <div className="folder-menu-wrap detail-more">
          <button
            type="button"
            className="icon-button bordered-button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-label="更多操作"
            aria-expanded={moreOpen}
            title="更多操作"
          >
            <MoreHorizontal size={15} />
          </button>
          {moreOpen && (
            <div className="folder-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onCopySkill?.(skill.id); }}>复制为新技能</button>
              <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onCopy(skill.slug, 'slug', 'slug'); }}>复制 slug</button>
              <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onCopy(`${skill.folder_path}/${skill.slug}`, 'path', '仓库路径'); }}>复制仓库路径</button>
              <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onCopy(`[${skill.name}](${origin}/s/${skill.slug})`, 'link', 'Markdown 链接'); }}>复制 Markdown 链接</button>
              {selectedFile !== 'SKILL.md' && (
                <>
                  <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onCopy(auxFileContent, 'file'); showToast(`已复制 ${selectedFile} 的内容`); }}>复制当前文件内容</button>
                  <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); downloadCurrentFile(); }}>下载当前文件</button>
                </>
              )}
            </div>
          )}
        </div>
        <div className="mode-switch" aria-label="详情模式">
          <button type="button" className={mode === 'preview' ? 'is-active' : ''} onClick={() => onSwitchMode('preview')} aria-pressed={mode === 'preview'}><Eye size={14} />预览</button>
          <button type="button" className={`${mode === 'edit' ? 'is-active' : ''}${dirty ? ' is-dirty' : ''}`} onClick={() => onSwitchMode('edit')} aria-pressed={mode === 'edit'} disabled={saving} title={dirty ? '有未保存的修改（⌘S 保存）' : '编辑（E）'}><Edit3 size={14} />{saving ? '保存中…' : '编辑'}{dirty && <i className="dirty-dot" aria-label="有未保存的修改" />}</button>
        </div>
      </div>
    </header>
  );
}
