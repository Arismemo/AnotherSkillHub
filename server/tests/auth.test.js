// 鉴权与多用户隔离：未登录拿不到任何数据；每个账号只能看到、改到自己的库；旧数据由管理员认领
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { startServer, registerUser, rawFetch, SAME_SITE } = require('./helpers');

const bearer = (token) => ({ authorization: `Bearer ${token}` });
const skillMd = (slug) => `---\nname: ${slug}\ndescription: ${slug} 测试时使用\n---\n\n# ${slug}\n`;

async function push(origin, token, slug) {
  const form = new FormData();
  form.append('content', skillMd(slug));
  const res = await rawFetch(`${origin}/api/agent/push`, { method: 'POST', headers: bearer(token), body: form });
  assert.equal(res.status, 201, await res.clone().text());
  return res.json();
}

test('authentication', async (t) => {
  const server = await startServer();
  const { origin } = server;
  t.after(() => server.stop());

  await t.test('anonymous requests get nothing but public pages and scripts', async () => {
    const api = await rawFetch(`${origin}/api/skills`);
    assert.equal(api.status, 401);
    assert.match((await api.json()).error, /ash login/);
    assert.equal((await rawFetch(`${origin}/s/systematic-debugging.md`)).status, 401);
    assert.equal((await rawFetch(`${origin}/s/systematic-debugging/archive.tar.gz`)).status, 401);
    assert.equal((await rawFetch(`${origin}/api/agent/revisions?slug=x`)).status, 401);

    // curl | bash 拿到的 401 也必须是合法脚本：打印原因并非零退出
    const script = await rawFetch(`${origin}/s/systematic-debugging/install.sh`);
    assert.equal(script.status, 401);
    const run = spawnSync('bash', { input: await script.text(), encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /未登录/);

    for (const url of ['/healthz', '/setup.sh', '/cli.sh', '/agent.md', '/api/auth/config']) {
      assert.equal((await rawFetch(`${origin}${url}`)).status, 200, url);
    }
    assert.deepEqual(await (await rawFetch(`${origin}/api/auth/config`)).json(), { registration: 'open' });
  });

  await t.test('register validates input; first account is admin', async () => {
    const reg = (body) => rawFetch(`${origin}/api/auth/register`, { method: 'POST', headers: SAME_SITE, body: JSON.stringify(body) });
    assert.equal((await reg({ username: 'AB', password: 'password123' })).status, 400);
    assert.equal((await reg({ username: 'bad name', password: 'password123' })).status, 400);
    assert.equal((await reg({ username: 'shortpw', password: '1234567' })).status, 400);
    assert.equal((await reg({ username: 'tester', password: 'password123' })).status, 409);
    assert.equal((await reg({ username: 'TESTER', password: 'password123' })).status, 409, 'usernames are case-insensitive');

    const me = await (await fetch(`${origin}/api/auth/me`)).json();
    assert.equal(me.user.role, 'admin');
    const second = await registerUser(origin, 'second-user');
    assert.equal(second.user.role, 'member');
  });

  await t.test('login, session cookie and logout', async () => {
    const login = (password) => rawFetch(`${origin}/api/auth/login`, { method: 'POST', headers: SAME_SITE, body: JSON.stringify({ username: 'tester', password }) });
    assert.equal((await login('wrong-password')).status, 401);
    const ok = await login('password123');
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    const sid = cookie.split(';')[0];

    assert.equal((await rawFetch(`${origin}/api/skills/stats`, { headers: { cookie: sid } })).status, 200);
    const out = await rawFetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { ...SAME_SITE, cookie: sid } });
    assert.equal(out.status, 200);
    assert.equal((await rawFetch(`${origin}/api/skills/stats`, { headers: { cookie: sid } })).status, 401, 'logged-out session is dead');
  });

  await t.test('cookie-authenticated writes need the same-site header and origin', async () => {
    const { cookie } = await registerUser(origin, 'csrf-user');
    const skill = await (await rawFetch(`${origin}/api/skills/systematic-debugging`, { headers: { cookie } })).json();
    const star = (headers) => rawFetch(`${origin}/api/skills/${skill.id}/star`, { method: 'POST', headers: { cookie, ...headers } });
    assert.equal((await star({})).status, 403, 'no header');
    assert.equal((await star({ 'x-ash-request': '1', origin: 'https://evil.example' })).status, 403, 'foreign origin');
    assert.equal((await star({ 'x-ash-request': '1', origin })).status, 200);
    assert.equal((await rawFetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403, 'login CSRF');
  });

  await t.test('tokens: managed from a web session only, revocation takes effect', async () => {
    const { cookie, token } = await registerUser(origin, 'token-user');
    assert.equal((await rawFetch(`${origin}/api/auth/tokens`, { headers: bearer(token) })).status, 403, 'a token cannot mint tokens');
    assert.equal((await rawFetch(`${origin}/api/auth/password`, { method: 'POST', headers: { ...bearer(token), ...SAME_SITE }, body: '{}' })).status, 403);

    const created = await (await rawFetch(`${origin}/api/auth/tokens`, { method: 'POST', headers: { ...SAME_SITE, cookie }, body: JSON.stringify({ name: 'laptop' }) })).json();
    assert.match(created.token, /^ash_/);
    const list = await (await rawFetch(`${origin}/api/auth/tokens`, { headers: { cookie } })).json();
    assert.ok(list.some((row) => row.id === created.id && row.name === 'laptop' && !('token' in row) && !('token_hash' in row)));
    assert.equal((await rawFetch(`${origin}/api/skills/stats`, { headers: bearer(created.token) })).status, 200);

    assert.equal((await rawFetch(`${origin}/api/auth/tokens/${created.id}`, { method: 'DELETE', headers: { ...SAME_SITE, cookie } })).status, 200);
    assert.equal((await rawFetch(`${origin}/api/skills/stats`, { headers: bearer(created.token) })).status, 401);
  });

  await t.test('changing the password signs out other sessions', async () => {
    const a = await registerUser(origin, 'pw-user');
    const other = (await rawFetch(`${origin}/api/auth/login`, { method: 'POST', headers: SAME_SITE, body: JSON.stringify({ username: 'pw-user', password: 'password123' }) }))
      .headers.get('set-cookie').split(';')[0];
    const change = (body) => rawFetch(`${origin}/api/auth/password`, { method: 'POST', headers: { ...SAME_SITE, cookie: a.cookie }, body: JSON.stringify(body) });
    assert.equal((await change({ current_password: 'nope', new_password: 'new-password-1' })).status, 400);
    assert.equal((await change({ current_password: 'password123', new_password: 'new-password-1' })).status, 200);
    assert.equal((await rawFetch(`${origin}/api/auth/me`, { headers: { cookie: a.cookie } })).status, 200, 'current session kept');
    assert.equal((await rawFetch(`${origin}/api/auth/me`, { headers: { cookie: other } })).status, 401, 'other session dropped');
  });

  await t.test('ash login / whoami / logout', async () => {
    const work = fs.mkdtempSync(path.join(server.root, 'cli-'));
    const cli = path.join(work, 'cli.sh');
    fs.writeFileSync(cli, await (await rawFetch(`${origin}/cli.sh`)).text());
    const env = { ...process.env, HOME: work };
    delete env.ASH_TOKEN;
    const ash = (...args) => spawnSync('bash', [cli, ...args], { env, encoding: 'utf8' });

    const anon = ash('list');
    assert.notEqual(anon.status, 0);
    assert.match(anon.stderr, /ash login/);
    assert.notEqual(ash('login', '--token', 'ash_bogus').status, 0, 'invalid token is not saved');
    assert.ok(!fs.existsSync(path.join(work, '.ash', 'token')));

    const login = ash('login', '--token', server.token);
    assert.equal(login.status, 0, login.stderr);
    assert.match(login.stdout, /已登录为 tester/);
    assert.equal((fs.statSync(path.join(work, '.ash', 'token')).mode & 0o777), 0o600);
    assert.match(ash('whoami').stdout, /^tester @ /);
    assert.equal(ash('list').status, 0);
    assert.equal(ash('logout').status, 0);
    assert.notEqual(ash('whoami').status, 0);
  });

  await t.test('a disabled account answers exactly like a wrong password', async () => {
    await registerUser(origin, 'offboarded');
    const Database = require('better-sqlite3');
    const db = new Database(path.join(server.env.DATA_DIR, 'another-skillhub.db'));
    db.prepare("UPDATE users SET disabled = 1 WHERE username = 'offboarded'").run();
    db.close();
    const attempt = async (password) => {
      const res = await rawFetch(`${origin}/api/auth/login`, { method: 'POST', headers: SAME_SITE, body: JSON.stringify({ username: 'offboarded', password }) });
      return [res.status, (await res.json()).error];
    };
    assert.deepEqual(await attempt('password123'), await attempt('wrong-password'), 'no oracle for the right password');
  });

  await t.test('impossible usernames are rejected without touching the limiter', async () => {
    const res = await rawFetch(`${origin}/api/auth/login`, { method: 'POST', headers: SAME_SITE, body: JSON.stringify({ username: 'x'.repeat(100_000), password: 'whatever1' }) });
    assert.equal(res.status, 401);
  });

  await t.test('sessions per account are capped and expired ones are swept', async () => {
    const { MAX_SESSIONS_PER_USER } = require('../auth');
    await registerUser(origin, 'many-logins');
    for (let i = 0; i < MAX_SESSIONS_PER_USER + 5; i += 1) {
      await rawFetch(`${origin}/api/auth/login`, { method: 'POST', headers: SAME_SITE, body: JSON.stringify({ username: 'many-logins', password: 'password123' }) });
    }
    const Database = require('better-sqlite3');
    const db = new Database(path.join(server.env.DATA_DIR, 'another-skillhub.db'));
    const count = () => db.prepare("SELECT COUNT(*) AS n FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE u.username = 'many-logins'").get().n;
    assert.equal(count(), MAX_SESSIONS_PER_USER);
    db.prepare("UPDATE auth_sessions SET expires_at = 0 WHERE user_id = (SELECT id FROM users WHERE username = 'many-logins')").run();
    db.close();
    await rawFetch(`${origin}/api/auth/login`, { method: 'POST', headers: SAME_SITE, body: JSON.stringify({ username: 'tester', password: 'password123' }) });
    const db2 = new Database(path.join(server.env.DATA_DIR, 'another-skillhub.db'));
    assert.equal(db2.prepare("SELECT COUNT(*) AS n FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE u.username = 'many-logins'").get().n, 0);
    db2.close();
  });

  await t.test('failed logins are rate limited', async () => {
    await registerUser(origin, 'victim');
    const attempt = (password) => rawFetch(`${origin}/api/auth/login`, { method: 'POST', headers: SAME_SITE, body: JSON.stringify({ username: 'victim', password }) });
    for (let i = 0; i < 10; i += 1) assert.equal((await attempt('wrong-password')).status, 401);
    assert.equal((await attempt('wrong-password')).status, 429);
    assert.equal((await attempt('password123')).status, 429, 'locked even with the right password');
  });
});

