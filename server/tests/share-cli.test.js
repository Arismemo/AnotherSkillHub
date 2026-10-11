// 分享的 CLI 侧：ash share / shares / unshare 管理自己的分享链接；ash pull <分享链接> 免登录安装
// （含密码分享的 ASH_SHARE_PASSWORD / 解锁流程），以及分享装的技能在 installed / outdated /
// doctor / migrate / pull --all 里的记账：标出来源、不与自己的库比对
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { startServer, SAME_SITE } = require('./helpers');

const tmpDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test('share CLI: manage links, pull from them, keep local bookkeeping', async (t) => {
  const server = await startServer();
  const { origin } = server;
  t.after(() => server.stop());

  // 网页同款接口创建一个已发布技能（网页创建的直接发布，不走审核）
  const created = await fetch(`${origin}/api/skills`, {
    method: 'POST',
    headers: SAME_SITE,
    body: JSON.stringify({
      content: '---\nname: demo-skill\ndescription: demo 测试时使用\n---\n\n# Demo\n',
      files: [{ path: 'scripts/run.sh', content: 'echo hi\n' }],
    }),
  });
  assert.equal(created.status, 201, await created.text());

  const work = tmpDir('ash-share-');
  const home = path.join(work, 'home');
  fs.mkdirSync(home);
  const cli = path.join(work, 'cli.sh');
  fs.writeFileSync(cli, await (await fetch(`${origin}/cli.sh`)).text());
  assert.equal(spawnSync('bash', ['-n', cli]).status, 0, '生成的 CLI 是合法 bash');
  const ownerEnv = { ...process.env, HOME: home, ASH_TERMINAL: 'agent-a' };
  // 收件人视角：没有 ASH_TOKEN，临时 HOME 里也没有 ~/.ash/token
  const guestEnv = { ...ownerEnv };
  delete guestEnv.ASH_TOKEN;
  const ash = (args, env = {}) => spawnSync('bash', [cli, ...args], { cwd: work, env: { ...ownerEnv, ...env }, encoding: 'utf8' });
  const guest = (args, env = {}) => spawnSync('bash', [cli, ...args], { cwd: work, env: { ...guestEnv, ...env }, encoding: 'utf8' });
  const ok = (r, label) => assert.equal(r.status, 0, `${label} 失败:\n${r.stdout}\n${r.stderr}`);
  // 分享链接在输出里单独占一行（前面带 3 个空格缩进）
  const shareUrlOf = (text) => text.split('\n').map((l) => l.trim()).find((l) => /^https?:\/\/.+\/share\/[A-Za-z0-9_-]+$/.test(l));

  let publicUrl = '';
  let lockedUrl = '';

  await t.test('ash share / shares / unshare manage your own links', () => {
    const r = ash(['share', 'demo-skill', '--label', 'x']);
    ok(r, 'ash share');
    assert.match(r.stdout, /✓ 已创建分享链接/);
    const url = shareUrlOf(r.stdout);
    assert.ok(url, '输出里有分享链接');
    assert.ok(url.startsWith(`${origin}/share/`), `链接指向本服务: ${url}`);

    const list = ash(['shares']);
    ok(list, 'ash shares');
    assert.match(list.stdout, /demo-skill/);
    assert.match(list.stdout, /「x」/);
    assert.ok(list.stdout.includes(url));
    assert.match(ash(['shares', 'demo-skill']).stdout, /「x」/, '可按 slug 过滤');
    const missing = ash(['shares', 'no-such-skill']);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /技能 no-such-skill 不存在/, '服务端的 JSON 错误按文本报出来');

    const gone = ash(['unshare', url]);
    ok(gone, 'ash unshare');
    assert.match(gone.stdout, /已停用分享 #\d+（demo-skill）/);
    assert.match(ash(['shares']).stdout, /还没有分享链接/);

    const again = ash(['share', 'demo-skill', '--label', 'for agents', '--expires', '30d']);
    ok(again, '重新创建分享');
    publicUrl = shareUrlOf(again.stdout);
    assert.ok(publicUrl);
  });

  await t.test('ash pull <分享链接> installs without any token', () => {
    assert.ok(!fs.existsSync(path.join(home, '.ash', 'token')), '临时 HOME 里没有 token 文件');
    const r = guest(['pull', publicUrl]);
    ok(r, 'ash pull 分享链接');
    const dir = path.join(home, '.ash', 'skills', 'demo-skill');
    assert.ok(fs.existsSync(path.join(dir, 'SKILL.md')), 'SKILL.md 装进共享存储');
    assert.match(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), /# Demo/);
    assert.ok(fs.existsSync(path.join(dir, 'scripts', 'run.sh')), '附属文件也装上了');
    assert.equal(fs.readFileSync(path.join(dir, 'scripts', 'run.sh'), 'utf8'), 'echo hi\n');
    assert.match(fs.readFileSync(path.join(dir, '.ash'), 'utf8'), /^share=\S+\/share\/[A-Za-z0-9_-]+$/m, '.ash 记下分享来源');

    // 链接末尾多一个斜杠、装到指定目录也可以
    const again = guest(['pull', `${publicUrl}/`, '--dir', path.join(work, 'again')]);
    ok(again, 'ash pull 分享链接（末尾斜杠）');
    assert.ok(fs.existsSync(path.join(work, 'again', 'demo-skill', 'scripts', 'run.sh')));
  });

  await t.test('password share: wrong password fails, correct one installs', () => {
    const r = ash(['share', 'demo-skill', '--label', 'locked', '--password', 's3cret-pass']);
    ok(r, 'ash share --password');
    assert.match(r.stdout, / · 密码 · /, '列表里标出密码访问');
    lockedUrl = shareUrlOf(r.stdout);
    assert.ok(lockedUrl);

    const wrong = guest(['pull', lockedUrl, '--dir', path.join(work, 'locked')], { ASH_SHARE_PASSWORD: 'wrong-password' });
    assert.notEqual(wrong.status, 0);
    assert.match(wrong.stderr, /密码不正确/);
    assert.ok(!fs.existsSync(path.join(work, 'locked', 'demo-skill')), '密码错了不安装');

    const right = guest(['pull', lockedUrl, '--dir', path.join(work, 'locked')], { ASH_SHARE_PASSWORD: 's3cret-pass' });
    ok(right, 'ash pull 密码分享');
    assert.ok(fs.existsSync(path.join(work, 'locked', 'demo-skill', 'SKILL.md')));
    assert.match(fs.readFileSync(path.join(work, 'locked', 'demo-skill', '.ash'), 'utf8'), /^share=/m);
  });

  await t.test('installed marks share installs; outdated / doctor leave them alone', () => {
    const inst = guest(['installed']);
    ok(inst, 'ash installed');
    assert.match(inst.stdout, /demo-skill/);
    assert.match(inst.stdout, /来自分享 http/);
    assert.match(inst.stdout, /重新安装/, '提示用 ash pull <链接> 重新安装');

    const out = guest(['outdated']);
    ok(out, 'ash outdated');
    assert.doesNotMatch(out.stdout, /demo-skill/);
    assert.match(out.stdout, /所有已装技能都是最新的/);

    const doc = guest(['doctor']);
    ok(doc, 'ash doctor');
    assert.match(doc.stdout, /✅ 没有发现问题/);
    assert.doesNotMatch(doc.stdout, /没有链接给任何 Agent/);
  });

  await t.test('share install in an agent dir: migrate / pull --all skip it without a token', () => {
    // 另一台「收件人机器」：密码分享直接装进 Agent 目录，没有登录任何账号
    const home2 = path.join(work, 'home2');
    fs.mkdirSync(path.join(home2, '.claude', 'skills'), { recursive: true });
    const env2 = { ...guestEnv, HOME: home2 };
    const pull = spawnSync('bash', [cli, 'pull', lockedUrl, '--dir', path.join(home2, '.claude', 'skills')],
      { cwd: work, env: { ...env2, ASH_SHARE_PASSWORD: 's3cret-pass' }, encoding: 'utf8' });
    ok(pull, 'ash pull 密码分享到 Agent 目录');
    assert.ok(fs.existsSync(path.join(home2, '.claude', 'skills', 'demo-skill', '.ash')));

    const mig = spawnSync('bash', [cli, 'migrate'], { cwd: work, env: env2, encoding: 'utf8' });
    ok(mig, 'ash migrate');
    assert.match(mig.stdout, /没有需要迁移的技能/);

    const all = spawnSync('bash', [cli, 'pull', '--all'], { cwd: work, env: env2, encoding: 'utf8' });
    ok(all, 'ash pull --all');
    assert.match(all.stdout, /更新 0 个，跳过 0 个，失败 0 个/);
  });
});
