#!/usr/bin/env node
// 在服务器上创建账号 / 认领旧数据：npm run user:create -- <username> [--admin] [--claim-legacy]
//   新账号：密码从标准输入读取（交互时不回显；也可 echo 'pw' | npm run user:create -- …）
//   --admin         创建管理员
//   --claim-legacy  把多用户之前的数据（user_id 为空的技能、文件夹、组合）归到这个账号，
//                   并把磁盘目录 <STORAGE_DIR>/<folder>/<slug> 搬到该用户的存储根目录。
//                   账号已存在时只做认领（不改密码）；与该账号已有技能/组合同名时中止并列出冲突。
//   --reset-password  已有账号：设置新密码（从标准输入读取），并注销它所有的网页会话
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const db = require('../db');
const { ensureUserDefaults } = require('../db');
const { hashPassword, validateCredentials } = require('../auth');
const { baseStorageDir, USERS_DIR, skillDir } = require('../storage');

function die(message) {
  console.error(`错误: ${message}`);
  process.exit(1);
}

async function readPassword() {
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8').split('\n')[0];
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // 交互输入时不回显密码
  rl._writeToOutput = (s) => { if (!rl.muted) rl.output.write(s); };
  const ask = (q) => new Promise((resolve) => {
    rl.muted = false;
    rl.output.write(q);
    rl.muted = true;
    rl.question('', (answer) => { rl.output.write('\n'); resolve(answer); });
  });
  const first = await ask('密码: ');
  const second = await ask('再输一次: ');
  rl.close();
  if (first !== second) die('两次输入的密码不一致');
  return first;
}

// 旧数据认领：数据库行和磁盘目录一起转移，任何一步失败都不写库
function claimLegacy(userId) {
  const skills = db.prepare('SELECT id, slug, folder_path FROM skills WHERE user_id IS NULL').all();
  const folders = db.prepare('SELECT COUNT(*) AS n FROM folders WHERE user_id IS NULL').get().n;
  const bundles = db.prepare('SELECT COUNT(*) AS n FROM bundles WHERE user_id IS NULL').get().n;
  if (!skills.length && !folders && !bundles) {
    console.log('没有待认领的旧数据');
    return;
  }
  if (skills.some((s) => (s.folder_path || 'inbox').split('/')[0] === USERS_DIR)) {
    die(`旧数据里有名为 ${USERS_DIR} 的目录，与多用户存储目录冲突，请先改名`);
  }
  const clashes = [
    ...db.prepare('SELECT l.slug FROM skills l JOIN skills m ON m.slug = l.slug AND m.user_id = ? WHERE l.user_id IS NULL').all(userId).map((x) => `技能 ${x.slug}`),
    ...db.prepare('SELECT l.slug FROM bundles l JOIN bundles m ON m.slug = l.slug AND m.user_id = ? WHERE l.user_id IS NULL').all(userId).map((x) => `组合 ${x.slug}`),
  ];
  if (clashes.length) die(`以下旧数据与该账号已有内容同名，请先在网页上改名或删除后再认领：${clashes.join('、')}`);

  // 先搬磁盘：逐个技能目录 rename，失败则把已搬的搬回去
  const moved = [];
  try {
    for (const s of skills) {
      const from = path.join(baseStorageDir, s.folder_path || 'inbox', s.slug);
      const to = skillDir(userId, s.folder_path, s.slug);
      if (!fs.existsSync(from)) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      moved.push([from, to]);
    }
  } catch (err) {
    for (const [from, to] of moved.reverse()) fs.renameSync(to, from);
    die(`搬移技能目录失败，已回滚：${err.message}`);
  }

  db.transaction(() => {
    // 文件夹只是路径名：账号里已有的同名文件夹（如 inbox）保留，丢掉旧库那一行即可
    db.prepare('DELETE FROM folders WHERE user_id IS NULL AND path IN (SELECT path FROM folders WHERE user_id = ?)').run(userId);
    db.prepare('UPDATE skills SET user_id = ? WHERE user_id IS NULL').run(userId);
    db.prepare('UPDATE folders SET user_id = ? WHERE user_id IS NULL').run(userId);
    db.prepare('UPDATE bundles SET user_id = ? WHERE user_id IS NULL').run(userId);
  })();
  console.log(`✅ 已认领旧数据：${skills.length} 个技能（搬移 ${moved.length} 个目录）、${folders} 个文件夹、${bundles} 个组合`);
}

async function main() {
  const args = process.argv.slice(2);
  const username = (args.find((a) => !a.startsWith('--')) || '').trim().toLowerCase();
  const admin = args.includes('--admin');
  const claim = args.includes('--claim-legacy');
  if (!username) die('用法: npm run user:create -- <username> [--admin] [--claim-legacy | --reset-password]');
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (args.includes('--reset-password')) {
    if (!existing) die(`用户 ${username} 不存在`);
    const password = await readPassword();
    const invalid = validateCredentials(username, password);
    if (invalid) die(invalid);
    const passwordHash = await hashPassword(password);
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, existing.id);
      db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(existing.id);
    })();
    console.log(`✅ 已重置 ${username} 的密码，并注销了它所有的网页登录`);
    return;
  }
  if (existing) {
    if (!claim) die(`用户 ${username} 已存在（重置密码加 --reset-password）`);
    claimLegacy(existing.id);
    ensureUserDefaults(existing.id);
    return;
  }

  const password = await readPassword();
  const invalid = validateCredentials(username, password);
  if (invalid) die(invalid);

  const passwordHash = await hashPassword(password);
  const r = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, passwordHash, admin ? 'admin' : 'member');
  const userId = Number(r.lastInsertRowid);
  console.log(`✅ 已创建${admin ? '管理员' : '用户'} ${username}（id ${userId}）`);
  if (claim) claimLegacy(userId);
  ensureUserDefaults(userId);
}

main().catch((err) => die(err.message));