test('libraries are private to each account', async (t) => {
  const server = await startServer();
  const { origin } = server;
  t.after(() => server.stop());
  const alice = await registerUser(origin, 'alice');
  const bob = await registerUser(origin, 'bob');
  const as = (who) => (url, init = {}) => rawFetch(`${origin}${url}`, { ...init, headers: { ...bearer(who.token), ...(init.headers || {}) } });
  const A = as(alice);
  const B = as(bob);

  await push(origin, alice.token, 'alice-secret');
  const aliceSkill = await (await A('/api/skills/alice-secret')).json();

  await t.test('same slug in two libraries does not collide', async () => {
    const res = await push(origin, bob.token, 'alice-secret');
    assert.equal(res.action, 'created');
    const bobs = await (await B('/api/skills/alice-secret')).json();
    assert.notEqual(bobs.id, aliceSkill.id);
    await B(`/api/skills/${bobs.id}`, { method: 'DELETE' });
  });

  await t.test('another account cannot read it by any route', async () => {
    assert.equal((await B(`/api/skills/${aliceSkill.id}`)).status, 404);
    assert.equal((await B(`/api/skills/${aliceSkill.id}/versions`)).status, 404);
    assert.equal((await B(`/api/skills/${aliceSkill.id}/file?path=SKILL.md`)).status, 404);
    assert.equal((await B('/s/alice-secret.md')).status, 404);
    assert.equal((await B('/s/alice-secret/info')).status, 404);
    assert.equal((await B('/s/alice-secret/archive.tar.gz')).status, 404);
    assert.equal((await B('/s/alice-secret/files/SKILL.md')).status, 404);
    assert.match(await (await B('/api/agent/revisions?slug=alice-secret')).text(), /\tmissing\t/);
    const list = await (await B('/api/skills?folder=all&search=alice')).json();
    assert.equal(list.length, 0);
    const graph = await (await B('/api/skills/graph')).json();
    assert.ok(!graph.nodes.some((n) => n.id === aliceSkill.id));
  });

  await t.test('another account cannot change it', async () => {
    const json = { 'content-type': 'application/json' };
    assert.equal((await B(`/api/skills/${aliceSkill.id}`, { method: 'PUT', headers: json, body: JSON.stringify({ content: 'hijack' }) })).status, 404);
    assert.equal((await B(`/api/skills/${aliceSkill.id}/trash`, { method: 'POST' })).status, 404);
    assert.equal((await B(`/api/skills/${aliceSkill.id}`, { method: 'DELETE' })).status, 404);
    assert.equal((await B(`/api/skills/${aliceSkill.id}/approve`, { method: 'POST' })).status, 404);
    assert.equal((await B(`/api/skills/${aliceSkill.id}/move`, { method: 'POST', headers: json, body: JSON.stringify({ target_folder: 'x' }) })).status, 404);
    const withdraw = await B('/api/agent/withdraw', { method: 'POST', headers: json, body: JSON.stringify({ slug: 'alice-secret', terminal: 'Agent-CLI' }) });
    assert.equal(withdraw.status, 404);
    const still = await (await A('/api/skills/alice-secret')).json();
    assert.equal(still.is_deleted, 0);
    assert.match(still.content, /alice-secret/);
  });

  await t.test('bundles, folders and session state are per account', async () => {
    const json = { 'content-type': 'application/json' };
    const bundle = await (await A('/api/bundles', { method: 'POST', headers: json, body: JSON.stringify({ name: 'alice-kit' }) })).json();
    assert.equal((await A(`/api/bundles/${bundle.id}/skills`, { method: 'POST', headers: json, body: JSON.stringify({ skill_id: aliceSkill.id }) })).status, 200);
    assert.equal((await B(`/api/bundles/${bundle.id}`)).status, 404);
    assert.equal((await B('/api/bundles/alice-kit')).status, 404);
    assert.match(await (await B('/s/bundle/alice-kit/install.sh')).text(), /不存在/);
    assert.equal((await B(`/api/bundles/${bundle.id}`, { method: 'DELETE' })).status, 404);
    // bob 的组合里也不能挂上 alice 的技能
    const bobBundle = await (await B('/api/bundles', { method: 'POST', headers: json, body: JSON.stringify({ name: 'bob-kit' }) })).json();
    assert.equal((await B(`/api/bundles/${bobBundle.id}/skills`, { method: 'POST', headers: json, body: JSON.stringify({ skill_id: aliceSkill.id }) })).status, 404);

    await A('/api/folders', { method: 'POST', headers: json, body: JSON.stringify({ path: 'AliceOnly' }) });
    assert.ok(!(await (await B('/api/folders')).json()).some((f) => f.path === 'AliceOnly'));
    assert.equal((await A('/api/folders', { method: 'POST', headers: json, body: JSON.stringify({ path: '../escape' }) })).status, 400);
    assert.equal((await A(`/api/skills/${aliceSkill.id}/move`, { method: 'POST', headers: json, body: JSON.stringify({ target_folder: '../../x' }) })).status, 400);

    await A('/api/session', { method: 'PUT', headers: json, body: JSON.stringify({ selected_slug: 'alice-secret', folder: 'all' }) });
    assert.equal((await (await B('/api/session')).json()).selected_slug, null);
    assert.equal((await (await A('/api/session')).json()).selected_slug, 'alice-secret');
  });

  await t.test('renaming or deleting a folder moves the skill files with it', async () => {
    const json = { 'content-type': 'application/json' };
    const form = new FormData();
    form.append('content', skillMd('filed-skill'));
    form.append('folder', 'Ops_1/Deep');
    await rawFetch(`${origin}/api/agent/push`, { method: 'POST', headers: bearer(alice.token), body: form });
    const skill = await (await A('/api/skills/filed-skill')).json();
    await A(`/api/skills/${skill.id}/approve`, { method: 'POST' });
    // 名字里带 _ 的兄弟目录不能被 LIKE 通配误伤
    await A('/api/folders', { method: 'POST', headers: json, body: JSON.stringify({ path: 'OpsX1' }) });

    assert.equal((await A('/api/folders', { method: 'PUT', headers: json, body: JSON.stringify({ old_path: 'Ops_1', new_path: 'Platform' }) })).status, 200);
    const renamed = await (await A('/api/skills/filed-skill')).json();
    assert.equal(renamed.folder_path, 'Platform/Deep');
    assert.ok(renamed.file_tree.some((f) => f.path === 'SKILL.md'), 'file tree still resolves');
    assert.equal((await A('/s/filed-skill/archive.tar.gz')).status, 200);

    assert.equal((await A('/api/folders?path=Platform', { method: 'DELETE' })).status, 200);
    const inboxed = await (await A('/api/skills/filed-skill')).json();
    assert.equal(inboxed.folder_path, 'inbox');
    assert.match(await (await A('/s/filed-skill/files/SKILL.md')).text(), /filed-skill/);
    assert.ok(fs.existsSync(path.join(server.root, 'files', '@users', String(alice.user.id), 'inbox', 'filed-skill', 'SKILL.md')));
  });

  await t.test('files live under each account\'s own storage root', async () => {
    assert.ok(fs.existsSync(path.join(server.root, 'files', '@users', String(alice.user.id), 'inbox', 'alice-secret', 'SKILL.md')));
  });
});

