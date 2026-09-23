import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Plus, Tag, X } from 'lucide-react';
import FolderPicker from './FolderPicker';
import { formatKeys } from '../hooks/useHotkeys';
import { requestJson } from '../utils/requestJson';

const defaultContent = `---
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
`;

async function ensureSkillSlugAvailable(slug) {
  try {
    const existing = await requestJson(`/api/skills/${encodeURIComponent(slug)}`);
    if (existing.slug === slug) throw new Error(`标识符「${slug}」已存在，请更换标识符或编辑已有技能。`);
  } catch (error) {
    if (error.status !== 404) throw error;
  }
}

export function DialogShell({ title, description, onClose, children, size = 'medium' }) {
  const panelRef = useRef(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const firstFocusable = panelRef.current?.querySelector('input, textarea, select, button, a[href]');
    firstFocusable?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
      // ⌘/Ctrl+Enter 提交：粘贴导入的动线是「⌘V → 提交」，不该为最后一步回到鼠标
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        const form = panelRef.current?.querySelector('form');
        if (form) {
          event.preventDefault();
          form.requestSubmit();
        }
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll('input, textarea, select, button, a[href]')]
        .filter((element) => !element.disabled && element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={panelRef} className={`dialog-panel dialog-${size}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby={description ? 'dialog-description' : undefined}>
        <header className="dialog-header">
          <div>
            <h2 id="dialog-title">{title}</h2>
            {description && <p id="dialog-description">{description}</p>}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={`关闭${title}`}><X size={17} /></button>
        </header>
        <div className="dialog-body">{children}</div>
      </section>
    </div>
  );
}

// ? 速查面板：直接由 App 的快捷键注册表生成，说明与实现不会脱节
export function ShortcutsModal({ isOpen, onClose, shortcuts }) {
  if (!isOpen) return null;
  const groups = [];
  shortcuts.forEach((item) => {
    if (!item.label) return;
    let group = groups.find((g) => g.name === item.group);
    if (!group) {
      group = { name: item.group || '其他', items: [] };
      groups.push(group);
    }
    group.items.push(item);
  });
  return (
    <DialogShell title="键盘快捷键" description="单键快捷键在输入框内不触发；⌘S / Esc 例外。" onClose={onClose} size="medium">
      <div className="shortcut-groups">
        {groups.map((group) => (
          <section key={group.name}>
            <h3>{group.name}</h3>
            <dl>
              {group.items.map((item) => (
                <div key={item.id}>
                  <dt>{item.label}</dt>
                  <dd>
                    {(Array.isArray(item.keys) ? item.keys : [item.keys]).map((spec, index) => (
                      <span key={spec}>
                        {index > 0 && <i className="shortcut-or">或</i>}
                        <kbd>{formatKeys(spec)}</kbd>
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </DialogShell>
  );
}

export function NewSkillModal({ isOpen, onClose, onCreate, folders, defaultFolder = 'inbox' }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  // 在 tools/playwright 里点「新建」却默认落 inbox，之后还得再移动一次
  const [folderPath, setFolderPath] = useState(defaultFolder);
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState([]);
  const [content, setContent] = useState(defaultContent);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleNameChange = (value) => {
    setName(value);
    if (!slug || slug === name.toLowerCase().replace(/[^a-z0-9_-]/g, '-')) {
      setSlug(value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'));
    }
  };

  const addTag = () => {
    const nextTag = tagInput.trim();
    if (nextTag && !tags.includes(nextTag)) setTags([...tags, nextTag]);
    setTagInput('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!slug.trim()) {
      setError('请输入英文标识符。');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await ensureSkillSlugAvailable(slug.trim());
      const created = await onCreate({
        name: name.trim() || slug.trim(),
        slug: slug.trim(),
        description: '',
        folder_path: folderPath,
        tags,
        content,
      });
      if (created) onClose();
      else setError('创建失败，请查看提示后重试。');
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  return (
    <DialogShell title="新建技能" description="创建后可继续编辑正文和关联文件。" onClose={onClose} size="large">
      <form className="form-stack" onSubmit={handleSubmit}>
        {error && <div className="inline-error" role="alert">{error}</div>}
        <div className="form-grid">
          <label>技能名称<input value={name} onChange={(event) => handleNameChange(event.target.value)} placeholder="例如：Worldsim 仿真调试" required /></label>
          <label>英文标识符<input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="worldsim-debug" required pattern="[a-z0-9_-]+" /></label>
        </div>
        <div className="form-grid">
          <label>文件夹<FolderPicker folders={folders} value={folderPath} onChange={setFolderPath} /></label>
          <label>标签<div className="input-action"><input value={tagInput} onChange={(event) => setTagInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } }} placeholder="输入后按 Enter" /><button type="button" onClick={addTag}>添加</button></div></label>
        </div>
        {tags.length > 0 && <div className="editable-tags" aria-label="已添加标签">{tags.map((tag) => <button type="button" key={tag} onClick={() => setTags(tags.filter((item) => item !== tag))} aria-label={`移除标签 ${tag}`}>{tag}<X size={11} aria-hidden="true" /></button>)}</div>}
        <label>SKILL.md<textarea rows={10} value={content} onChange={(event) => setContent(event.target.value)} spellCheck="false" required /></label>
        <footer className="dialog-footer"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={submitting}><Plus size={14} />{submitting ? '创建中…' : '创建技能'}</button></footer>
      </form>
    </DialogShell>
  );
}


function parseSkillMarkdown(text) {
  let name = '';
  let description = '';
  let tags = [];
  const trimmed = text.trim();
  if (trimmed.startsWith('---')) {
    const end = trimmed.indexOf('---', 3);
    if (end !== -1) {
      const frontmatter = trimmed.slice(3, end);
      name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '') || '';
      description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '') || '';
      const rawTags = frontmatter.match(/^tags:\s*\[(.*)\]/m)?.[1];
      if (rawTags) tags = rawTags.split(',').map((tag) => tag.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
  }
  if (!name) name = text.match(/^#\s+(.+)$/m)?.[1]?.trim() || '';
  const slug = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || `skill-${Date.now().toString().slice(-4)}`;
  return { name: name || slug, slug, description, tags };
}

export function PasteSkillModal({ isOpen, onClose, onImport, folders, defaultFolder = 'inbox' }) {
  const [rawText, setRawText] = useState('');
  const [folderPath, setFolderPath] = useState(defaultFolder);
  const [parsedInfo, setParsedInfo] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const updateText = (text) => {
    setRawText(text);
    setParsedInfo(text.trim() ? parseSkillMarkdown(text) : null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!rawText.trim()) {
      setError('请粘贴 SKILL.md 内容。');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const info = parsedInfo || parseSkillMarkdown(rawText);
      await ensureSkillSlugAvailable(info.slug);
      const imported = await onImport({ ...info, folder_path: folderPath, content: rawText });
      if (imported) onClose();
      else setError('导入失败，请查看提示后重试。');
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  return (
    <DialogShell title="粘贴导入" description="粘贴完整 SKILL.md，名称、描述和标签会自动识别。" onClose={onClose} size="large">
      <form className="form-stack" onSubmit={handleSubmit}>
        {error && <div className="inline-error" role="alert">{error}</div>}
        {parsedInfo && <div className="parse-preview"><div><strong>{parsedInfo.name}</strong><code>/{parsedInfo.slug}</code></div><span>已识别</span></div>}
        <label>SKILL.md<textarea rows={16} value={rawText} onChange={(event) => updateText(event.target.value)} placeholder={'---\nname: my-skill\ndescription: 技能说明\n---\n\n# 标题'} spellCheck="false" required /></label>
        <label className="compact-field">归档到<FolderPicker folders={folders} value={folderPath} onChange={setFolderPath} /></label>
        <footer className="dialog-footer"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? '导入中…' : '导入技能'}</button></footer>
      </form>
    </DialogShell>
  );
}

export function AgentSetupModal({ isOpen, onClose }) {
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const origin = window.location.origin;
  const setupCommand = `curl -fsSL ${origin}/setup.sh | bash`;
  const pushExamples = `# 推送整个技能目录（推荐，含附属文件）\nash push ~/.hermes/profiles/<profile>/skills/my-skill/\n\n# 推送单个 SKILL.md\nash push ./SKILL.md`;
  const agentPrompt = `已接入 AnotherSkillHub（${origin}）。\n- 搜索技能：ash search <keyword>\n- 拉取使用：ash pull <slug>\n- 推送本地技能（整个技能目录，含 references/scripts 附属文件）：ash push <技能目录>\n- 推送单个文件：ash push SKILL.md`;
  const copyText = async (text, type) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      window.setTimeout(() => setCopied(''), 1800);
    } catch {
      setError('复制失败，请检查浏览器的剪贴板权限。');
    }
  };

  return (
    <DialogShell title="终端接入" description="两步完成接入：先安装命令，再把引导指令发给 Agent。" onClose={onClose} size="medium">
      <div className="setup-content">
        {error && <div className="inline-error" role="alert">{error}</div>}
        <section>
          <div><h3><span className="step-badge" aria-hidden="true">1</span>安装命令</h3><button type="button" onClick={() => copyText(setupCommand, 'command')}>{copied === 'command' ? <Check size={14} /> : <Copy size={14} />}{copied === 'command' ? '已复制' : '复制'}</button></div>
          <pre><code>{setupCommand}</code></pre>
          <p className="step-note">在终端执行，安装 <code>ash</code> 命令行工具。</p>
        </section>
        <section>
          <div><h3><span className="step-badge" aria-hidden="true">2</span>Agent 引导指令</h3><button type="button" onClick={() => copyText(agentPrompt, 'prompt')}>{copied === 'prompt' ? <Check size={14} /> : <Copy size={14} />}{copied === 'prompt' ? '已复制' : '复制'}</button></div>
          <pre><code>{agentPrompt}</code></pre>
          <p className="step-note">发给任意 Agent 对话窗，让 Agent 知道如何使用 ash。两步都需要完成。</p>
        </section>
        <section>
          <div><h3><span className="step-badge" aria-hidden="true">3</span>推送技能（含附属文件）</h3><button type="button" onClick={() => copyText(pushExamples, 'push')}>{copied === 'push' ? <Check size={14} /> : <Copy size={14} />}{copied === 'push' ? '已复制' : '复制'}</button></div>
          <pre><code>{pushExamples}</code></pre>
          <p className="step-note">目录推送会自动打包整个技能（SKILL.md + references/ + scripts/ 等），云端保留完整结构，pull 时原样恢复。</p>
        </section>
        <footer className="dialog-footer"><button type="button" className="primary-button" onClick={onClose}>完成</button></footer>
      </div>
    </DialogShell>
  );
}

