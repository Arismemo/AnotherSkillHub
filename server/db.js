const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = process.env.DATA_DIR || path.join(__dirname, '../data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'another-skillhub.db');
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

  CREATE TABLE IF NOT EXISTS skill_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id INTEGER NOT NULL,
    content TEXT NOT NULL,            -- 快照时的 SKILL.md 全文
    files TEXT DEFAULT '[]',          -- 快照时的附件 JSON array
    name TEXT DEFAULT '',
    description TEXT DEFAULT '',
    source TEXT DEFAULT 'web',        -- web | agent | restore
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_skill_versions_skill ON skill_versions(skill_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS bundles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bundle_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bundle_id INTEGER NOT NULL,
    skill_id INTEGER NOT NULL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(bundle_id, skill_id),
    FOREIGN KEY (bundle_id) REFERENCES bundles(id) ON DELETE CASCADE,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
  );



  CREATE TABLE IF NOT EXISTS session_state (
    device_key TEXT PRIMARY KEY,
    selected_slug TEXT,
    folder TEXT DEFAULT 'inbox',
    tag TEXT,
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

// 轻量迁移：老库补列
try {
  const cols = db.prepare('PRAGMA table_info(skill_versions)').all().map((c) => c.name);
  if (!cols.includes('label')) db.exec('ALTER TABLE skill_versions ADD COLUMN label TEXT DEFAULT NULL');
} catch (e) { console.error('migration:', e.message); }

// 审核流：status=pending 的技能只对人可见，Agent 默认拉不到；
// pending_* 存放 Agent 对已发布技能提交、尚未采纳的更新（采纳前磁盘上仍是已发布版本）。
try {
  const cols = db.prepare('PRAGMA table_info(skills)').all().map((c) => c.name);
  const add = (name, ddl) => { if (!cols.includes(name)) db.exec(`ALTER TABLE skills ADD COLUMN ${ddl}`); };
  add('status', "status TEXT DEFAULT 'approved'");
  add('security_warnings', "security_warnings TEXT DEFAULT '[]'");
  add('pending_content', 'pending_content TEXT DEFAULT NULL');
  add('pending_files', 'pending_files TEXT DEFAULT NULL');
  add('pending_meta', 'pending_meta TEXT DEFAULT NULL');
  add('pending_at', 'pending_at DATETIME DEFAULT NULL');
  // 最近一次审核结果 {action: approved|rejected, kind: new|update, at, source}：供 Agent 用 ash mine 跟进
  add('last_review', 'last_review TEXT DEFAULT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_skills_status ON skills(status)');
} catch (e) { console.error('migration:', e.message); }

module.exports = db;
