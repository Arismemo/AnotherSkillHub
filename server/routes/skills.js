const express = require('express');
const router = express.Router();
const db = require('../db');
const { saveSkillToDisk, moveSkillOnDisk, parseSkillContent, getSkillFileTree, getSkillFileContent } = require('../storage');

// 获取统计数据 (用于左侧栏 badge)
router.get('/stats', (req, res) => {
  try {
    const inboxCount = db.prepare(`SELECT COUNT(*) as count FROM skills WHERE folder_path = 'inbox' AND is_deleted = 0`).get().count;
    const starredCount = db.prepare(`SELECT COUNT(*) as count FROM skills WHERE is_starred = 1 AND is_deleted = 0`).get().count;
    const allCount = db.prepare(`SELECT COUNT(*) as count FROM skills WHERE is_deleted = 0`).get().count;
    const trashCount = db.prepare(`SELECT COUNT(*) as count FROM skills WHERE is_deleted = 1`).get().count;

    res.json({
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
    const { folder, tag, search, star } = req.query;

    let query = `SELECT id, slug, name, description, folder_path, tags, content, terminal_source, is_starred, is_deleted, version, created_at, updated_at FROM skills WHERE 1=1`;
    const params = [];

    if (folder === 'trash') {
      query += ` AND is_deleted = 1`;
    } else {
      query += ` AND is_deleted = 0`;

      if (folder === 'starred' || star === '1') {
        query += ` AND is_starred = 1`;
      } else if (folder && folder !== 'all') {
        query += ` AND folder_path = ?`;
        params.push(folder);
      }
    }

    if (search) {
      query += ` AND (name LIKE ? OR slug LIKE ? OR description LIKE ? OR content LIKE ?)`;
      const kw = `%${search}%`;
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

    res.json(skills.map(s => ({
      ...s,
      tags: JSON.parse(s.tags || '[]')
    })));
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
    skill.file_tree = getSkillFileTree(skill.folder_path, skill.slug);
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

// 创建新技能（或由 Agent 写入）
router.post('/', (req, res) => {
  try {
    let { slug, name, description, folder_path, tags, content, files, terminal_source, version } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // 从 Markdown 中尝试解析 frontmatter 自动补齐元数据
    const parsed = parseSkillContent(content);
    if (!name && parsed.data.name) name = parsed.data.name;
    if (!description && parsed.data.description) description = parsed.data.description;
    if (!slug && parsed.data.name) slug = parsed.data.name;

    if (!slug) {
      slug = 'skill-' + Date.now();
    }
    // 格式化 slug 为合法的 url 字符
    slug = slug.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!name) name = slug;

    // 默认放入 inbox
    folder_path = folder_path || 'inbox';
    tags = Array.isArray(tags) ? tags : [];
    files = Array.isArray(files) ? files : [];
    terminal_source = terminal_source || 'Web';
    version = version || '1.0.0';

    // 检查是否存在同名 slug
    const existing = db.prepare(`SELECT id, folder_path FROM skills WHERE slug = ?`).get(slug);

    if (existing) {
      // 覆盖更新现有 skill
      const stmt = db.prepare(`
        UPDATE skills 
        SET name = ?, description = ?, tags = ?, content = ?, files = ?, terminal_source = ?, version = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      stmt.run(name, description || '', JSON.stringify(tags), content, JSON.stringify(files), terminal_source, version, existing.id);

      saveSkillToDisk(existing.folder_path, slug, content, files);
      return res.json({ message: 'Skill updated', slug, id: existing.id, folder_path: existing.folder_path });
    }

    const stmt = db.prepare(`
      INSERT INTO skills (slug, name, description, folder_path, tags, content, files, terminal_source, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(slug, name, description || '', folder_path, JSON.stringify(tags), content, JSON.stringify(files), terminal_source, version);

    saveSkillToDisk(folder_path, slug, content, files);

    res.status(201).json({
      message: 'Skill created successfully',
      id: result.lastInsertRowid,
      slug,
      folder_path
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

    db.prepare(`
      UPDATE skills
      SET name = ?, description = ?, folder_path = ?, tags = ?, content = ?, files = ?, terminal_source = ?, is_starred = ?, version = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(updatedName, updatedDesc, finalFolder, updatedTags, updatedContent, updatedFiles, updatedSource, updatedStarred, updatedVersion, id);

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
      INSERT INTO skills (slug, name, description, folder_path, tags, content, files, terminal_source, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(newSlug, copyName, skill.description, destFolder, skill.tags, skill.content, skill.files, 'Web-Copy', skill.version);

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
