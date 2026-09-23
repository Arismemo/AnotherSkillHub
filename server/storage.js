const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const archiver = require('archiver');

const baseStorageDir = process.env.STORAGE_DIR || path.join(__dirname, '../data/skills_files');
if (!fs.existsSync(baseStorageDir)) {
  fs.mkdirSync(baseStorageDir, { recursive: true });
}

// 技能目录内的相对路径 → 绝对路径；越界（../、绝对路径）返回 null
function resolveInside(dir, relativePath) {
  const full = path.resolve(dir, String(relativePath || ''));
  return full.startsWith(path.resolve(dir) + path.sep) ? full : null;
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
        const filePath = resolveInside(targetDir, file.path);
        if (!filePath) continue;
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, file.content, 'utf8');
      }
    }
  }
  return targetDir;
}

// 整体替换：先清空旧目录，避免新版本里已删除的附属文件残留（推送/采纳/恢复版本时使用）
function replaceSkillOnDisk(folderPath, slug, content, files = []) {
  fs.rmSync(path.join(baseStorageDir, folderPath || 'inbox', slug), { recursive: true, force: true });
  return saveSkillToDisk(folderPath, slug, content, files);
}

function skillDirExists(folderPath, slug) {
  return fs.existsSync(path.join(baseStorageDir, folderPath || 'inbox', slug, 'SKILL.md'));
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

// 获取 skill 的所有文件树
function getSkillFileTree(folderPath, slug) {
  const targetDir = path.join(baseStorageDir, folderPath || 'inbox', slug);
  if (!fs.existsSync(targetDir)) return [];
  
  const results = [];
  function scan(dir, rel) {
    const list = fs.readdirSync(dir);
    for (const item of list) {
      if (item === '.git') continue;
      const fullP = path.join(dir, item);
      const relP = rel ? `${rel}/${item}` : item;
      const stat = fs.statSync(fullP);
      if (stat.isDirectory()) {
        scan(fullP, relP);
      } else {
        results.push({
          path: relP,
          name: item,
          size: stat.size,
          isScript: relP.startsWith('scripts/') || item.endsWith('.sh') || item.endsWith('.py') || item.endsWith('.js'),
          isReference: relP.startsWith('references/') || item.endsWith('.md') || item.endsWith('.json') || item.endsWith('.yaml'),
          isMain: item === 'SKILL.md'
        });
      }
    }
  }
  scan(targetDir, '');
  return results;
}

// 读取具体文件内容
function getSkillFileContent(folderPath, slug, relativePath) {
  const fullPath = resolveInside(path.join(baseStorageDir, folderPath || 'inbox', slug), relativePath);
  if (!fullPath || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    return null;
  }
  return fs.readFileSync(fullPath, 'utf8');
}

// 打包为 tar.gz 流（使用系统原生 tar，原生保留权限、极速稳定）
function createSkillTarGzArchive(folderPath, slug, res) {
  const { spawn } = require('child_process');
  const targetParent = path.join(baseStorageDir, folderPath || 'inbox');

  const tar = spawn('tar', ['-czf', '-', '-C', targetParent, slug]);
  tar.stdout.pipe(res);
  tar.stderr.on('data', (d) => console.error('tar stderr:', d.toString()));
  tar.on('error', (err) => {
    if (!res.headersSent) res.status(500).send('Tar error: ' + err.message);
  });
}

// 打包为 zip 流
function createSkillArchive(folderPath, slug, res) {
  const targetDir = path.join(baseStorageDir, folderPath || 'inbox', slug);
  const archive = archiver('zip', { zlib: { level: 9 } });
  
  archive.pipe(res);
  archive.directory(targetDir, false);
  return archive.finalize();
}

module.exports = {
  baseStorageDir,
  saveSkillToDisk,
  replaceSkillOnDisk,
  skillDirExists,
  moveSkillOnDisk,
  parseSkillContent,
  createSkillArchive,
  createSkillTarGzArchive,
  getSkillFileTree,
  getSkillFileContent
};