test('closed registration', async (t) => {
  const server = await startServer({ ASH_REGISTRATION: 'closed' }, { user: false });
  t.after(() => server.stop());
  assert.deepEqual(await (await rawFetch(`${server.origin}/api/auth/config`)).json(), { registration: 'closed' });
  const res = await rawFetch(`${server.origin}/api/auth/register`, { method: 'POST', headers: SAME_SITE, body: JSON.stringify({ username: 'someone', password: 'password123' }) });
  assert.equal(res.status, 403);
});

// 多用户之前的库：没有 user_id 列，文件直接在 <STORAGE_DIR>/<folder>/<slug>
function writeLegacyInstance(root) {
  const Database = require('better-sqlite3');
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const db = new Database(path.join(root, 'data', 'another-skillhub.db'));
  db.exec(`
    CREATE TABLE folders (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT UNIQUE NOT NULL, name TEXT NOT NULL, parent_path TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE skills (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT DEFAULT '', folder_path TEXT DEFAULT 'inbox',
      tags TEXT DEFAULT '[]', content TEXT NOT NULL, files TEXT DEFAULT '[]', terminal_source TEXT DEFAULT 'Web', is_starred INTEGER DEFAULT 0, is_deleted INTEGER DEFAULT 0,
      version TEXT DEFAULT '1.0.0', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE bundles (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE session_state (device_key TEXT PRIMARY KEY, selected_slug TEXT, folder TEXT DEFAULT 'inbox', tag TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO folders (path, name) VALUES ('inbox', 'Inbox'), ('Ops', 'Ops');
    INSERT INTO bundles (slug, name) VALUES ('legacy-kit', 'Legacy Kit');
  `);
  db.prepare('INSERT INTO skills (slug, name, folder_path, content, files) VALUES (?, ?, ?, ?, ?)')
    .run('legacy-runbook', 'Legacy Runbook', 'Ops', skillMd('legacy-runbook'), JSON.stringify([{ path: 'scripts/run.sh', content: 'echo legacy\n' }]));
  db.close();
  const dir = path.join(root, 'files', 'Ops', 'legacy-runbook');
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd('legacy-runbook'));
  fs.writeFileSync(path.join(dir, 'scripts', 'run.sh'), 'echo legacy\n');
}

