import { useEffect, useRef, useState } from 'react';
import { Check, Copy, GitCompare, KeyRound, LogOut, Plus, Tag, Trash2, X } from 'lucide-react';
import FolderPicker from './FolderPicker';
import DiffView from './DiffView';
import { formatKeys } from '../hooks/useHotkeys';
import useDebouncedValue from '../hooks/useDebouncedValue';
import { onboardingPrompt } from '../utils/agentPrompts';
import { formatDateTime } from '../utils/date';
import { requestJson } from '../utils/requestJson';

const defaultContent = `---
name: my-new-skill
description: 一句话说明「什么时候应该使用这个技能」
tags: []
version: 1.0.0
---

# 新技能名称

## 何时使用
触发条件与适用范围。

## 步骤
1. 具体、可执行的命令或操作
2. …

## 验证
如何确认完成；常见失败的处理办法。
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


export function PasteSkillModal({ isOpen, onClose, onImport, folders, defaultFolder = 'inbox' }) {
  const [rawText, setRawText] = useState('');
  const [folderPath, setFolderPath] = useState(defaultFolder);
  const [parsedInfo, setParsedInfo] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const debouncedText = useDebouncedValue(rawText, 250);

  // 预览走服务端 /api/skills/parse：与创建、Agent 推送共用同一套 slug/名称/标签规则
  useEffect(() => {
    if (!debouncedText.trim()) return undefined;
    const controller = new AbortController();
    requestJson('/api/skills/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: debouncedText }),
      signal: controller.signal,
    }).then(setParsedInfo).catch(() => null);
    return () => controller.abort();
  }, [debouncedText]);

  if (!isOpen) return null;

  // 清空输入后不再展示上一次的解析结果
  const preview = rawText.trim() ? parsedInfo : null;
  const blocking = preview && (preview.errors.length > 0 || preview.conflict);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!rawText.trim()) {
      setError('请粘贴 SKILL.md 内容。');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      // 只提交正文与目录，slug/名称/标签由服务端按统一规则推导；冲突与无效标识由服务端返回明确错误
      const imported = await onImport({ folder_path: folderPath, content: rawText });
      if (imported) onClose();
      else setError('导入失败，请查看提示后重试。');
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  return (
    <DialogShell title="粘贴导入" description="粘贴完整 SKILL.md，名称、描述和标签会自动识别。" onClose={onClose} size="large">
      <form className="form-stack" onSubmit={handleSubmit}>
        {error && <div className="inline-error" role="alert">{error}</div>}
        {preview && preview.errors.length === 0 && (
          <div className="parse-preview"><div><strong>{preview.name}</strong><code>/{preview.slug}</code>{preview.tags.length > 0 && <code>{preview.tags.join(', ')}</code>}</div><span>{preview.conflict ? '' : '已识别'}</span></div>
        )}
        {preview?.errors.map((message) => <div key={message} className="inline-error" role="alert">{message}</div>)}
        {preview?.conflict && <div className="inline-error" role="alert">标识符「{preview.slug}」已存在{preview.conflict.in_trash ? '（在废纸篓中）' : ''}，请修改 frontmatter 的 name，或直接编辑已有技能。</div>}
        {preview?.warnings.map((message) => <p key={message} className="step-note">{message}</p>)}
        {preview?.security_warnings.map((w) => <p key={w.msg} className="step-note">⚠️ 安全提醒：{w.msg}</p>)}
        <label>SKILL.md<textarea rows={16} value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder={'---\nname: my-skill\ndescription: 技能说明\n---\n\n# 标题'} spellCheck="false" required /></label>
        <label className="compact-field">归档到<FolderPicker folders={folders} value={folderPath} onChange={setFolderPath} /></label>
        <footer className="dialog-footer"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={submitting || Boolean(blocking)}>{submitting ? '导入中…' : '导入技能'}</button></footer>
      </form>
    </DialogShell>
  );
}

export function AgentSetupModal({ isOpen, onClose, onOpenAccount }) {
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const origin = window.location.origin;
  const setupCommand = `curl -fsSL ${origin}/setup.sh | bash`;
  const loginCommand = 'ash login';
  const pushExamples = `# 推送整个技能目录（推荐，含 scripts/ references/ 等附属文件）\nash push ~/.agents/skills/my-skill/\n\n# 更新已有技能（同名 slug 已存在时必须加 --update）\nash push ~/.agents/skills/my-skill/ --update\n\n# 推送单个 SKILL.md\nash push ./SKILL.md`;
  const agentPrompt = onboardingPrompt(origin);
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
          <div><h3><span className="step-badge" aria-hidden="true">2</span>登录</h3><button type="button" onClick={() => copyText(loginCommand, 'login')}>{copied === 'login' ? <Check size={14} /> : <Copy size={14} />}{copied === 'login' ? '已复制' : '复制'}</button></div>
          <pre><code>{loginCommand}</code></pre>
          <p className="step-note">技能库只对登录的账号可见。输入用户名和密码即可；不方便交互输入的机器，在<button type="button" className="text-link" onClick={onOpenAccount}>账户</button>里创建 token，再运行 <code>ash login --token &lt;token&gt;</code>。</p>
        </section>
        <section>
          <div><h3><span className="step-badge" aria-hidden="true">3</span>Agent 引导指令</h3><button type="button" onClick={() => copyText(agentPrompt, 'prompt')}>{copied === 'prompt' ? <Check size={14} /> : <Copy size={14} />}{copied === 'prompt' ? '已复制' : '复制'}</button></div>
          <pre><code>{agentPrompt}</code></pre>
          <p className="step-note">发给任意 Agent，或写进它的全局指令（CLAUDE.md / AGENTS.md 等）。详细规范由服务端 <a href={`${origin}/agent.md`} target="_blank" rel="noreferrer">/agent.md</a> 下发，修改后各 Agent 自动生效。</p>
        </section>
        <section>
          <div><h3><span className="step-badge" aria-hidden="true">4</span>推送技能（含附属文件）</h3><button type="button" onClick={() => copyText(pushExamples, 'push')}>{copied === 'push' ? <Check size={14} /> : <Copy size={14} />}{copied === 'push' ? '已复制' : '复制'}</button></div>
          <pre><code>{pushExamples}</code></pre>
          <p className="step-note">目录推送会打包整个技能，pull 时原样恢复。Agent 推送的新技能和更新会进入「待审核」，在这里采纳后其他 Agent 才能拉取。</p>
        </section>
        <footer className="dialog-footer"><button type="button" className="primary-button" onClick={onClose}>完成</button></footer>
      </div>
    </DialogShell>
  );
}

