const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const archiver = require('archiver');

const baseStorageDir = process.env.STORAGE_DIR || path.join(__dirname, 'data', 'skills_files');
if (!fs.existsSync(baseStorageDir)) {
  fs.mkdirSync(baseStorageDir, { recursive: true });
}

// 保存 skill 到文件系统
function saveSkillToDisk(folderPath, slug, content, files = []) {
  const targetDir = path.join(baseStorageDir, folderPath || 'inbox', slug);
  fs.mkdirSync(targetDir, { recursive: true });
  
  // 写入主 SKILL.md
  fs.writeFileSync(path.join(targetDir, 'SKILL.md'), content, 'utf8');

  // 写入额外文件（references, scripts 等）
  if (Array.isArray(files)) {
    for (const file of files) {
      if (file && file.path && file.content !== undefined) {
        const filePath = path.join(targetDir, file.path);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, file.content, 'utf8');
      }
    }
  }
  return targetDir;
}

// 移动文件系统上的 skill
function moveSkillOnDisk(oldFolder, newFolder, slug) {
  const oldDir = path.join(baseStorageDir, oldFolder || 'inbox', slug);
  const newDir = path.join(baseStorageDir, newFolder || 'inbox', slug);
  if (fs.existsSync(oldDir)) {
    fs.mkdirSync(path.dirname(newDir), { recursive: true });
    fs.renameSync(oldDir, newDir);
  }
}

// 解析 Markdown Frontmatter
function parseSkillContent(rawContent) {
  try {
    const parsed = matter(rawContent);
    return {
      data: parsed.data || {},
      content: parsed.content || rawContent,
      raw: rawContent
    };
  } catch (err) {
    return {
      data: {},
      content: rawContent,
      raw: rawContent
    };
  }
}

// 打包为 zip 流
function createSkillArchive(folderPath, slug, res) {
  const targetDir = path.join(baseStorageDir, folderPath || 'inbox', slug);
  const archive = archiver('zip', { zlib: { level: 9 } });
  
  archive.pipe(res);
  if (fs.existsSync(targetDir)) {
    archive.directory(targetDir, false);
  } else {
    // 降级：如果磁盘暂缺，只写入一个空目录
    archive.append('# Skill file not found on disk', { name: 'SKILL.md' });
  }
  return archive.finalize();
}

module.exports = {
  baseStorageDir,
  saveSkillToDisk,
  moveSkillOnDisk,
  parseSkillContent,
  createSkillArchive
};