// 历史版本：列出全部快照，可恢复任意版本为最新
export function VersionHistoryModal({ isOpen, onClose, skillId, onRestored }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(null);
  const [labelSaving, setLabelSaving] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !skillId) return;
    setLoading(true);
    setError('');
    requestJson(`/api/skills/${skillId}/versions`)
      .then((data) => setVersions(Array.isArray(data) ? data : []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [isOpen, skillId]);

  if (!isOpen) return null;

  const restore = async (versionId) => {
    setRestoring(versionId);
    setError('');
    try {
      await requestJson(`/api/skills/${skillId}/versions/${versionId}/restore`, { method: 'POST' });
      onRestored?.();
      const data = await requestJson(`/api/skills/${skillId}/versions`);
      setVersions(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setRestoring(null);
    }
  };

  const sourceLabel = { web: '网页', agent: 'Agent', 'restore-backup': '恢复前备份' };

  return (
    <DialogShell title="历史版本" description="每次内容变更前自动保存快照，可恢复任意版本。" onClose={onClose} size="medium">
      <div className="version-list">
        {loading && <p className="version-empty">加载中…</p>}
        {error && <p className="version-error">{error}</p>}
        {!loading && !error && versions.length === 0 && (
          <p className="version-empty">暂无历史版本——首次编辑保存后开始记录。</p>
        )}
        {versions.map((v) => (
          <div key={v.id} className="version-row">
            <div className="version-meta">
              <span className="version-source">{sourceLabel[v.source] || v.source}</span>
              <time>{new Date(v.created_at + 'Z').toLocaleString('zh-CN', { hour12: false })}</time>
              <span className="version-size">{Math.round((v.content_size || 0) / 1024)} KB</span>
              {v.label && <span className="version-label-tag"><Tag size={11} aria-hidden="true" />{v.label}</span>}
            </div>
            <div className="version-row-actions">
              <input
                className="version-label-input"
                defaultValue={v.label || ''}
                placeholder="版本标签…"
                aria-label={`版本 ${v.id} 标签`}
                disabled={labelSaving === v.id}
                onKeyDown={async (e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const label = e.currentTarget.value.trim();
                  setLabelSaving(v.id);
                  setError('');
                  try {
                    await requestJson(`/api/skills/${skillId}/versions/${v.id}/label`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ label }),
                    });
                    setVersions((previous) => previous.map((version) => version.id === v.id ? { ...version, label } : version));
                  } catch (error) { setError(error.message); }
                  finally { setLabelSaving(null); }
                }}
              />
              <button
                type="button"
                className="secondary-button"
                disabled={restoring === v.id}
                onClick={() => restore(v.id)}
              >
                {restoring === v.id ? '恢复中…' : '恢复此版本'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </DialogShell>
  );
}
