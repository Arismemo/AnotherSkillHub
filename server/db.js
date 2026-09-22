const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'skillhub.db');
const db = new Database(dbPath);

// 开启 WAL 模式提升并发性能
db.pragma('journal_mode = WAL');

// 初始化表结构
db.exec(`
  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,       -- 例如 'ADL4', 'ADL4/Planning'
    name TEXT NOT NULL,              -- 文件夹显示名称
    parent_path TEXT DEFAULT '',      -- 父级路径
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,       -- 唯一代号，如 'voyager-worldsim'
    name TEXT NOT NULL,              -- 显示名称
    description TEXT DEFAULT '',     -- 描述
    folder_path TEXT DEFAULT 'inbox',-- 所属文件夹，默认 inbox
    tags TEXT DEFAULT '[]',          -- JSON array
    content TEXT NOT NULL,           -- Markdown 内容
    files TEXT DEFAULT '[]',         -- 附件/关联脚本文件 JSON array
    terminal_source TEXT DEFAULT 'Web', -- 来源终端：Mac-Hermes, ThinkPad, Web 等
    is_starred INTEGER DEFAULT 0,    -- 0 或 1
    is_deleted INTEGER DEFAULT 0,    -- 软删除：0 或 1
    version TEXT DEFAULT '1.0.0',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_skills_folder ON skills(folder_path);
  CREATE INDEX IF NOT EXISTS idx_skills_deleted ON skills(is_deleted);
  CREATE INDEX IF NOT EXISTS idx_skills_starred ON skills(is_starred);
`);

// 确保内置系统目录
const ensureFolder = db.prepare(`
  INSERT OR IGNORE INTO folders (path, name, parent_path) VALUES (?, ?, ?)
`);
ensureFolder.run('inbox', '收件箱 (Inbox)', '');

module.exports = db;
