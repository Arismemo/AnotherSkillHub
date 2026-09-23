const express = require('express');
const router = express.Router();
const db = require('../db');
const { saveSkillToDisk, replaceSkillOnDisk, moveSkillOnDisk, parseSkillContent, getSkillFileTree, getSkillFileContent } = require('../storage');
const { normalizeSkillMeta } = require('../skillMeta');
const { buildSkillGraph } = require('../skillGraph');
const { parseJson, snapshotSkillVersion, approveSkill, rejectSkill, warningsFor } = require('../review');

// 待审核：Agent 推送的新技能，或已发布技能上挂着 Agent 提交的更新
const PENDING_WHERE = "(status = 'pending' OR pending_content IS NOT NULL)";

// 获取统计数据 (用于左侧栏 badge)
router.get('/stats', (req, res) => {
  try {
    const inboxCount = db.prepare(`SELECT COUNT(*) as count FROM skills WHERE folder_path = 'inbox' AND is_deleted = 0`).get().count;
    const starredCount = db.prepare(`SELECT COUNT(*) as count FROM skills WHERE is_starred = 1 AND is_deleted = 0`).get().count;
    const allCount = db.prepare(`SELECT COUNT(*) as count FROM skills WHERE is_deleted = 0`).get().count;
    const trashCount = db.prepare(`SELECT COUNT(*) as count FROM skills WHERE is_deleted = 1`).get().count;
    const pendingCount = db.prepare(`SELECT COUNT(*) as count FROM skills WHERE is_deleted = 0 AND ${PENDING_WHERE}`).get().count;

    res.json({
      pending: pendingCount,
      inbox: inboxCount,
      starred: starredCount,
      all: allCount,
      trash: trashCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取所有标签
router.get('/tags', (req, res) => {
  try {
    const rows = db.prepare(`SELECT tags FROM skills WHERE is_deleted = 0`).all();
    const tagSet = new Set();
    rows.forEach(r => {
      try {
        const arr = JSON.parse(r.tags || '[]');
        arr.forEach(t => t && tagSet.add(t.trim()));
      } catch (e) {}
    });
    res.json(Array.from(tagSet));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取技能列表
router.get('/', (req, res) => {
  try {
    const { folder, tag, search, star, format } = req.query;
    const asText = format === 'text';

    // 列表不带 content：SKILL.md 全文只有详情页用得上，放在列表里每次搜索/切目录都要白白序列化+解析一遍
    let query = `SELECT id, slug, name, description, folder_path, tags, terminal_source, is_starred, is_deleted, version, created_at, updated_at,
      status, pending_content IS NOT NULL AS has_pending_update, json_array_length(COALESCE(security_warnings, '[]')) AS warning_count,
      json_array_length(COALESCE(files, '[]')) + 1 AS file_count
      FROM skills WHERE 1=1`;
    const params = [];

    if (folder === 'trash') {
      query += ` AND is_deleted = 1`;
    } else {
      query += ` AND is_deleted = 0`;
      // 纯文本格式给 Agent 用：只列出能拉取的已发布技能
      if (asText) query += ` AND status != 'pending'`;

      if (folder === 'pending') {
        query += ` AND ${PENDING_WHERE}`;
      } else if (folder === 'starred' || star === '1') {
        query += ` AND is_starred = 1`;
      } else if (folder && folder !== 'all') {
        query += ` AND folder_path = ?`;
        params.push(folder);
      }
    }

    // 多个关键词（空格分隔）需同时命中：Agent 常用「部署 仿真」这类组合词搜索
    for (const term of String(search || '').split(/\s+/).filter(Boolean)) {
      query += ` AND (name LIKE ? OR slug LIKE ? OR description LIKE ? OR content LIKE ?)`;
      const kw = `%${term}%`;
      params.push(kw, kw, kw, kw);
    }

    query += ` ORDER BY updated_at DESC`;

    let skills = db.prepare(query).all(...params);

    // 内存过滤 tag
    if (tag) {
      skills = skills.filter(s => {
        try {
          const arr = JSON.parse(s.tags || '[]');
          return arr.includes(tag);
        } catch (e) {
          return false;
        }
      });
    }

    if (asText) {
      const clip = (value, n) => (value.length > n ? `${value.slice(0, n - 1)}…` : value);
      const lines = skills.map((s) => `${s.slug}  ·  ${s.name}${s.description ? `  ·  ${clip(s.description, 80)}` : ''}  [${s.folder_path}]`);
      const header = skills.length
        ? `共 ${skills.length} 个技能（ash info <slug> 看详情，ash pull <slug> 安装）`
        : (search ? `没有找到匹配「${search}」的技能，换个关键词试试` : '技能库为空');
      return res.type('text/plain').send(`${[header, ...lines].join('\n')}\n`);
    }

    res.json(skills.map(s => ({
      ...s,
      has_pending_update: Boolean(s.has_pending_update),
      tags: JSON.parse(s.tags || '[]')
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Compact graph payload; full skill bodies stay on the server.
router.get('/graph', (req, res) => {
  try {
    const skills = db.prepare('SELECT id, slug, name, description, folder_path, tags, content FROM skills WHERE is_deleted = 0 ORDER BY slug').all();
    res.json(buildSkillGraph(skills));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取单个技能详情
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    let skill;
    if (isNaN(id)) {
      skill = db.prepare(`SELECT * FROM skills WHERE slug = ?`).get(id);
    } else {
      skill = db.prepare(`SELECT * FROM skills WHERE id = ? OR slug = ?`).get(id, id);
    }

    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    skill.tags = JSON.parse(skill.tags || '[]');
    skill.files = JSON.parse(skill.files || '[]');
    skill.security_warnings = parseJson(skill.security_warnings, []);
    skill.file_tree = getSkillFileTree(skill.folder_path, skill.slug);
    // 待审更新：连同文件列表一起给前端做差异对比
    skill.pending_update = skill.pending_content != null ? {
      content: skill.pending_content,
      files: parseJson(skill.pending_files, []),
      meta: parseJson(skill.pending_meta, {}),
      submitted_at: skill.pending_at,
    } : null;
    delete skill.pending_content;
    delete skill.pending_files;
    delete skill.pending_meta;
    res.json(skill);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 读取 skill 附属文件（scripts, references 等）
router.get('/:id/file', (req, res) => {
  try {
    const { id } = req.params;
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).json({ error: 'path query parameter is required' });
    }
    const skill = isNaN(id) 
      ? db.prepare(`SELECT * FROM skills WHERE slug = ?`).get(id)
      : db.prepare(`SELECT * FROM skills WHERE id = ? OR slug = ?`).get(id, id);
    if (!skill) return res.status(404).json({ error: 'Skill not found' });

    const content = getSkillFileContent(skill.folder_path, skill.slug, filePath);
    if (content === null) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.json({ path: filePath, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 元数据预览：粘贴导入时实时显示将得到的 slug/名称/标签，规则与创建、Agent 推送完全一致
router.post('/parse', (req, res) => {
  const { content = '', slug, name, description } = req.body || {};
  const meta = normalizeSkillMeta(String(content), { slug, name, description });
  const existing = meta.slug ? db.prepare('SELECT id, is_deleted FROM skills WHERE slug = ?').get(meta.slug) : null;
  res.json({
    slug: meta.slug, name: meta.name, description: meta.description, tags: meta.tags, version: meta.version,
    errors: meta.errors, warnings: meta.warnings,
    conflict: existing ? { id: existing.id, in_trash: Boolean(existing.is_deleted) } : null,
    security_warnings: warningsFor(String(content), []),
  });
});

// 创建新技能（网页新建 / 粘贴导入；人工创建直接发布）
router.post('/', (req, res) => {
  try {
    let { folder_path, content, files, terminal_source } = req.body;
    const meta = normalizeSkillMeta(content || '', {
      slug: req.body.slug,
      name: req.body.name,
      description: req.body.description,
      version: req.body.version,
      tags: Array.isArray(req.body.tags) && req.body.tags.length ? req.body.tags : undefined,
    });
    if (meta.errors.length) return res.status(400).json({ error: meta.errors.join('；') });
    const { slug, name, description, tags, version } = meta;

    // 默认放入 inbox
    folder_path = folder_path || 'inbox';
    files = Array.isArray(files) ? files : [];
    terminal_source = terminal_source || 'Web';

    // 检查是否存在同名 slug
    const existing = db.prepare(`SELECT id FROM skills WHERE slug = ?`).get(slug);

    if (existing) {
      return res.status(409).json({ error: `标识符「${slug}」已存在，请更换标识符或编辑已有技能` });
    }

    const stmt = db.prepare(`
      INSERT INTO skills (slug, name, description, folder_path, tags, content, files, terminal_source, version, security_warnings)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(slug, name, description || '', folder_path, JSON.stringify(tags), content, JSON.stringify(files), terminal_source, version,
      JSON.stringify(warningsFor(content, files)));

    saveSkillToDisk(folder_path, slug, content, files);

    res.status(201).json({
      message: 'Skill created successfully',
      id: result.lastInsertRowid,
      slug,
      folder_path
    });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: '标识符已存在，请更换后重试' });
    }
    res.status(500).json({ error: err.message });
  }
});

// 历史版本列表
router.get('/:id/versions', (req, res) => {
  const { id } = req.params;
  const skill = db.prepare('SELECT id FROM skills WHERE id = ?').get(id);
  if (!skill) return res.status(404).json({ error: 'Skill not found' });
  const rows = db.prepare(`
    SELECT id, name, description, source, created_at, label, LENGTH(content) AS content_size
    FROM skill_versions WHERE skill_id = ? ORDER BY created_at DESC, id DESC
  `).all(id);
  res.json(rows);
});

// 单个历史版本的完整内容（差异对比用）
router.get('/:id/versions/:versionId', (req, res) => {
  const ver = db.prepare('SELECT id, skill_id, content, files, name, description, source, label, created_at FROM skill_versions WHERE id = ? AND skill_id = ?')
    .get(req.params.versionId, Number(req.params.id));
  if (!ver) return res.status(404).json({ error: 'Version not found' });
  res.json({ ...ver, files: parseJson(ver.files, []) });
});

// 审核：采纳 Agent 推送的新技能或待审更新
router.post('/:id/approve', (req, res) => {
  try {
    const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(req.params.id);
    if (!skill || skill.is_deleted) return res.status(404).json({ error: 'Skill not found' });
    if (skill.status !== 'pending' && skill.pending_content == null) return res.status(400).json({ error: '该技能没有待审核的内容' });
    res.json({ success: true, result: approveSkill(skill) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 审核：拒绝（待审更新直接丢弃；待审新技能移入废纸篓）
router.post('/:id/reject', (req, res) => {
  try {
    const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(req.params.id);
    if (!skill || skill.is_deleted) return res.status(404).json({ error: 'Skill not found' });
    const result = rejectSkill(skill);
    if (result === 'noop') return res.status(400).json({ error: '该技能没有待审核的内容' });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 给历史版本打标签（如 v2.1 稳定版）
router.put('/:id/versions/:versionId/label', (req, res) => {
  const { label } = req.body;
  if (typeof label !== 'string') return res.status(400).json({ error: 'label must be string' });
  const r = db.prepare('UPDATE skill_versions SET label = ? WHERE id = ? AND skill_id = ?').run(label || null, req.params.versionId, Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Version not found' });
  res.json({ success: true });
});

// 恢复历史版本：快照当前版本后，将历史版本内容置为最新
router.post('/:id/versions/:versionId/restore', (req, res) => {
  try {
    const { id, versionId } = req.params;
    const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(id);
    if (!skill) return res.status(404).json({ error: 'Skill not found' });
    const ver = db.prepare('SELECT * FROM skill_versions WHERE id = ? AND skill_id = ?').get(versionId, Number(id));
    if (!ver) return res.status(404).json({ error: 'Version not found' });

    snapshotSkillVersion(skill, 'restore-backup');
    const verFiles = JSON.parse(ver.files || '[]');
    db.prepare('UPDATE skills SET content = ?, files = ?, security_warnings = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(ver.content, ver.files, JSON.stringify(warningsFor(ver.content, verFiles)), skill.id);
    replaceSkillOnDisk(skill.folder_path, skill.slug, ver.content, verFiles);
    res.json({ success: true, restored_version_id: ver.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新技能
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, folder_path, tags, content, files, terminal_source, is_starred, version } = req.body;

    const skill = db.prepare(`SELECT * FROM skills WHERE id = ?`).get(id);
    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    // 内容有实质变化才快照历史版本
    if (content !== undefined && content !== skill.content) snapshotSkillVersion(skill, 'web');

    const updatedName = name !== undefined ? name : skill.name;
    const updatedContent = content !== undefined ? content : skill.content;
    // description 为空时从 frontmatter 自动解析，免去重复填写
    let updatedDesc = description !== undefined ? description : skill.description;
    if (!updatedDesc) {
      const parsed = parseSkillContent(updatedContent);
      if (parsed.data && parsed.data.description) updatedDesc = String(parsed.data.description);
    }
    const updatedTags = tags !== undefined ? JSON.stringify(tags) : skill.tags;
    const updatedFiles = files !== undefined ? JSON.stringify(files) : skill.files;
    const updatedSource = terminal_source !== undefined ? terminal_source : skill.terminal_source;
    const updatedStarred = is_starred !== undefined ? (is_starred ? 1 : 0) : skill.is_starred;
    const updatedVersion = version !== undefined ? version : skill.version;

    // 如果改变了文件夹
    let finalFolder = skill.folder_path;
    if (folder_path && folder_path !== skill.folder_path) {
      moveSkillOnDisk(skill.folder_path, folder_path, skill.slug);
      finalFolder = folder_path;
    }

    const updatedWarnings = JSON.stringify(warningsFor(updatedContent, JSON.parse(updatedFiles || '[]')));
    db.prepare(`
      UPDATE skills
      SET name = ?, description = ?, folder_path = ?, tags = ?, content = ?, files = ?, terminal_source = ?, is_starred = ?, version = ?, security_warnings = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(updatedName, updatedDesc, finalFolder, updatedTags, updatedContent, updatedFiles, updatedSource, updatedStarred, updatedVersion, updatedWarnings, id);

    // 磁盘保存
    saveSkillToDisk(finalFolder, skill.slug, updatedContent, JSON.parse(updatedFiles));

    res.json({ message: 'Skill updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 移动到指定文件夹
router.post('/:id/move', (req, res) => {
  try {
    const { id } = req.params;
    const { target_folder } = req.body;

    if (!target_folder) {
      return res.status(400).json({ error: 'Target folder is required' });
    }

    const skill = db.prepare(`SELECT * FROM skills WHERE id = ?`).get(id);
    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    moveSkillOnDisk(skill.folder_path, target_folder, skill.slug);

    db.prepare(`UPDATE skills SET folder_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(target_folder, id);

    res.json({ message: `Moved to ${target_folder}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 复制 / 克隆到指定文件夹
router.post('/:id/copy', (req, res) => {
  try {
    const { id } = req.params;
    const { target_folder, new_name } = req.body;

    const skill = db.prepare(`SELECT * FROM skills WHERE id = ?`).get(id);
    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    const destFolder = target_folder || skill.folder_path;
    const baseSlug = skill.slug;
    const newSlug = `${baseSlug}-copy-${Date.now().toString().slice(-4)}`;
    const copyName = new_name || `${skill.name} (Copy)`;

    const stmt = db.prepare(`
      INSERT INTO skills (slug, name, description, folder_path, tags, content, files, terminal_source, version, security_warnings)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(newSlug, copyName, skill.description, destFolder, skill.tags, skill.content, skill.files, 'Web-Copy', skill.version, skill.security_warnings || '[]');

    saveSkillToDisk(destFolder, newSlug, skill.content, JSON.parse(skill.files));

    res.status(201).json({ message: 'Skill copied', id: result.lastInsertRowid, slug: newSlug });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 切换星标
router.post('/:id/star', (req, res) => {
  try {
    const { id } = req.params;
    const skill = db.prepare(`SELECT is_starred FROM skills WHERE id = ?`).get(id);
    if (!skill) return res.status(404).json({ error: 'Not found' });

    const newStarred = skill.is_starred ? 0 : 1;
    db.prepare(`UPDATE skills SET is_starred = ? WHERE id = ?`).run(newStarred, id);
    res.json({ is_starred: newStarred });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 移入废纸篓（软删除）
router.post('/:id/trash', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare(`UPDATE skills SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
    res.json({ message: 'Moved to trash' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 从废纸篓恢复
router.post('/:id/restore', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare(`UPDATE skills SET is_deleted = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
    res.json({ message: 'Restored from trash' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 彻底永久删除
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare(`DELETE FROM skills WHERE id = ?`).run(id);
    res.json({ message: 'Permanently deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
