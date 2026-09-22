import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Terminal } from 'lucide-react';
import FolderTree from './components/FolderTree';
import SkillList from './components/SkillList';
import SkillDetail from './components/SkillDetail';
import CommandPalette from './components/CommandPalette';
import ToastContainer from './components/Toast';
import { showToast } from './components/toastBus';
import { AgentSetupModal, NewSkillModal, PasteSkillModal } from './components/Modals';
import { BundleDetail, NewBundleModal } from './components/Bundles';

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `请求失败（${response.status}）`);
  }
  return payload;
}

// D1: 状态记忆（localStorage 持久化）
function usePersistedState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const saved = window.localStorage.getItem(`ash:${key}`);
      return saved === null ? initial : JSON.parse(saved);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(`ash:${key}`, JSON.stringify(value));
    } catch { /* 存储不可用则静默降级为内存态 */ }
  }, [key, value]);
  return [value, setValue];
}

export default function App() {
  const [currentFolder, setCurrentFolder] = useState('inbox');
  const [currentTag, setCurrentTag] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('updated');
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistedState('sidebar-collapsed', false);
  const [recentSkillIds, setRecentSkillIds] = usePersistedState('recent-skills', []);
  const recentIdsRef = useRef([]);
  useEffect(() => { recentIdsRef.current = recentSkillIds; }, [recentSkillIds]);
  const [skills, setSkills] = useState([]);
  const [stats, setStats] = useState({ inbox: 0, starred: 0, all: 0, trash: 0 });
  const [folders, setFolders] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedSkillId, setSelectedSkillId] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const [loading, setLoading] = useState(true);
  const [appError, setAppError] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [bundles, setBundles] = useState([]);
  const [activeBundle, setActiveBundle] = useState(null);
  const [showBundleModal, setShowBundleModal] = useState(false);
  const [showPalette, setShowPalette] = useState(false);

  const fetchFoldersAndStats = useCallback(async () => {
    try {
      const [folderData, statData, tagData, bundleData] = await Promise.all([
        requestJson('/api/folders'),
        requestJson('/api/skills/stats'),
        requestJson('/api/skills/tags'),
        requestJson('/api/bundles').catch(() => []),
      ]);
      setFolders(folderData);
      setStats(statData);
      setTags(tagData);
      setBundles(Array.isArray(bundleData) ? bundleData : []);
    } catch (error) {
      setAppError(error.message);
    }
  }, []);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    setAppError('');
    try {
      if (currentFolder === 'recent') {
        // 最近浏览视图：全量拉取后按最近浏览顺序过滤
        const all = await requestJson('/api/skills?folder=all');
        const allList = Array.isArray(all) ? all : all.data || [];
        const byId = new Map(allList.map((s) => [s.id, s]));
        const list = recentIdsRef.current.map((id) => byId.get(id)).filter(Boolean);
        setSkills(list);
        setSelectedSkillId((previousId) => {
          if (previousId && list.some((skill) => skill.id === previousId)) return previousId;
          return list[0]?.id ?? null;
        });
        setSelectedIds(new Set());
      } else {
        const params = new URLSearchParams({ folder: currentFolder });
        if (currentTag) params.set('tag', currentTag);
        if (searchQuery.trim()) params.set('search', searchQuery.trim());
        const result = await requestJson(`/api/skills?${params}`);
        const list = Array.isArray(result) ? result : result.data || [];
        setSkills(list);
        setSelectedSkillId((previousId) => {
          if (previousId && list.some((skill) => skill.id === previousId)) return previousId;
          return list[0]?.id ?? null;
        });
        setSelectedIds(new Set());
      }
    } catch (error) {
      setSkills([]);
      setSelectedSkillId(null);
      setAppError(error.message);
    } finally {
      setLoading(false);
    }
  }, [currentFolder, currentTag, searchQuery]);

  useEffect(() => {
    const timer = window.setTimeout(fetchFoldersAndStats, 0);
    return () => window.clearTimeout(timer);
  }, [fetchFoldersAndStats]);

  useEffect(() => {
    const targetSlug = new URLSearchParams(window.location.search).get('skill');
    if (!targetSlug) return;

    let cancelled = false;
    requestJson(`/api/skills/${encodeURIComponent(targetSlug)}`)
      .then((skill) => {
        if (cancelled || !skill?.id) return;
        setCurrentFolder(skill.folder_path || 'all');
        setSelectedSkillId(skill.id);
      })
      .catch((error) => {
        if (!cancelled) setAppError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(fetchSkills, 0);
    return () => window.clearTimeout(timer);
  }, [fetchSkills]);

  // A1: ⌘K / Ctrl+K 命令面板
  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setShowPalette((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A4: 最近浏览记录
  useEffect(() => {
    if (selectedSkillId == null) return;
    setRecentSkillIds((prev) => [selectedSkillId, ...prev.filter((id) => id !== selectedSkillId)].slice(0, 8));
  }, [selectedSkillId, setRecentSkillIds]);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchSkills(), fetchFoldersAndStats()]);
  }, [fetchFoldersAndStats, fetchSkills]);

  const runMutation = async (url, options, { refresh = true } = {}) => {
    setAppError('');
    try {
      const result = await requestJson(url, options);
      if (refresh) await refreshAll();
      return result;
    } catch (error) {
      showToast(error.message);
      return null;
    }
  };

  const handleSelectFolder = (folder) => {
    setCurrentFolder(folder);
    setCurrentTag(null);
  };

  const handleCreateFolder = (path) => runMutation('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });

  const handleRenameFolder = (oldPath, newPath, newName) => runMutation('/api/folders', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ old_path: oldPath, new_path: newPath, new_name: newName }),
  });

  const handleDeleteFolder = (path) => runMutation(`/api/folders?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
  });

  const handleToggleStar = (skillId) => runMutation(`/api/skills/${skillId}/star`, { method: 'POST' });

  // C3: 拖拽/移动带 Toast 撤销
  const handleMoveSkill = async (skillId, targetFolder) => {
    const skill = skills.find((s) => s.id === skillId);
    await runMutation(`/api/skills/${skillId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_folder: targetFolder }),
    });
    if (skill) {
      showToast(`已移动「${skill.name}」到 ${targetFolder}`, {
        actionLabel: '撤销',
        onAction: () => runMutation(`/api/skills/${skillId}/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target_folder: skill.folder_path }),
        }),
      });
    }
  };

  // C1: 废纸篓改为 Toast + 撤销，去掉 confirm
  const handleTrashSkill = async (skillId) => {
    const skill = skills.find((s) => s.id === skillId);
    await runMutation(`/api/skills/${skillId}/trash`, { method: 'POST' });
    showToast(`已将「${skill?.name ?? '技能'}」移入废纸篓`, {
      actionLabel: '撤销',
      onAction: () => runMutation(`/api/skills/${skillId}/restore`, { method: 'POST' }),
    });
  };

  // C4: 批量操作
  const handleBatchMove = async (targetFolder, explicitIds) => {
    const ids = explicitIds && explicitIds.length ? [...explicitIds] : [...selectedIds];
    const targets = ids.map((id) => skills.find((s) => s.id === id)).filter(Boolean);
    await Promise.all(ids.map((id) => requestJson(`/api/skills/${id}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_folder: targetFolder }),
    }).catch(() => null)));
    await refreshAll();
    showToast(`已移动 ${ids.length} 个技能到 ${targetFolder}`, {
      actionLabel: '撤销',
      onAction: () => Promise.all(targets.map((s) => requestJson(`/api/skills/${s.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_folder: s.folder_path }),
      }).catch(() => null))).then(() => refreshAll()),
    });
    setSelectedIds(new Set());
  };

  const handleBatchTrash = async () => {
    const ids = [...selectedIds];
    await Promise.all(ids.map((id) => requestJson(`/api/skills/${id}/trash`, { method: 'POST' }).catch(() => null)));
    await refreshAll();
    showToast(`已将 ${ids.length} 个技能移入废纸篓`, {
      actionLabel: '撤销',
      onAction: () => Promise.all(ids.map((id) => requestJson(`/api/skills/${id}/restore`, { method: 'POST' }).catch(() => null))).then(() => refreshAll()),
    });
    setSelectedIds(new Set());
  };

  const handlePermanentDelete = async (skillId) => {
    if (!window.confirm('永久删除这个技能？此操作无法撤销。')) return;
    await runMutation(`/api/skills/${skillId}`, { method: 'DELETE' });
  };

  const handleCreateSkill = async (skillData) => {
    const created = await runMutation('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(skillData),
    });
    if (created?.id) setSelectedSkillId(Number(created.id));
    return Boolean(created);
  };

  const handleSaveSkill = async (updatedData) => Boolean(await runMutation(`/api/skills/${updatedData.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updatedData),
  }));

  // C4: 多选（Cmd 点选 / Shift 范围选）
  const handleSelectSkill = (id, event) => {
    if (event && (event.metaKey || event.ctrlKey)) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    if (event && event.shiftKey && lastSelectedIndex != null) {
      const currentIdx = skills.findIndex((s) => s.id === id);
      if (currentIdx !== -1) {
        const [from, to] = lastSelectedIndex < currentIdx ? [lastSelectedIndex, currentIdx] : [currentIdx, lastSelectedIndex];
        setSelectedIds(new Set(skills.slice(from, to + 1).map((s) => s.id)));
        return;
      }
    }
    setSelectedSkillId(id);
    setSelectedIds(new Set([id]));
    setLastSelectedIndex(skills.findIndex((s) => s.id === id));
  };

  const sortedSkills = useMemo(() => [...skills].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name, 'zh-CN');
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  }), [skills, sortBy]);

  const recentSkills = useMemo(
    () => recentSkillIds.map((id) => skills.find((s) => s.id === id)).filter(Boolean).slice(0, 5),
    [recentSkillIds, skills],
  );

  const selectedSkill = skills.find((skill) => skill.id === selectedSkillId) || null;

  // C3: 拖拽技能到目录
  const handleDropOnFolder = (event, folderPath) => {
    event.preventDefault();
    const rawId = event.dataTransfer.getData('text/skill-id');
    if (rawId) {
      handleMoveSkill(Number(rawId), folderPath);
      return;
    }
    const rawIds = event.dataTransfer.getData('text/skill-ids');
    if (rawIds) {
      JSON.parse(rawIds).forEach((id) => runMutation(`/api/skills/${id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_folder: folderPath }),
      }));
    }
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#skill-detail">跳至技能详情</a>
      <aside className={`app-sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`} aria-label="技能分类导航">
        <div className="sidebar-topbar">
          {sidebarCollapsed ? (
            <button
              type="button"
              className="icon-button sidebar-collapse-toggle"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="展开分类导航"
              title="展开分类导航"
            >
              <ChevronRight size={16} />
            </button>
          ) : (
            <>
              <div className="sidebar-brand">
                <div className="brand-mark" aria-hidden="true"><Terminal size={16} /></div>
                <div className="min-w-0">
                  <h1>AnotherSkillHub</h1>
                  <p>Agent 技能库</p>
                </div>
              </div>
              <button
                type="button"
                className="icon-button sidebar-collapse-toggle"
                onClick={() => setSidebarCollapsed(true)}
                aria-label="收起分类导航"
                title="收起分类导航"
              >
                <ChevronLeft size={16} />
              </button>
            </>
          )}
        </div>
        {!sidebarCollapsed && (
          <FolderTree
            currentFolder={currentFolder}
            onSelectFolder={handleSelectFolder}
            folders={folders}
            stats={stats}
            tags={tags}
            currentTag={currentTag}
            onSelectTag={setCurrentTag}
            onCreateFolder={handleCreateFolder}
            onRenameFolder={handleRenameFolder}
            onDeleteFolder={handleDeleteFolder}
            onNewSkill={() => setShowNewModal(true)}
            onPasteImport={() => setShowPasteModal(true)}
            onOpenSetup={() => setShowSetupModal(true)}
            recentSkills={recentSkills}
            bundles={bundles}
            onSelectBundle={setActiveBundle}
            onNewBundle={() => setShowBundleModal(true)}
            onDropOnFolder={handleDropOnFolder}
          />
        )}
      </aside>

      <section className="app-list" aria-label="技能列表">
        <SkillList
          skills={sortedSkills}
          selectedSkillId={selectedSkillId}
          selectedIds={selectedIds}
          onSelectSkill={handleSelectSkill}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          currentFolder={currentFolder}
          currentTag={currentTag}
          sortBy={sortBy}
          onSortChange={setSortBy}
          onToggleStar={handleToggleStar}
          onTrashSkill={handleTrashSkill}
          onRestoreSkill={(id) => runMutation(`/api/skills/${id}/restore`, { method: 'POST' })}
          onPermanentDelete={handlePermanentDelete}
          onNewSkill={() => setShowNewModal(true)}
          onBatchMove={handleBatchMove}
          onBatchTrash={handleBatchTrash}
          folders={folders}
          onClearSelection={() => setSelectedIds(new Set())}
          loading={loading}
          error={appError}
          onRetry={refreshAll}
        />
      </section>

      <main id="skill-detail" className="app-detail" tabIndex="-1">
        {appError && selectedSkill && (
          <div className="app-error" role="alert">
            <span>{appError}</span>
            <button type="button" onClick={refreshAll}>重试</button>
          </div>
        )}
        {selectedSkill ? (
          <SkillDetail
            key={selectedSkill.id}
            skill={selectedSkill}
            onSave={handleSaveSkill}
            onMoveFolder={handleMoveSkill}
          />
        ) : (
          <div className="detail-empty">
            <p>{loading ? '正在载入技能…' : '选择一个技能查看详情'}</p>
            {!loading && <span>技能内容、关联文件和操作会显示在这里。</span>}
            {!loading && (
              <div className="empty-actions">
                <button type="button" className="primary-button" onClick={() => setShowNewModal(true)}>新建技能</button>
                <button type="button" className="secondary-button" onClick={() => setShowPasteModal(true)}>粘贴导入</button>
              </div>
            )}
          </div>
        )}
      </main>

      <CommandPalette
        isOpen={showPalette}
        onClose={() => setShowPalette(false)}
        skills={skills}
        folders={folders}
        onSelectSkill={(id) => { setSelectedSkillId(id); const s = skills.find((x) => x.id === id); if (s && !['inbox', 'all', 'starred', 'trash'].includes(s.folder_path)) setCurrentFolder('all'); }}
        onSelectFolder={handleSelectFolder}
        onNewSkill={() => setShowNewModal(true)}
        onPasteImport={() => setShowPasteModal(true)}
        onOpenSetup={() => setShowSetupModal(true)}
        onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
      />

      <NewSkillModal
        isOpen={showNewModal}
        folders={folders}
        onClose={() => setShowNewModal(false)}
        onCreate={handleCreateSkill}
      />
      <PasteSkillModal
        isOpen={showPasteModal}
        folders={folders}
        onClose={() => setShowPasteModal(false)}
        onImport={handleCreateSkill}
      />
      <BundleDetail
        bundle={activeBundle}
        onClose={() => setActiveBundle(null)}
        onChanged={fetchFoldersAndStats}
        showToast={showToast}
      />
      <NewBundleModal
        isOpen={showBundleModal}
        onClose={() => setShowBundleModal(false)}
        onCreated={(b) => { setShowBundleModal(false); setActiveBundle(b); fetchFoldersAndStats(); }}
      />
      <AgentSetupModal
        isOpen={showSetupModal}
        onClose={() => setShowSetupModal(false)}
      />
      <ToastContainer />
    </div>
  );
}
