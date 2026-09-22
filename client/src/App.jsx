import { useCallback, useEffect, useMemo, useState } from 'react';
import FolderTree from './components/FolderTree';
import SkillList from './components/SkillList';
import SkillDetail from './components/SkillDetail';
import { AgentSetupModal, MoveSkillModal, NewSkillModal, PasteSkillModal } from './components/Modals';

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `请求失败（${response.status}）`);
  }
  return payload;
}

export default function App() {
  const [currentFolder, setCurrentFolder] = useState('inbox');
  const [currentTag, setCurrentTag] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('updated');
  const [skills, setSkills] = useState([]);
  const [stats, setStats] = useState({ inbox: 0, starred: 0, all: 0, trash: 0 });
  const [folders, setFolders] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedSkillId, setSelectedSkillId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [appError, setAppError] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [moveSkillTarget, setMoveSkillTarget] = useState(null);

  const fetchFoldersAndStats = useCallback(async () => {
    try {
      const [folderData, statData, tagData] = await Promise.all([
        requestJson('/api/folders'),
        requestJson('/api/skills/stats'),
        requestJson('/api/skills/tags'),
      ]);
      setFolders(folderData);
      setStats(statData);
      setTags(tagData);
    } catch (error) {
      setAppError(error.message);
    }
  }, []);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    setAppError('');
    try {
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
      setAppError(error.message);
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

  const handleMoveSkill = (skillId, targetFolder) => runMutation(`/api/skills/${skillId}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_folder: targetFolder }),
  });

  const handleTrashSkill = async (skillId) => {
    if (!window.confirm('将这个技能移入废纸篓？')) return;
    await runMutation(`/api/skills/${skillId}/trash`, { method: 'POST' });
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

  const handleCopySkill = async (skill) => {
    const copied = await runMutation(`/api/skills/${skill.id}/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_folder: skill.folder_path }),
    });
    if (copied?.id) setSelectedSkillId(Number(copied.id));
  };

  const handleSaveSkill = async (updatedData) => Boolean(await runMutation(`/api/skills/${updatedData.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updatedData),
  }));

  const sortedSkills = useMemo(() => [...skills].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name, 'zh-CN');
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  }), [skills, sortBy]);

  const selectedSkill = skills.find((skill) => skill.id === selectedSkillId) || null;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#skill-detail">跳至技能详情</a>
      <aside className="app-sidebar" aria-label="技能分类导航">
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
        />
      </aside>

      <section className="app-list" aria-label="技能列表">
        <SkillList
          skills={sortedSkills}
          selectedSkillId={selectedSkillId}
          onSelectSkill={setSelectedSkillId}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          currentFolder={currentFolder}
          currentTag={currentTag}
          sortBy={sortBy}
          onSortChange={setSortBy}
          onToggleStar={handleToggleStar}
          onQuickMove={setMoveSkillTarget}
          onCopySkill={handleCopySkill}
          onTrashSkill={handleTrashSkill}
          onRestoreSkill={(id) => runMutation(`/api/skills/${id}/restore`, { method: 'POST' })}
          onPermanentDelete={handlePermanentDelete}
          onNewSkill={() => setShowNewModal(true)}
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
            folders={folders}
            onSave={handleSaveSkill}
            onMoveFolder={handleMoveSkill}
          />
        ) : (
          <div className="detail-empty">
            <p>{loading ? '正在载入技能…' : '选择一个技能查看详情'}</p>
            {!loading && <span>技能内容、关联文件和操作会显示在这里。</span>}
          </div>
        )}
      </main>

      <NewSkillModal
        isOpen={showNewModal}
        folders={folders}
        onClose={() => setShowNewModal(false)}
        onCreate={handleCreateSkill}
      />
      <MoveSkillModal
        isOpen={Boolean(moveSkillTarget)}
        skill={moveSkillTarget}
        folders={folders}
        onClose={() => setMoveSkillTarget(null)}
        onMove={handleMoveSkill}
      />
      <PasteSkillModal
        isOpen={showPasteModal}
        folders={folders}
        onClose={() => setShowPasteModal(false)}
        onImport={handleCreateSkill}
      />
      <AgentSetupModal
        isOpen={showSetupModal}
        onClose={() => setShowSetupModal(false)}
      />
    </div>
  );
}
