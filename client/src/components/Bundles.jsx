import { useEffect, useState } from 'react';
import { Check, Copy, Package, Plus, Trash2, X } from 'lucide-react';
import { DialogShell } from './Modals';
import { fuzzyScore } from './CommandPalette';
import { requestJson } from '../utils/requestJson';

// 技能组合详情：展示组合内技能（快捷方式），支持移除/添加/复制组合指令
// 删除组合或移除项都不影响技能本身
export function BundleDetail({ bundle, onClose, onChanged, showToast }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [allSkills, setAllSkills] = useState([]);
  const [copied, setCopied] = useState(false);
  const [nameDraft, setNameDraft] = useState(bundle?.name || '');
  const [addFilter, setAddFilter] = useState('');
  const [pending, setPending] = useState(() => new Set());
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const data = await requestJson(`/api/bundles/${bundle.id}`);
      setDetail(data);
      setNameDraft(data.name || '');
      setError('');
    } catch (e) { setError(e.message); }
  };

  useEffect(() => { if (bundle) load(); }, [bundle?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!bundle) return null;

  const removeSkill = async (skillId) => {
    setSaving(true);
    setError('');
    try {
      await requestJson(`/api/bundles/${bundle.id}/skills/${skillId}`, { method: 'DELETE' });
      showToast?.('已从组合移除（技能本身不受影响）');
      await load();
      onChanged?.();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const deleteBundle = async () => {
    setSaving(true);
    setError('');
    try {
      await requestJson(`/api/bundles/${bundle.id}`, { method: 'DELETE' });
      showToast?.('已删除组合（技能本身不受影响）');
      onChanged?.();
      onClose();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const openAdd = async () => {
    setAdding(true);
    try {
      const all = await requestJson('/api/skills?folder=all');
      setAllSkills(Array.isArray(all) ? all : []);
    } catch (e) { setError(e.message); setAllSkills([]); }
  };

  const togglePending = (skillId) => setPending((prev) => {
    const next = new Set(prev);
    if (next.has(skillId)) next.delete(skillId);
    else next.add(skillId);
    return next;
  });

  const addPending = async () => {
    setSaving(true);
    setError('');
    try {
      const ids = [...pending];
      const results = await Promise.allSettled(ids.map((skillId) => requestJson(`/api/bundles/${bundle.id}/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill_id: skillId }),
      })));
      const failed = ids.filter((_, index) => results[index].status === 'rejected');
      const succeeded = ids.length - failed.length;
      if (succeeded) {
        showToast?.(`已添加 ${succeeded} 个技能到组合`);
        await load();
        onChanged?.();
      }
      setPending(new Set(failed));
      if (!failed.length) setAddFilter('');
      else setError(`${failed.length} 个技能添加失败，请重试。${results.find((r) => r.status === 'rejected')?.reason?.message || ''}`);
    } finally {
      setSaving(false);
    }
  };

  const agentCommand = `curl -fsSL ${window.location.origin}/s/bundle/${detail?.slug || bundle.slug}/install.sh | bash`;
  const copyCommand = async () => {
    await navigator.clipboard.writeText(agentCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const inBundle = new Set((detail?.items || []).map((i) => i.id));
  const query = addFilter.trim();
  const candidates = allSkills
    .filter((s) => !inBundle.has(s.id))
    .map((s) => ({ skill: s, score: query ? Math.max(fuzzyScore(query, s.name), fuzzyScore(query, `${s.slug} ${s.description || ''}`) * 0.8) : 1 }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.skill);

  return (
    <DialogShell
      title={`技能组合：${detail?.name || bundle.name}`}
      description="组合是技能的快捷方式集合——删除组合或移除条目都不会影响技能本身。复制指令发给 Agent，即可一次安装组合内全部技能。"
      onClose={onClose}
      size="medium"
    >
      <div className="bundle-detail">
        {error && <div className="inline-error" role="alert">{error}</div>}
        {/* 后端早有 PUT /api/bundles/:id，前端没有入口：名字打错只能删了重建 */}
        <form
          className="bundle-rename"
          onSubmit={async (event) => {
            event.preventDefault();
            const next = nameDraft.trim();
            if (!next || next === (detail?.name || bundle.name)) return;
            setSaving(true);
            setError('');
            try {
              const updated = await requestJson(`/api/bundles/${bundle.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: next }),
              });
              setDetail(updated);
              showToast?.('已重命名组合');
              onChanged?.();
            } catch (e) { setError(e.message); }
            finally { setSaving(false); }
          }}
        >
          <input
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            aria-label="组合名称"
            placeholder="组合名称"
          />
          <button type="submit" className="secondary-button" disabled={saving || !nameDraft.trim() || nameDraft.trim() === (detail?.name || bundle.name)}>重命名</button>
        </form>
        <div className="bundle-command">
          <code>{agentCommand}</code>
          <button type="button" className="primary-button" onClick={copyCommand}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? '已复制' : '复制组合指令'}
          </button>
        </div>
        <ul className="bundle-items">
          {(detail?.items || []).map((it) => (
            <li key={it.id}>
              <Package size={14} aria-hidden="true" />
              <span className="bundle-item-name">{it.name}</span>
              <span className="bundle-item-slug">{it.slug}</span>
              <button type="button" className="icon-button" disabled={saving} onClick={() => removeSkill(it.id)} aria-label={`从组合移除 ${it.name}`} title="从组合移除（不删除技能）">
                <X size={14} />
              </button>
            </li>
          ))}
          {!detail?.items?.length && <li className="bundle-empty">组合为空——点击下方「添加技能」加入快捷方式</li>}
        </ul>
        <div className="bundle-actions">
          {!adding ? (
            <button type="button" className="secondary-button" onClick={openAdd}><Plus size={14} />添加技能</button>
          ) : (
            // 原来是一面无过滤、无多选的全量技能墙：组 8 个技能 = 8 次「滚动定位 + 点击」
            <div className="bundle-add-panel">
              <input
                className="bundle-add-search"
                type="search"
                value={addFilter}
                onChange={(event) => setAddFilter(event.target.value)}
                placeholder="搜索要添加的技能…"
                aria-label="搜索要添加的技能"
              />
              <div className="bundle-add-list">
                {candidates.map((s) => {
                  const picked = pending.has(s.id);
                  return (
                    <button type="button" key={s.id} className={picked ? 'is-picked' : ''} aria-pressed={picked} onClick={() => togglePending(s.id)}>
                      {picked ? <Check size={13} /> : <Plus size={13} />}{s.name}<span className="bundle-item-slug">{s.slug}</span>
                    </button>
                  );
                })}
                {candidates.length === 0 && (
                  <span className="bundle-empty">{addFilter.trim() ? `没有匹配「${addFilter.trim()}」的技能` : '全部技能都已在组合中'}</span>
                )}
              </div>
              <div className="bundle-add-footer">
                <button type="button" className="primary-button" disabled={saving || !pending.size} onClick={addPending}>添加选中（{pending.size}）</button>
                <button type="button" className="secondary-button" onClick={() => { setAdding(false); setPending(new Set()); setAddFilter(''); }}>完成</button>
              </div>
            </div>
          )}
          <button type="button" className="secondary-button danger-button" disabled={saving} onClick={deleteBundle}><Trash2 size={14} />删除组合</button>
        </div>
      </div>
    </DialogShell>
  );
}

// 新建组合弹窗
export function NewBundleModal({ isOpen, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  if (!isOpen) return null;
  const submit = async (event) => {
    event?.preventDefault();
    if (!name.trim()) { setError('请输入组合名称'); return; }
    setSubmitting(true);
    setError('');
    try {
      const created = await requestJson('/api/bundles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      setName('');
      onCreated(created);
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };
  return (
    <DialogShell title="新建技能组合" description="组合内放技能的快捷方式；之后可在组合详情里添加技能、复制一键安装指令。" onClose={onClose} size="small">
      {/* 原来不是 form：输完名字按 Enter 无反应，必须回鼠标点「创建」 */}
      <form className="bundle-new" onSubmit={submit}>
        <label>组合名称<input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：感知台架工具箱" /></label>
        {error && <div className="inline-error" role="alert">{error}</div>}
        <div className="dialog-footer">
          <button type="submit" className="primary-button" disabled={submitting}>{submitting ? '创建中…' : '创建'}</button>
        </div>
      </form>
    </DialogShell>
  );
}


// 从技能卡片/批量条快速加入组合：选已有组合，或当场新建一个并加入
export function AddToBundleModal({ isOpen, skillIds = [], label, bundles, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [createdBundle, setCreatedBundle] = useState(null);
  const [error, setError] = useState('');
  if (!isOpen) return null;

  const addAll = async (bundleId) => {
    for (const skillId of skillIds) {
      // 顺序发送：后端是 INSERT OR IGNORE，并发没有收益，失败也更好定位
      await requestJson(`/api/bundles/${bundleId}/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill_id: skillId }),
      });
    }
  };

  const add = async (bundleId) => {
    setBusy(true);
    setError('');
    try {
      await addAll(bundleId);
      onDone?.(bundleId);
      onClose();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  // 没有组合时原来是死路（提示语让用户自己去左栏新建，7+ 步）
  const createAndAdd = async (event) => {
    event.preventDefault();
    if (!newName.trim()) { setError('请输入组合名称'); return; }
    setBusy(true);
    try {
      const created = createdBundle?.name === newName.trim() ? createdBundle : await requestJson('/api/bundles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      setCreatedBundle(created);
      await addAll(created.id);
      setCreatedBundle(null);
      onDone?.(created.id);
      onClose();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <DialogShell title="加入技能组合" description={`选择「${label}」要加入的组合；组合内是快捷方式，可随时移除。`} onClose={onClose} size="small">
      <div className="bundle-add-list">
        {bundles.map((b) => (
          <button type="button" key={b.id} disabled={busy} onClick={() => add(b.id)}>
            <Package size={13} />{b.name}<span className="bundle-item-slug">{b.count} 个技能</span>
          </button>
        ))}
        {!bundles.length && <span className="bundle-empty">还没有组合——在下面直接建一个</span>}
      </div>
      <form className="bundle-rename bundle-inline-create" onSubmit={createAndAdd}>
        <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="新建组合并加入…" aria-label="新组合名称" />
        <button type="submit" className="secondary-button" disabled={busy || !newName.trim()}><Plus size={13} />新建并加入</button>
      </form>
      {error && <div className="inline-error" role="alert">{error}</div>}
    </DialogShell>
  );
}
