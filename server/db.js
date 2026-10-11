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

// 老库（多用户之前）的内置 inbox；多用户迁移之后每个用户各有自己的 inbox，见 ensureUserDefaults
if (db.pragma('user_version', { simple: true }) < 1) {
  db.prepare('INSERT OR IGNORE INTO folders (path, name, parent_path) VALUES (?, ?, ?)').run('inbox', '收件箱 (Inbox)', '');
}

// 轻量迁移：老库补列
try {
  const cols = db.prepare('PRAGMA table_info(skill_versions)').all().map((c) => c.name);
  if (!cols.includes('label')) db.exec('ALTER TABLE skill_versions ADD COLUMN label TEXT DEFAULT NULL');
  // 快照对应的版本号：固定版本的引用（slug@1.2.0）据此从历史里取出那一版来安装
  if (!cols.includes('version')) {
    db.exec('ALTER TABLE skill_versions ADD COLUMN version TEXT DEFAULT NULL');
    const matter = require('gray-matter');
    const update = db.prepare('UPDATE skill_versions SET version = ? WHERE id = ?');
    for (const row of db.prepare('SELECT id, content FROM skill_versions').all()) {
      let version = null;
      try { version = matter(row.content || '', {}).data.version; } catch { /* 坏掉的 frontmatter 没有版本号 */ }
      if (version !== undefined && version !== null && String(version).trim()) update.run(String(version).trim(), row.id);
    }
  }
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

// ——— v1：多用户 ———
// skills / folders / bundles 加 user_id，唯一约束改为按用户：SQLite 不能 ALTER 掉 UNIQUE，只能重建表。
// 迁移前的数据 user_id 为 NULL，任何用户都看不到，直到管理员用 `npm run user:create -- <名字> --admin` 认领。
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',  -- admin | member
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS auth_sessions (
    id_hash TEXT PRIMARY KEY,             -- sha256(cookie 中的会话 id)
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,          -- 毫秒时间戳
    user_agent TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

  CREATE TABLE IF NOT EXISTS api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT 'token',
    token_hash TEXT UNIQUE NOT NULL,      -- sha256(明文 token)
    prefix TEXT NOT NULL,                 -- 明文前 10 位，列表里用来辨认
    last_used_at DATETIME,
    revoked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
`);

if (db.pragma('user_version', { simple: true }) < 1) {
  const SKILL_COLS = ['id', 'slug', 'name', 'description', 'folder_path', 'tags', 'content', 'files', 'terminal_source', 'is_starred',
    'is_deleted', 'version', 'created_at', 'updated_at', 'status', 'security_warnings', 'pending_content', 'pending_files',
    'pending_meta', 'pending_at', 'last_review'];
  db.transaction(() => {
    db.exec(`
      CREATE TABLE skills_v1 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        folder_path TEXT DEFAULT 'inbox',
        tags TEXT DEFAULT '[]',
        content TEXT NOT NULL,
        files TEXT DEFAULT '[]',
        terminal_source TEXT DEFAULT 'Web',
        is_starred INTEGER DEFAULT 0,
        is_deleted INTEGER DEFAULT 0,
        version TEXT DEFAULT '1.0.0',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'approved',
        security_warnings TEXT DEFAULT '[]',
        pending_content TEXT DEFAULT NULL,
        pending_files TEXT DEFAULT NULL,
        pending_meta TEXT DEFAULT NULL,
        pending_at DATETIME DEFAULT NULL,
        last_review TEXT DEFAULT NULL,
        UNIQUE(user_id, slug)
      );
      INSERT INTO skills_v1 (${SKILL_COLS.join(', ')}) SELECT ${SKILL_COLS.join(', ')} FROM skills;
      DROP TABLE skills;
      ALTER TABLE skills_v1 RENAME TO skills;
      CREATE INDEX idx_skills_user ON skills(user_id, is_deleted);
      CREATE INDEX idx_skills_folder ON skills(user_id, folder_path);
      CREATE INDEX idx_skills_starred ON skills(is_starred);
      CREATE INDEX idx_skills_status ON skills(status);

      CREATE TABLE folders_v1 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        parent_path TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, path)
      );
      INSERT INTO folders_v1 (id, path, name, parent_path, created_at) SELECT id, path, name, parent_path, created_at FROM folders;
      DROP TABLE folders;
      ALTER TABLE folders_v1 RENAME TO folders;

      CREATE TABLE bundles_v1 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, slug)
      );
      INSERT INTO bundles_v1 (id, slug, name, description, created_at) SELECT id, slug, name, description, created_at FROM bundles;
      DROP TABLE bundles;
      ALTER TABLE bundles_v1 RENAME TO bundles;

      -- 会话状态从「设备」改为「用户」维度：旧的按设备记录无法对应到用户，直接丢弃
      DROP TABLE session_state;
      CREATE TABLE session_state (
        user_id INTEGER PRIMARY KEY,
        selected_slug TEXT,
        folder TEXT DEFAULT 'inbox',
        tag TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.pragma('user_version = 1');
  })();
}

