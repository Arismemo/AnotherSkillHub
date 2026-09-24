const express = require('express');
const router = express.Router();
const db = require('../db');
const { cleanFolderPath, moveSkillOnDisk } = require('../storage');

// 目录本身或它的子目录（前缀比较；不用 LIKE，目录名里的 _ % 不是通配符）
const within = (folderPath, root) => folderPath === root || folderPath.startsWith(`${root}/`);

// 把 root 目录树下的技能搬到 mapFolder(旧目录) 给出的新目录：磁盘目录与数据库一起改，保持一致
function relocateSkills(userId, root, mapFolder) {
  const skills = db.prepare('SELECT id, slug, folder_path FROM skills WHERE user_id = ?').all(userId)
    .filter((s) => within(s.folder_path || 'inbox', root));
  const update = db.prepare('UPDATE skills SET folder_path = ? WHERE id = ?');
  for (const s of skills) {
    const target = mapFolder(s.folder_path || 'inbox');
    moveSkillOnDisk(userId, s.folder_path, target, s.slug);
    update.run(target, s.id);
  }
}

// 获取文件夹列表及树状结构
router.get('/', (req, res) => {
  try {
    const folders = db.prepare(`SELECT * FROM folders WHERE user_id = ? ORDER BY path ASC`).all(req.user.id);
    
    // 获取各文件夹下的 skill 计数
    const counts = db.prepare(`
      SELECT folder_path, COUNT(*) as count 
      FROM skills 
      WHERE user_id = ? AND is_deleted = 0 
      GROUP BY folder_path
    `).all(req.user.id).reduce((acc, cur) => {
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
    let { name } = req.body;
    if (!req.body.path) {
      return res.status(400).json({ error: 'Folder path is required' });
    }

    // 标准化 path，去除首尾斜杠；拒绝 . / .. 等会越出存储目录的段
    const folderPath = cleanFolderPath(req.body.path);
    if (!folderPath) return res.status(400).json({ error: `非法的目录: ${req.body.path}` });
    if (!name) {
      const segments = folderPath.split('/');
      name = segments[segments.length - 1];
    }

    const segments = folderPath.split('/');
    const parentPath = segments.slice(0, -1).join('/');

    // 递归确保父级存在
    if (parentPath) {
      const parentName = segments[segments.length - 2];
      db.prepare(`INSERT OR IGNORE INTO folders (user_id, path, name, parent_path) VALUES (?, ?, ?, ?)`).run(
        req.user.id,
        parentPath,
        parentName,
        segments.slice(0, -2).join('/')
      );
    }

    db.prepare(`INSERT OR IGNORE INTO folders (user_id, path, name, parent_path) VALUES (?, ?, ?, ?)`).run(
      req.user.id,
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
    const { old_path, new_name } = req.body;
    if (!old_path || !req.body.new_path) {
      return res.status(400).json({ error: 'old_path and new_path are required' });
    }
    const new_path = cleanFolderPath(req.body.new_path);
    if (!new_path) return res.status(400).json({ error: `非法的目录: ${req.body.new_path}` });
    const uid = req.user.id;
    if (old_path === 'inbox') {
      return res.status(400).json({ error: 'Cannot rename inbox' });
    }

    // 更新本文件夹
    const name = new_name || new_path.split('/').pop();
    const parentPath = new_path.split('/').slice(0, -1).join('/');

    db.prepare(`UPDATE folders SET path = ?, name = ?, parent_path = ? WHERE user_id = ? AND path = ?`).run(
      new_path,
      name,
      parentPath,
      uid,
      old_path
    );

    // 级联更新子文件夹
    const children = db.prepare(`SELECT * FROM folders WHERE user_id = ? AND path LIKE ?`).all(uid, `${old_path}/%`);
    for (const child of children) {
      const childNewPath = child.path.replace(old_path, new_path);
      const childParentPath = childNewPath.split('/').slice(0, -1).join('/');
      db.prepare(`UPDATE folders SET path = ?, parent_path = ? WHERE id = ?`).run(
        childNewPath,
        childParentPath,
        child.id
      );
    }

    // 级联更新技能：磁盘目录随 folder_path 一起搬，否则文件树、下载、安装都会找不到文件
    relocateSkills(uid, old_path, (folder) => new_path + folder.slice(old_path.length));

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

    // 将该文件夹及其子文件夹下的 skill 移回 inbox（连同磁盘目录），避免丢失
    relocateSkills(req.user.id, folderPath, () => 'inbox');

    // 删除文件夹
    db.prepare(`DELETE FROM folders WHERE user_id = ? AND (path = ? OR path LIKE ?)`).run(req.user.id, folderPath, `${folderPath}/%`);

    res.json({ message: 'Folder deleted, skills moved to inbox' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
