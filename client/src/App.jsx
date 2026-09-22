import React, { useState, useEffect } from 'react';
import FolderTree from './components/FolderTree';
import SkillList from './components/SkillList';
import SkillDetail from './components/SkillDetail';
import { NewSkillModal, MoveSkillModal, PasteSkillModal, AgentSetupModal } from './components/Modals';

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
  const [showNewModal, setShowNewModal] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [moveSkillTarget, setMoveSkillTarget] = useState(null);

  // 加载统计与文件夹树
  const fetchFoldersAndStats = async () => {
    try {
      const [resF, resStats] = await Promise.all([
        fetch('/api/folders'),
        fetch('/api/stats')
      ]);
      const dataF = await resF.json();
      const dataStats = await resStats.json();
      setFolders(dataF);
      setStats(dataStats);
    } catch (e) {
      console.error('Failed to load folders/stats:', e);
    }
  };

  // 加载技能列表
  const fetchSkills = async () => {
    setLoading(true);
    try {
      let url = `/api/skills?folder=${encodeURIComponent(currentFolder)}`;
      if (currentTag) url += `&tag=${encodeURIComponent(currentTag)}`;
      if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;

      const res = await fetch(url);
      const result = await res.json();
      const list = Array.isArray(result) ? result : (result.data || []);
      setSkills(list);

      // 提取全局标签
      const allRes = await fetch('/api/skills?folder=all');
      const allData = await allRes.json();
      const allList = Array.isArray(allData) ? allData : (allData.data || []);
      const tagSet = new Set();
      allList.forEach(s => {
        if (Array.isArray(s.tags)) s.tags.forEach(t => tagSet.add(t));
      });
      setTags([...tagSet]);

      // 默认选中第一个
      if (list.length > 0) {
        if (!selectedSkillId || !list.some(s => s.id === selectedSkillId)) {
          setSelectedSkillId(list[0].id);
        }
      } else {
        setSelectedSkillId(null);
      }
    } catch (e) {
      console.error('Failed to load skills:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFoldersAndStats();

    // 优先检测 URL 中的 ?skill= 参数，实现一键直达
    const params = new URLSearchParams(window.location.search);
    const targetSlug = params.get('skill');
    if (targetSlug) {
      fetch(`/api/skills/${targetSlug}`)
        .then(res => res.json())
        .then(skill => {
          if (skill && skill.id) {
            setCurrentFolder(skill.folder_path || 'all');
            setSelectedSkillId(skill.id);
          }
        })
        .catch(err => console.error('Failed to locate target skill by slug:', err));
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [currentFolder, currentTag, searchQuery]);

  // 操作处理
  const handleSelectFolder = (f) => {
    setCurrentFolder(f);
    setCurrentTag(null);
  };

  const handleSelectTag = (t) => {
    setCurrentTag(t);
  };

  const handleToggleStar = async (skillId) => {
    try {
      await fetch(`/api/skills/${skillId}/star`, { method: 'POST' });
      fetchSkills();
      fetchFoldersAndStats();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteSkill = async (skillId) => {
    if (!window.confirm('确定将该技能移入废纸篓吗？')) return;
    try {
      await fetch(`/api/skills/${skillId}/trash`, { method: 'POST' });
      fetchSkills();
      fetchFoldersAndStats();
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveSkill = async (updatedData) => {
    try {
      const res = await fetch(`/api/skills/${updatedData.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedData)
      });
      if (res.ok) {
        fetchSkills();
        fetchFoldersAndStats();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateFolder = async (folderPath) => {
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath })
      });
      if (res.ok) {
        fetchFoldersAndStats();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const selectedSkill = skills.find(s => s.id === selectedSkillId) || null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 font-sans text-slate-200">
      {/* 1. 左栏：分类与多级文件夹树 */}
      <aside className="w-64 flex-shrink-0 border-r border-slate-800 bg-slate-950">
        <FolderTree
          currentFolder={currentFolder}
          onSelectFolder={handleSelectFolder}
          folders={folders}
          stats={stats}
          tags={tags}
          currentTag={currentTag}
          onSelectTag={handleSelectTag}
          onCreateFolder={handleCreateFolder}
          onNewSkill={() => setShowNewModal(true)}
          onPasteImport={() => setShowPasteModal(true)}
          onOpenSetup={() => setShowSetupModal(true)}
          onRefresh={() => { fetchFoldersAndStats(); fetchSkills(); }}
        />
      </aside>

      {/* 2. 中栏：技能卡片列表 */}
      <section className="w-80 flex-shrink-0 border-r border-slate-800 bg-slate-900/80 flex flex-col">
        <SkillList
          skills={skills}
          selectedSkillId={selectedSkillId}
          onSelectSkill={(id) => setSelectedSkillId(id)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          sortBy={sortBy}
          onSortChange={setSortBy}
          onNewSkill={() => setShowNewModal(true)}
          onToggleStar={handleToggleStar}
          onDeleteSkill={handleDeleteSkill}
          onMoveSkill={(skill) => setMoveSkillTarget(skill)}
          loading={loading}
          currentFolder={currentFolder}
        />
      </section>

      {/* 3. 右栏：详情与操作中心 */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-950 overflow-hidden">
        {selectedSkill ? (
          <SkillDetail
            skill={selectedSkill}
            folders={folders}
            onSave={handleSaveSkill}
            onToggleStar={() => handleToggleStar(selectedSkill.id)}
            onDelete={() => handleDeleteSkill(selectedSkill.id)}
            onMove={() => setMoveSkillTarget(selectedSkill)}
            onRefresh={() => { fetchSkills(); fetchFoldersAndStats(); }}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 bg-slate-950 p-8 select-none">
            <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-indigo-400 mb-4 shadow-lg">
              <span className="text-2xl">⚡</span>
            </div>
            <p className="text-sm font-medium text-slate-300">请从左侧或中栏选择技能查看详情</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm text-center leading-relaxed">
              支持点击一键复制指令发给 Agent，或在中栏顶部新建自定义技能
            </p>
          </div>
        )}
      </main>

      {/* 弹窗：新建技能 */}
      <NewSkillModal
        isOpen={showNewModal}
        folders={folders}
        onClose={() => setShowNewModal(false)}
        onCreate={async (skillData) => {
          try {
            const res = await fetch('/api/skills', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(skillData)
            });
            if (res.ok) {
              const created = await res.json();
              fetchSkills();
              fetchFoldersAndStats();
              if (created.id) setSelectedSkillId(created.id);
            }
          } catch (e) {
            console.error(e);
          }
        }}
      />

      {/* 弹窗：移动技能 */}
      <MoveSkillModal
        isOpen={!!moveSkillTarget}
        skill={moveSkillTarget}
        folders={folders}
        onClose={() => setMoveSkillTarget(null)}
        onMove={async (skillId, targetFolder) => {
          try {
            const res = await fetch(`/api/skills/${skillId}/move`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ target_folder: targetFolder })
            });
            if (res.ok) {
              fetchSkills();
              fetchFoldersAndStats();
            }
          } catch (e) {
            console.error(e);
          }
        }}
      />
    </div>
  );
}
