const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const archiver = require('archiver'); // v8 起没有 archiver('zip') 工厂函数，用 new archiver.ZipArchive()

const baseStorageDir = process.env.STORAGE_DIR || path.join(__dirname, '../data/skills_files');
if (!fs.existsSync(baseStorageDir)) {
  fs.mkdirSync(baseStorageDir, { recursive: true });
}

// 技能目录内的相对路径 → 绝对路径；越界（../、绝对路径）返回 null
function resolveInside(dir, relativePath) {
  const full = path.resolve(dir, String(relativePath || ''));
  return full.startsWith(path.resolve(dir) + path.sep) ? full : null;
}

// 每个用户一个存储根：<STORAGE_DIR>/@users/<id>/<folder>/<slug>。
// 多用户之前的数据直接在 <STORAGE_DIR>/<folder>/<slug>，由管理员认领时搬进自己的根目录（见 scripts/create-user.js）。
const USERS_DIR = '@users';

function userRoot(userId) {
  if (!Number.isInteger(Number(userId)) || Number(userId) <= 0) throw new Error(`invalid user id: ${userId}`);
  return path.join(baseStorageDir, USERS_DIR, String(Number(userId)));
}

// 目录路径只允许普通的相对段：拒绝空段、. 与 ..、反斜杠，返回规范化后的路径或 null
function cleanFolderPath(folderPath) {
  const clean = String(folderPath ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!clean || clean.includes('\\') || clean.includes('\0')) return null;
  const segments = clean.split('/');
  if (segments.some((s) => !s.trim() || s === '.' || s === '..')) return null;
  return clean;
}

// 技能目录的绝对路径；任何越出用户根目录的组合都直接抛错（纵深防御，路由层已校验过）
function skillDir(userId, folderPath, slug) {
  const root = userRoot(userId);
  const dir = resolveInside(root, path.join(folderPath || 'inbox', String(slug)));
  if (!dir || !slug || String(slug).includes('/')) throw new Error('非法的技能路径');
  return dir;
}

// 保存 skill 到文件系统
function saveSkillToDisk(userId, folderPath, slug, content, files = []) {
  const targetDir = skillDir(userId, folderPath, slug);
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
function replaceSkillOnDisk(userId, folderPath, slug, content, files = []) {
  fs.rmSync(skillDir(userId, folderPath, slug), { recursive: true, force: true });
  return saveSkillToDisk(userId, folderPath, slug, content, files);
}

function removeSkillFromDisk(userId, folderPath, slug) {
  fs.rmSync(skillDir(userId, folderPath, slug), { recursive: true, force: true });
}

function skillDirExists(userId, folderPath, slug) {
  return fs.existsSync(path.join(skillDir(userId, folderPath, slug), 'SKILL.md'));
}

// 移动文件系统上的 skill
function moveSkillOnDisk(userId, oldFolder, newFolder, slug) {
  const oldDir = skillDir(userId, oldFolder, slug);
  const newDir = skillDir(userId, newFolder, slug);
  if (fs.existsSync(oldDir)) {
    fs.mkdirSync(path.dirname(newDir), { recursive: true });
    fs.renameSync(oldDir, newDir);
  }
}

// 解析 Markdown Frontmatter
function parseSkillContent(rawContent) {
  try {
    const parsed = matter(rawContent, {});  // options 对象绕过 gray-matter 的内置缓存（见 skillMeta.parseFrontmatter）
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
function getSkillFileTree(userId, folderPath, slug) {
  const targetDir = skillDir(userId, folderPath, slug);
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
function getSkillFileContent(userId, folderPath, slug, relativePath) {
  const fullPath = resolveInside(skillDir(userId, folderPath, slug), relativePath);
  if (!fullPath || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    return null;
  }
  return fs.readFileSync(fullPath, 'utf8');
}

// 打包为 tar.gz 流（使用系统原生 tar，原生保留权限、极速稳定）
function createSkillTarGzArchive(userId, folderPath, slug, res) {
  const { spawn } = require('child_process');
  const targetParent = path.dirname(skillDir(userId, folderPath, slug));

  const tar = spawn('tar', ['-czf', '-', '-C', targetParent, slug]);
  tar.stdout.pipe(res);
  tar.stderr.on('data', (d) => console.error('tar stderr:', d.toString()));
  tar.on('error', (err) => {
    if (!res.headersSent) res.status(500).send('Tar error: ' + err.message);
  });
}

// 把一份不在磁盘上的内容（例如历史版本）打包成与 createSkillTarGzArchive 相同布局的 tar.gz：<slug>/SKILL.md + 附属文件
function createTarGzFromContent(slug, content, files, res) {
  const os = require('os');
  const { spawn } = require('child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-pinned-'));
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  try {
    const dir = resolveInside(tmp, String(slug));
    if (!dir || String(slug).includes('/')) throw new Error('非法的技能路径');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf8');
    for (const file of Array.isArray(files) ? files : []) {
      const filePath = file && file.path && file.content !== undefined ? resolveInside(dir, file.path) : null;
      if (!filePath) continue;
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, file.content, 'utf8');
    }
  } catch (err) {
    cleanup();
    throw err;
  }
  const tar = spawn('tar', ['-czf', '-', '-C', tmp, String(slug)]);
  tar.stdout.pipe(res);
  tar.stderr.on('data', (d) => console.error('tar stderr:', d.toString()));
  tar.on('close', cleanup);
  tar.on('error', (err) => {
    cleanup();
    if (!res.headersSent) res.status(500).send('Tar error: ' + err.message);
  });
}

// 不在磁盘上的内容（分享快照）打包成 zip：顶层带 <slug>/ 目录，解压即得技能文件夹
function createZipFromContent(slug, content, files, res) {
  const name = String(slug);
  if (!name || name.includes('/') || name === '.' || name === '..') throw new Error('非法的技能路径');
  const archive = new archiver.ZipArchive({ zlib: { level: 9 } });
  archive.on('error', (err) => { if (!res.headersSent) res.status(500).send('Zip error: ' + err.message); });
  archive.pipe(res);
  archive.append(String(content ?? ''), { name: `${name}/SKILL.md` });
  for (const file of Array.isArray(files) ? files : []) {
    const rel = file && file.path && file.content !== undefined ? path.posix.normalize(String(file.path)) : null;
    if (!rel || rel.startsWith('../') || rel === '..' || path.posix.isAbsolute(rel) || rel === 'SKILL.md') continue;
    archive.append(String(file.content), { name: `${name}/${rel}` });
  }
  return archive.finalize();
}

// 打包为 zip 流
function createSkillArchive(userId, folderPath, slug, res) {
  const targetDir = skillDir(userId, folderPath, slug);
  const archive = new archiver.ZipArchive({ zlib: { level: 9 } });
  
  archive.pipe(res);
  archive.directory(targetDir, false);
  return archive.finalize();
}

module.exports = {
  baseStorageDir,
  USERS_DIR,
  userRoot,
  cleanFolderPath,
  skillDir,
  removeSkillFromDisk,
  saveSkillToDisk,
  replaceSkillOnDisk,
  skillDirExists,
  moveSkillOnDisk,
  parseSkillContent,
  createSkillArchive,
  createZipFromContent,
  createSkillTarGzArchive,
  createTarGzFromContent,
  getSkillFileTree,
  getSkillFileContent
};
