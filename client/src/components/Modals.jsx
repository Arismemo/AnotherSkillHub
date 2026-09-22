import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Plus, X } from 'lucide-react';

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

function DialogShell({ title, description, onClose, children, size = 'medium' }) {
  const panelRef = useRef(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const firstFocusable = panelRef.current?.querySelector('input, textarea, select, button, a[href]');
    firstFocusable?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
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
        {children}
      </section>
    </div>
  );
}

function FolderOptions({ folders }) {
  return (
    <>
      <option value="inbox">收件箱</option>
      {folders.filter((folder) => folder.path !== 'inbox').map((folder) => (
        <option key={folder.path} value={folder.path}>{folder.path}</option>
      ))}
    </>
  );
}

export function NewSkillModal({ isOpen, onClose, onCreate, folders }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [folderPath, setFolderPath] = useState('inbox');
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
    const created = await onCreate({
      name: name.trim() || slug.trim(),
      slug: slug.trim(),
      description: '',
      folder_path: folderPath,
      tags,
      content,
    });
    setSubmitting(false);
    if (created) onClose();
    else setError('创建失败，请检查输入后重试。');
  };

  return (
    <DialogShell title="新建技能" description="创建后可继续编辑正文和关联文件。" onClose={onClose} size="large">
      <form className="dialog-body form-stack" onSubmit={handleSubmit}>
        {error && <div className="inline-error" role="alert">{error}</div>}
        <div className="form-grid">
          <label>技能名称<input value={name} onChange={(event) => handleNameChange(event.target.value)} placeholder="例如：Worldsim 仿真调试" required /></label>
          <label>英文标识符<input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="worldsim-debug" required pattern="[a-z0-9_-]+" /></label>
        </div>
        <div className="form-grid">
          <label>文件夹<select value={folderPath} onChange={(event) => setFolderPath(event.target.value)}><FolderOptions folders={folders} /></select></label>
          <label>标签<div className="input-action"><input value={tagInput} onChange={(event) => setTagInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } }} placeholder="输入后按 Enter" /><button type="button" onClick={addTag}>添加</button></div></label>
        </div>
        {tags.length > 0 && <div className="editable-tags" aria-label="已添加标签">{tags.map((tag) => <button type="button" key={tag} onClick={() => setTags(tags.filter((item) => item !== tag))} aria-label={`移除标签 ${tag}`}>{tag}<span aria-hidden="true">×</span></button>)}</div>}
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

export function PasteSkillModal({ isOpen, onClose, onImport, folders }) {
  const [rawText, setRawText] = useState('');
  const [folderPath, setFolderPath] = useState('inbox');
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
    const info = parsedInfo || parseSkillMarkdown(rawText);
    const imported = await onImport({ ...info, folder_path: folderPath, content: rawText });
    setSubmitting(false);
    if (imported) onClose();
    else setError('导入失败，请检查内容后重试。');
  };

  return (
    <DialogShell title="粘贴导入" description="粘贴完整 SKILL.md，名称、描述和标签会自动识别。" onClose={onClose} size="large">
      <form className="dialog-body form-stack" onSubmit={handleSubmit}>
        {error && <div className="inline-error" role="alert">{error}</div>}
        {parsedInfo && <div className="parse-preview"><div><strong>{parsedInfo.name}</strong><code>/{parsedInfo.slug}</code></div><span>已识别</span></div>}
        <label>SKILL.md<textarea rows={16} value={rawText} onChange={(event) => updateText(event.target.value)} placeholder={'---\nname: my-skill\ndescription: 技能说明\n---\n\n# 标题'} spellCheck="false" required /></label>
        <label className="compact-field">归档到<select value={folderPath} onChange={(event) => setFolderPath(event.target.value)}><FolderOptions folders={folders} /></select></label>
        <footer className="dialog-footer"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? '导入中…' : '导入技能'}</button></footer>
      </form>
    </DialogShell>
  );
}

export function AgentSetupModal({ isOpen, onClose }) {
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const setupCommand = `curl -fsSL ${window.location.origin}/setup.sh | bash`;
  const agentPrompt = `已接入 AnotherSkillHub（${window.location.origin}）。\n需要技能时运行 ash pull <slug>；搜索技能运行 ash search <keyword>。`;
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
      <div className="dialog-body setup-content">
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
        <footer className="dialog-footer"><button type="button" className="primary-button" onClick={onClose}>完成</button></footer>
      </div>
    </DialogShell>
  );
}