// 账户：退出登录、个人 API token（给 ash / Agent 用）、修改密码。
// 只在打开时挂载面板：每次打开都是干净状态，刚创建的 token 明文不会在下次打开时残留
export function AccountModal({ isOpen, ...props }) {
  return isOpen ? <AccountPanel {...props} /> : null;
}

function AccountPanel({ onClose, user }) {
  const [tokens, setTokens] = useState([]);
  const [tokenName, setTokenName] = useState('');
  const [createdToken, setCreatedToken] = useState(null);
  const [copied, setCopied] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    requestJson('/api/auth/tokens', { signal: controller.signal })
      .then((rows) => setTokens(Array.isArray(rows) ? rows : []))
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, []);

  const run = async (kind, action) => {
    setBusy(kind);
    setError('');
    setNotice('');
    try { await action(); } catch (e) { setError(e.message); } finally { setBusy(''); }
  };

  const createToken = (event) => {
    event.preventDefault();
    run('create', async () => {
      const created = await requestJson('/api/auth/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tokenName.trim() }),
      });
      setCreatedToken(created);
      setCopied(false);
      setTokenName('');
      setTokens(await requestJson('/api/auth/tokens'));
    });
  };

  const revokeToken = (token) => {
    if (!window.confirm(`吊销「${token.name}」？用它登录的 ash 会立即失效。`)) return;
    run(`revoke-${token.id}`, async () => {
      await requestJson(`/api/auth/tokens/${token.id}`, { method: 'DELETE' });
      setTokens((rows) => rows.filter((row) => row.id !== token.id));
      if (createdToken?.id === token.id) setCreatedToken(null);
    });
  };

  const copyLogin = async () => {
    try {
      await navigator.clipboard.writeText(`ash login --token ${createdToken.token}`);
      setCopied(true);
    } catch {
      setError('复制失败，请手动选中复制。');
    }
  };

  const changePassword = (event) => {
    event.preventDefault();
    if (passwords.next !== passwords.confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    run('password', async () => {
      await requestJson('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: passwords.current, new_password: passwords.next }),
      });
      setPasswords({ current: '', next: '', confirm: '' });
      setNotice('密码已修改，其他设备上的网页登录已退出。');
    });
  };

  const logout = () => run('logout', async () => {
    await requestJson('/api/auth/logout', { method: 'POST' });
    window.location.assign('/');
  });

  return (
    <DialogShell title="账户" description={user ? `已登录为 ${user.username}${user.role === 'admin' ? '（管理员）' : ''}` : '当前账号'} onClose={onClose} size="medium">
      <div className="account-content">
        {error && <div className="inline-error" role="alert">{error}</div>}
        {notice && <p className="account-notice" role="status">{notice}</p>}

        <section aria-labelledby="account-tokens-heading">
          <h3 id="account-tokens-heading"><KeyRound size={14} aria-hidden="true" />API token</h3>
          <p className="step-note">给 <code>ash</code> 和 Agent 用，权限等同于你的账号。一台机器一个，不用了就吊销。</p>
          {createdToken && (
            <div className="token-reveal" role="status">
              <p>「{createdToken.name}」已创建。token 只显示这一次，请现在复制：</p>
              <div className="token-reveal-row">
                <code>ash login --token {createdToken.token}</code>
                <button type="button" className="secondary-button" onClick={copyLogin}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制'}</button>
              </div>
            </div>
          )}
          <form className="input-action" onSubmit={createToken}>
            <input value={tokenName} onChange={(event) => setTokenName(event.target.value)} placeholder="名称，例如 MacBook / CI" aria-label="新 token 名称" maxLength={64} required />
            <button type="submit" disabled={busy === 'create' || !tokenName.trim()}><Plus size={13} aria-hidden="true" />新建</button>
          </form>
          {tokens.length > 0 ? (
            <ul className="token-list">
              {tokens.map((token) => (
                <li key={token.id}>
                  <div>
                    <strong>{token.name}</strong>
                    <span><code>{token.prefix}…</code> · 创建于 {formatDateTime(token.created_at)} · {token.last_used_at ? `最近使用 ${formatDateTime(token.last_used_at)}` : '从未使用'}</span>
                  </div>
                  <button type="button" className="icon-button danger-button" onClick={() => revokeToken(token)} disabled={busy === `revoke-${token.id}`} aria-label={`吊销 ${token.name}`} title="吊销"><Trash2 size={14} /></button>
                </li>
              ))}
            </ul>
          ) : <p className="step-note">还没有 token。在终端运行 <code>ash login</code> 输入用户名密码，也会自动创建一个。</p>}
        </section>

        <section aria-labelledby="account-password-heading">
          <h3 id="account-password-heading">修改密码</h3>
          <form className="form-stack" onSubmit={changePassword}>
            <label>当前密码<input type="password" autoComplete="current-password" value={passwords.current} onChange={(event) => setPasswords({ ...passwords, current: event.target.value })} required /></label>
            <div className="form-grid">
              <label>新密码<input type="password" autoComplete="new-password" minLength={8} value={passwords.next} onChange={(event) => setPasswords({ ...passwords, next: event.target.value })} required /></label>
              <label>再输一次<input type="password" autoComplete="new-password" minLength={8} value={passwords.confirm} onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })} required /></label>
            </div>
            <div><button type="submit" className="secondary-button" disabled={busy === 'password'}>{busy === 'password' ? '保存中…' : '修改密码'}</button></div>
          </form>
        </section>

        <footer className="dialog-footer">
          <button type="button" className="secondary-button" onClick={logout} disabled={busy === 'logout'}><LogOut size={14} aria-hidden="true" />退出登录</button>
          <button type="button" className="primary-button" onClick={onClose}>完成</button>
        </footer>
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
  const [compare, setCompare] = useState(null); // { version, current }

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

  const openCompare = async (versionId) => {
    setError('');
    try {
      const [version, current] = await Promise.all([
        requestJson(`/api/skills/${skillId}/versions/${versionId}`),
        requestJson(`/api/skills/${skillId}`),
      ]);
      setCompare({ version, current });
    } catch (e) { setError(e.message); }
  };

  // 快照记录的是「被替换掉的旧内容」，source 表示是谁的改动导致了这次快照
  const sourceLabel = { web: '网页编辑前', agent: 'Agent 更新前', 'restore-backup': '恢复前备份' };

  if (compare) {
    const time = formatDateTime(compare.version.created_at);
    return (
      <DialogShell title="版本对比" description={`${sourceLabel[compare.version.source] || compare.version.source} · ${time} → 当前版本`} onClose={() => setCompare(null)} size="large">
        <DiffView
          before={compare.version.content}
          after={compare.current.content}
          beforeLabel={`历史版本${compare.version.label ? `（${compare.version.label}）` : ''}`}
          afterLabel="当前版本"
          beforeFiles={compare.version.files || []}
          afterFiles={compare.current.files || []}
        />
        <footer className="dialog-footer">
          <button type="button" className="secondary-button" onClick={() => setCompare(null)}>返回列表</button>
          <button type="button" className="primary-button" disabled={restoring === compare.version.id} onClick={async () => { await restore(compare.version.id); setCompare(null); }}>恢复此版本</button>
        </footer>
      </DialogShell>
    );
  }

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
              <time>{formatDateTime(v.created_at)}</time>
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
              <button type="button" className="secondary-button" onClick={() => openCompare(v.id)} title="与当前版本对比">
                <GitCompare size={13} />对比
              </button>
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