test('legacy data is migrated, hidden, then claimed by the admin', async (t) => {
  const server = await startServer({}, { user: false, prepare: writeLegacyInstance });
  const { origin } = server;
  t.after(() => server.stop());

  // 迁移后：旧数据没有主人，新注册的账号看不到
  const stranger = await registerUser(origin, 'stranger');
  const hidden = await rawFetch(`${origin}/api/skills/legacy-runbook`, { headers: bearer(stranger.token) });
  assert.equal(hidden.status, 404);

  const script = path.join(__dirname, '..', 'scripts', 'create-user.js');
  const create = (...args) => spawnSync(process.execPath, [script, ...args], { env: { ...process.env, ...server.env }, input: 'admin-password\n', encoding: 'utf8' });
  const made = create('owner', '--admin', '--claim-legacy');
  assert.equal(made.status, 0, made.stderr);
  assert.match(made.stdout, /已认领旧数据：1 个技能（搬移 1 个目录）、2 个文件夹、1 个组合/);
  assert.notEqual(create('owner').status, 0, 'existing user is not recreated');

  const login = await rawFetch(`${origin}/api/auth/cli-token`, { method: 'POST', headers: SAME_SITE, body: JSON.stringify({ username: 'owner', password: 'admin-password' }) });
  const { token, user } = await login.json();
  assert.equal(user.role, 'admin');
  const O = (url) => rawFetch(`${origin}${url}`, { headers: bearer(token) });
  const skill = await (await O('/api/skills/legacy-runbook')).json();
  assert.equal(skill.folder_path, 'Ops');
  assert.equal(await (await O('/s/legacy-runbook/files/scripts/run.sh')).text(), 'echo legacy\n');
  assert.ok((await (await O('/api/folders')).json()).some((f) => f.path === 'Ops'));
  assert.equal((await O('/api/bundles/legacy-kit')).status, 200);
  assert.ok(!fs.existsSync(path.join(server.root, 'files', 'Ops', 'legacy-runbook')), 'files moved out of the legacy location');

  // 管理员在服务器上重置密码：新密码可用，旧密码失效
  const reset = spawnSync(process.execPath, [script, 'owner', '--reset-password'], { env: { ...process.env, ...server.env }, input: 'another-password\n', encoding: 'utf8' });
  assert.equal(reset.status, 0, reset.stderr);
  const loginWith = (password) => rawFetch(`${origin}/api/auth/login`, { method: 'POST', headers: SAME_SITE, body: JSON.stringify({ username: 'owner', password }) });
  assert.equal((await loginWith('admin-password')).status, 401);
  assert.equal((await loginWith('another-password')).status, 200);
  const unknown = spawnSync(process.execPath, [script, 'nobody', '--reset-password'], { env: { ...process.env, ...server.env }, input: 'whatever-pass\n', encoding: 'utf8' });
  assert.notEqual(unknown.status, 0, 'resetting an unknown user must not create one');
  assert.match(unknown.stderr, /不存在/);

  // 已认领完：再认领一次没有东西可认领；陌生人仍然看不到
  assert.match(create('owner', '--claim-legacy').stdout, /没有待认领的旧数据/);
  assert.equal((await rawFetch(`${origin}/api/skills/legacy-runbook`, { headers: bearer(stranger.token) })).status, 404);
});
