// 分享链接：主人管理、免登录访问、快照与跟随最新、密码与访问凭据、过期与停用、存到别人的库
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { startServer, registerUser, rawFetch, SAME_SITE } = require('./helpers');

const skillMd = (slug, body = 'v1 正文') => `---\nname: ${slug}\ndescription: ${slug} 测试时使用\n---\n\n# ${slug}\n\n${body}\n`;
const bearer = (token) => ({ ...SAME_SITE, authorization: `Bearer ${token}` });

test('skill shares', async (t) => {
  const server = await startServer();
  const { origin } = server;
  t.after(() => server.stop());

  const api = async (method, url, body) => {
    const res = await fetch(`${origin}${url}`, { method, headers: SAME_SITE, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 文本响应 */ }
    return { status: res.status, json, text };
  };
  const createSkill = async (slug, files = []) => {
    const r = await api('POST', '/api/skills', { content: skillMd(slug), files });
    assert.equal(r.status, 201, r.text);
    return r.json.id;
  };
  const share = async (body) => {
    const r = await api('POST', '/api/shares', body);
    assert.equal(r.status, 201, r.text);
    return r.json.share;
  };
  const anon = (url, init) => rawFetch(`${origin}${url}`, init);

  const skillId = await createSkill('shared-skill', [{ path: 'scripts/run.sh', content: 'echo hi\n' }, { path: 'references/notes.md', content: '# 笔记\n' }]);

  await t.test('management needs login; anonymous gets 401', async () => {
    assert.equal((await anon('/api/shares')).status, 401);
    assert.equal((await anon('/api/shares', { method: 'POST', headers: SAME_SITE, body: JSON.stringify({ skill: skillId }) })).status, 401);
  });

  await t.test('snapshot freezes content; follow_latest tracks published edits', async () => {
    const snap = await share({ skill: skillId, label: '给 bob', expires: '7d' });
    const live = await share({ skill: 'shared-skill', follow_latest: true });
    assert.equal(snap.label, '给 bob');
    assert.equal(snap.follow_latest, false);
    assert.equal(live.follow_latest, true);
    assert.match(snap.url, /\/share\/[A-Za-z0-9_-]{22}$/);
    assert.ok(snap.expires_at > Date.now() + 6 * 86400_000);

    const upd = await api('PUT', `/api/skills/${skillId}`, { content: skillMd('shared-skill', 'v2 正文') });
    assert.equal(upd.status, 200, upd.text);

    const snapView = await (await anon(`/api/share/${snap.token}`)).json();
    const liveView = await (await anon(`/api/share/${live.token}`)).json();
    assert.match(snapView.content, /v1 正文/);
    assert.match(liveView.content, /v2 正文/);
    assert.deepEqual(snapView.files.map((f) => f.path).sort(), ['references/notes.md', 'scripts/run.sh']);
    assert.equal(snapView.owner, 'tester');
    assert.equal(snapView.viewer, null, 'anonymous viewer');
    assert.match(snapView.install.curl, /^curl -fsSL '.*\/share\/.*\/install\.sh' \| bash$/);
    assert.equal(snapView.install.ash, `ash pull ${snap.url}`);

    // 详情页带上有效链接数
    const detail = await api('GET', `/api/skills/${skillId}`);
    assert.equal(detail.json.share_count, 2);
  });

  await t.test('curl / agents get Markdown with file links; files and archives come from the shared copy', async () => {
    const s = await share({ skill: skillId });
    const md = await anon(`/share/${s.token}`);
    assert.equal(md.status, 200);
    assert.match(md.headers.get('content-type'), /markdown/);
    const text = await md.text();
    assert.match(text, /v2 正文/);
    assert.match(text, /scripts\/run\.sh/);
    assert.match(text, /ash pull /);
    assert.equal(await (await anon(`/share/${s.token}?raw=1`)).text(), skillMd('shared-skill', 'v2 正文'));

    assert.equal(await (await anon(`/share/${s.token}/files/scripts/run.sh`)).text(), 'echo hi\n');
    assert.equal((await anon(`/share/${s.token}/files/..%2F..%2Fetc%2Fpasswd`)).status, 404);
    const file = await (await anon(`/api/share/${s.token}/file?path=references/notes.md`)).json();
    assert.equal(file.content, '# 笔记\n');
    assert.equal((await anon(`/api/share/${s.token}/file?path=../../x`)).status, 404);

    const zip = await anon(`/share/${s.token}/download`);
    assert.equal(zip.status, 200);
    assert.match(zip.headers.get('content-disposition'), /shared-skill\.zip/);
    assert.equal(Buffer.from(await zip.arrayBuffer()).subarray(0, 2).toString(), 'PK');
    const tar = await anon(`/share/${s.token}/archive.tar.gz`);
    assert.equal(tar.status, 200);
    assert.ok((await tar.arrayBuffer()).byteLength > 0);

    const [row] = (await api('GET', `/api/shares?skill=${skillId}`)).json.shares.filter((x) => x.id === s.id);
    assert.equal(row.view_count, 2);
    assert.equal(row.download_count, 2);
    assert.ok(row.last_accessed_at);
  });

  await t.test('install script from a share works without any personal token', async () => {
    const s = await share({ skill: skillId });
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ash-share-home-'));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const script = await (await anon(`/share/${s.token}/install.sh`)).text();
    const env = { ...process.env, HOME: home, ASH_TERMINAL: 'test-box' };
    delete env.ASH_TOKEN;
    const run = spawnSync('bash', { input: script, encoding: 'utf8', env });
    assert.equal(run.status, 0, run.stderr);
    const dir = path.join(home, '.ash', 'skills', 'shared-skill');
    assert.match(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), /v2 正文/);
    assert.equal(fs.readFileSync(path.join(dir, 'scripts', 'run.sh'), 'utf8'), 'echo hi\n');
    assert.match(fs.readFileSync(path.join(dir, '.ash'), 'utf8'), new RegExp(`share=${s.url}`));
  });

  await t.test('password share reveals nothing until unlocked; access grants work and die with the password', async () => {
    const s = await share({ skill: skillId, password: 'open-sesame' });
    assert.equal(s.protected, true);
    const locked = await anon(`/api/share/${s.token}`);
    assert.equal(locked.status, 401);
    const body = await locked.json();
    assert.equal(body.password_required, true);
    assert.equal(body.name, undefined, 'no metadata before unlock');
    assert.equal((await anon(`/share/${s.token}`)).status, 401);
    assert.equal((await anon(`/share/${s.token}/download`)).status, 401);
    const lockedScript = await anon(`/share/${s.token}/install.sh`);
    assert.equal(lockedScript.status, 401);
    assert.equal(spawnSync('bash', { input: await lockedScript.text(), encoding: 'utf8' }).status, 1);

    const unlock = (password) => anon(`/api/share/${s.token}/unlock`, { method: 'POST', headers: SAME_SITE, body: JSON.stringify({ password }) });
    assert.equal((await unlock('wrong')).status, 403);
    const ok = await unlock('open-sesame');
    assert.equal(ok.status, 200);
    const { access } = await ok.json();
    const cookie = ok.headers.get('set-cookie').split(';')[0];
    assert.match(cookie, new RegExp(`^ash_share_${s.id}=`));

    assert.equal((await anon(`/api/share/${s.token}`, { headers: { cookie } })).status, 200);
    assert.equal((await anon(`/share/${s.token}/info`, { headers: { 'x-ash-share-access': access } })).status, 200);
    assert.equal((await anon(`/share/${s.token}/download?access=${encodeURIComponent(access)}`)).status, 200);
    const view = await (await anon(`/api/share/${s.token}`, { headers: { cookie } })).json();
    assert.ok(view.install.curl.includes('access='), 'copied install command carries the grant');
    const script = await (await anon(`/share/${s.token}/install.sh?access=${encodeURIComponent(access)}`)).text();
    assert.match(script, /X-ASH-Share-Access/);

    // 凭据不能挪到别的分享上用
    const other = await share({ skill: skillId, password: 'open-sesame' });
    assert.equal((await anon(`/api/share/${other.token}`, { headers: { 'x-ash-share-access': access } })).status, 401);
    // 伪造签名无效
    assert.equal((await anon(`/api/share/${s.token}`, { headers: { 'x-ash-share-access': `${access.slice(0, -2)}xx` } })).status, 401);

    // 改密码后旧凭据失效；去掉密码后变成公开
    assert.equal((await api('PATCH', `/api/shares/${s.id}`, { password: 'new-secret' })).status, 200);
    assert.equal((await anon(`/api/share/${s.token}`, { headers: { cookie } })).status, 401);
    const cleared = await api('PATCH', `/api/shares/${s.id}`, { password: '' });
    assert.equal(cleared.json.share.protected, false);
    assert.equal((await anon(`/api/share/${s.token}`)).status, 200);
  });

  await t.test('unlock attempts are rate limited', async () => {
    const s = await share({ skill: skillId, password: 'right-one' });
    const headers = { ...SAME_SITE, 'x-forwarded-for': '203.0.113.9' };
    const attempt = (password) => anon(`/api/share/${s.token}/unlock`, { method: 'POST', headers, body: JSON.stringify({ password }) });
    for (let i = 0; i < 10; i += 1) assert.equal((await attempt(`nope-${i}`)).status, 403);
    assert.equal((await attempt('right-one')).status, 429);
  });

  await t.test('expired, revoked, trashed and deleted shares all look the same: 404', async () => {
    const short = await share({ skill: skillId, expires_in: 1 });
    assert.equal((await anon(`/api/share/${short.token}`)).status, 200);
    await delay(1100);
    assert.equal((await anon(`/api/share/${short.token}`)).status, 404);
    const listed = (await api('GET', '/api/shares')).json.shares.find((x) => x.id === short.id);
    assert.equal(listed.expired, true);

    const revoked = await share({ skill: skillId });
    assert.equal((await api('DELETE', `/api/shares/${revoked.token}`)).status, 200);
    assert.equal((await anon(`/api/share/${revoked.token}`)).status, 404);

    const otherId = await createSkill('temp-skill');
    const temp = await share({ skill: otherId });
    assert.equal((await api('POST', `/api/skills/${otherId}/trash`)).status, 200);
    assert.equal((await anon(`/api/share/${temp.token}`)).status, 404);
    assert.equal((await api('POST', `/api/skills/${otherId}/restore`)).status, 200);
    assert.equal((await anon(`/api/share/${temp.token}`)).status, 200);
    assert.equal((await api('DELETE', `/api/skills/${otherId}`)).status, 200);
    assert.equal((await anon(`/api/share/${temp.token}`)).status, 404);
    assert.equal((await api('GET', '/api/shares')).json.shares.some((x) => x.id === temp.id), false, 'rows cleaned up');

    assert.equal((await anon('/api/share/not-a-real-token-xxxxxx')).status, 404);
    assert.equal((await anon('/api/share/bad!')).status, 404);
  });

  await t.test('validation: pending skills, bad expiry, short password, foreign skills', async () => {
    const form = new FormData();
    form.append('content', skillMd('pending-skill'));
    const pushed = await fetch(`${origin}/api/agent/push`, { method: 'POST', body: form });
    assert.equal(pushed.status, 201, await pushed.clone().text());
    const pending = await api('POST', '/api/shares', { skill: 'pending-skill' });
    assert.equal(pending.status, 400);
    assert.match(pending.json.error, /待审核/);

    assert.equal((await api('POST', '/api/shares', { skill: skillId, expires: '2y' })).status, 400);
    assert.equal((await api('POST', '/api/shares', { skill: skillId, password: 'abc' })).status, 400);
    assert.equal((await api('POST', '/api/shares', { skill: 'no-such-skill' })).status, 404);
  });

  await t.test('other accounts cannot see or manage my shares, but can save a share into their own library', async () => {
    const s = await share({ skill: skillId });
    const bob = await registerUser(origin, 'bob-user');
    const asBob = (method, url, body) => rawFetch(`${origin}${url}`, { method, headers: bearer(bob.token), body: body === undefined ? undefined : JSON.stringify(body) });

    assert.deepEqual((await (await asBob('GET', '/api/shares')).json()).shares, []);
    assert.equal((await asBob('DELETE', `/api/shares/${s.id}`)).status, 404);
    assert.equal((await asBob('PATCH', `/api/shares/${s.id}`, { label: 'x' })).status, 404);
    assert.equal((await asBob('POST', '/api/shares', { skill: skillId })).status, 404, 'cannot share a skill they do not own');

    // 存到 bob 的库：带附属文件，进收件箱；同名冲突给出建议标识符
    const viewerInfo = await (await asBob('GET', `/api/share/${s.token}`)).json();
    assert.deepEqual(viewerInfo.viewer, { username: 'bob-user', is_owner: false });
    const saved = await asBob('POST', `/api/share/${s.token}/save`, {});
    assert.equal(saved.status, 201, await saved.clone().text());
    const { id: bobSkillId, slug } = await saved.json();
    assert.equal(slug, 'shared-skill');
    const bobSkill = await (await asBob('GET', `/api/skills/${bobSkillId}`)).json();
    assert.equal(bobSkill.folder_path, 'inbox');
    assert.equal(bobSkill.status, 'approved');
    assert.deepEqual(bobSkill.files.map((f) => f.path).sort(), ['references/notes.md', 'scripts/run.sh']);
    assert.match(bobSkill.terminal_source, /Share:tester/);

    const conflict = await asBob('POST', `/api/share/${s.token}/save`, {});
    assert.equal(conflict.status, 409);
    const { suggested_slug: suggested } = await conflict.json();
    assert.equal(suggested, 'shared-skill-from-tester');
    assert.equal((await asBob('POST', `/api/share/${s.token}/save`, { slug: suggested })).status, 201);

    // 主人自己存、未登录存都不行
    assert.equal((await api('POST', `/api/share/${s.token}/save`, {})).status, 400);
    assert.equal((await anon(`/api/share/${s.token}/save`, { method: 'POST', headers: SAME_SITE, body: '{}' })).status, 401);
    // 网页会话存要过 CSRF 校验
    const noCsrf = await rawFetch(`${origin}/api/share/${s.token}/save`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: bob.cookie }, body: '{}' });
    assert.equal(noCsrf.status, 403);
  });

  await t.test('CLI-friendly text responses', async () => {
    const created = await api('POST', '/api/shares', { skill: 'shared-skill', label: '文本', format: 'text' });
    assert.equal(created.status, 201);
    assert.match(created.text, /✓ 已创建分享链接[\s\S]*shared-skill[\s\S]*\/share\//);
    const listed = await api('GET', '/api/shares?format=text&skill=shared-skill');
    assert.match(listed.text, /「文本」/);
  });
});
