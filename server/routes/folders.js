const express = require('express');
const router = express.Router();
const db = require('../db');

// 获取文件夹列表及树状结构
router.get('/', (req, res) => {
  try {
    const folders = db.prepare(`SELECT * FROM folders ORDER BY path ASC`).all();
    
    // 获取各文件夹下的 skill 计数
    const counts = db.prepare(`
      SELECT folder_path, COUNT(*) as count 
      FROM skills 
      WHERE is_deleted = 0 
      GROUP BY folder_path
    `).all().reduce((acc, cur) => {
      acc[cur.folder_path] = cur.count;
      return acc;
    }, {});

    const enrichedFolders = folders.map(f => ({
      ...f,
      count: counts[f.path] || 0
    }));

    res.json(enrichedFolders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 创建文件夹
router.post('/', (req, res) => {
  try {
    let { path: folderPath, name } = req.body;
    if (!folderPath) {
      return res.status(400).json({ error: 'Folder path is required' });
    }

    // 标准化 path，去除首尾斜杠
    folderPath = folderPath.trim().replace(/^\/+|\/+$/g, '');
    if (!name) {
      const segments = folderPath.split('/');
      name = segments[segments.length - 1];
    }

    const segments = folderPath.split('/');
    const parentPath = segments.slice(0, -1).join('/');

    // 递归确保父级存在
    if (parentPath) {
      const parentName = segments[segments.length - 2];
      db.prepare(`INSERT OR IGNORE INTO folders (path, name, parent_path) VALUES (?, ?, ?)`).run(
        parentPath,
        parentName,
        segments.slice(0, -2).join('/')
      );
    }

    db.prepare(`INSERT OR IGNORE INTO folders (path, name, parent_path) VALUES (?, ?, ?)`).run(
      folderPath,
      name,
      parentPath
    );

    res.status(201).json({ message: 'Folder created', path: folderPath, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 重命名或移动文件夹
router.put('/', (req, res) => {
  try {
    const { old_path, new_path, new_name } = req.body;
    if (!old_path || !new_path) {
      return res.status(400).json({ error: 'old_path and new_path are required' });
    }
    if (old_path === 'inbox') {
      return res.status(400).json({ error: 'Cannot rename inbox' });
    }

    // 更新本文件夹
    const name = new_name || new_path.split('/').pop();
    const parentPath = new_path.split('/').slice(0, -1).join('/');

    db.prepare(`UPDATE folders SET path = ?, name = ?, parent_path = ? WHERE path = ?`).run(
      new_path,
      name,
      parentPath,
      old_path
    );

    // 级联更新子文件夹
    const children = db.prepare(`SELECT * FROM folders WHERE path LIKE ?`).all(`${old_path}/%`);
    for (const child of children) {
      const childNewPath = child.path.replace(old_path, new_path);
      const childParentPath = childNewPath.split('/').slice(0, -1).join('/');
      db.prepare(`UPDATE folders SET path = ?, parent_path = ? WHERE path = ?`).run(
        childNewPath,
        childParentPath,
        child.path
      );
    }

    // 级联更新 skills 表中的 folder_path
    db.prepare(`UPDATE skills SET folder_path = ? WHERE folder_path = ?`).run(new_path, old_path);
    const subSkills = db.prepare(`SELECT id, folder_path FROM skills WHERE folder_path LIKE ?`).all(`${old_path}/%`);
    for (const s of subSkills) {
      const updatedPath = s.folder_path.replace(old_path, new_path);
      db.prepare(`UPDATE skills SET folder_path = ? WHERE id = ?`).run(updatedPath, s.id);
    }

    res.json({ message: 'Folder renamed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除文件夹
router.delete('/', (req, res) => {
  try {
    const { path: folderPath } = req.query;
    if (!folderPath) {
      return res.status(400).json({ error: 'Folder path is required' });
    }
    if (folderPath === 'inbox') {
      return res.status(400).json({ error: 'Cannot delete inbox' });
    }

    // 将该文件夹及其子文件夹下的 skill 移回 inbox，避免丢失
    db.prepare(`UPDATE skills SET folder_path = 'inbox' WHERE folder_path = ? OR folder_path LIKE ?`).run(
      folderPath,
      `${folderPath}/%`
    );

    // 删除文件夹
    db.prepare(`DELETE FROM folders WHERE path = ? OR path LIKE ?`).run(folderPath, `${folderPath}/%`);

    res.json({ message: 'Folder deleted, skills moved to inbox' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