// ——— 使用记录：安装、阅读、Agent 反馈 ———
// actor_id 是触发者（token / 会话所属用户）。个人库里就是技能主人；以后团队库、技能广场里会是别人。
// revision 是事件发生时对应的修订号（反馈为本机已装版本），技能更新后旧版本的失败不再算在当前版本头上。
// 建在 v1 迁移之后：迁移会重建 skills 表，外键不能先指向旧表。
db.exec(`
  CREATE TABLE IF NOT EXISTS skill_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id INTEGER NOT NULL,
    actor_id INTEGER,
    kind TEXT NOT NULL,              -- install | dependency | update | view | feedback
    outcome TEXT,                    -- feedback: ok | fail
    note TEXT,
    terminal TEXT,
    revision TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_skill_events_skill ON skill_events(skill_id, created_at);

  -- 可选语义层的向量缓存（见 embeddings.js）：text_hash = 模型 + 技能意图文本的哈希，文本没变就不重算
  CREATE TABLE IF NOT EXISTS skill_embeddings (
    skill_id INTEGER PRIMARY KEY,
    text_hash TEXT NOT NULL,
    vector BLOB NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
  );

  -- 改名 / 合并留下的去向：旧标识符 → 新标识符。已装旧名的机器靠它找到新技能（ash migrate、ash installed），
  -- 按旧名拉取也会落到新技能上。旧名重新被一个技能占用时，以那个技能为准
  CREATE TABLE IF NOT EXISTS skill_redirects (
    user_id INTEGER NOT NULL,
    old_slug TEXT NOT NULL,
    new_slug TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, old_slug)
  );

  CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT);
  -- 开始记录使用的时间：在此之前没有数据，「从未使用 / 长期未用」只能从这里起算
  INSERT OR IGNORE INTO app_meta (key, value) VALUES ('usage_tracking_since', strftime('%Y-%m-%d %H:%M:%S', 'now'));
`);

// ——— 分享链接 ———
// 第一版把分享做成 skills 表上的几列（一技能一链接、token 只存哈希、链接事后取不回），已整体推翻：清掉旧列，旧链接全部失效
try {
  const cols = db.prepare('PRAGMA table_info(skills)').all().map((c) => c.name);
  if (cols.includes('share_token_hash')) {
    db.exec('DROP INDEX IF EXISTS idx_skills_share');
    for (const col of ['share_mode', 'share_token_hash', 'share_password_hash', 'share_expires_at', 'share_created_at']) {
      if (cols.includes(col)) db.exec(`ALTER TABLE skills DROP COLUMN ${col}`);
    }
  }
} catch (e) { console.error('migration:', e.message); }

// 一个技能可以有多条分享链接（发给不同的人、不同期限），各自停用。
// token 明文保存：链接本来就是要交出去的，主人随时能再复制；它只能读到这一份内容，而内容本身就在同一个库里，存哈希挡不住什么。
// follow_latest=0 时 slug…files 是创建时冻结的快照；=1 时这些列为空，访问时读技能的当前已发布内容。
// 时间戳（expires_at / last_accessed_at）是毫秒，与 auth_sessions 一致
db.exec(`
  CREATE TABLE IF NOT EXISTS skill_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    skill_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL DEFAULT '',
    follow_latest INTEGER NOT NULL DEFAULT 0,
    slug TEXT,
    name TEXT,
    description TEXT,
    tags TEXT,
    version TEXT,
    content TEXT,
    files TEXT,
    password_hash TEXT,
    expires_at INTEGER,
    view_count INTEGER NOT NULL DEFAULT 0,
    download_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_skill_shares_skill ON skill_shares(skill_id);
  CREATE INDEX IF NOT EXISTS idx_skill_shares_user ON skill_shares(user_id, created_at);
`);

// 新用户（注册或认领时）的内置目录
function ensureUserDefaults(userId) {
  db.prepare('INSERT OR IGNORE INTO folders (user_id, path, name, parent_path) VALUES (?, ?, ?, ?)').run(userId, 'inbox', '收件箱 (Inbox)', '');
}

module.exports = db;
module.exports.ensureUserDefaults = ensureUserDefaults;
