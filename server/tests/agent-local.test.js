// Agent 侧管理能力：组合读取、依赖安装、本地已装技能（installed/outdated/pull --all/remove）、
// 审核跟进（mine/withdraw）、历史版本、筛选，以及 /s 与 /api/agent 路由拆分
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { startServer } = require('./helpers');

const tmpDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const md = (slug, title, { deps = [], tags = ['local'], body = '' } = {}) =>
  `---\nname: ${slug}\ndescription: ${title}时使用\ntags: [${tags.join(', ')}]\nversion: 1.0.0\n${deps.length ? `depends_on: [${deps.join(', ')}]\n` : ''}---\n\n# ${title}\n\n${body}\n`;

test('agent-side management', async (t) => {
  const server = await startServer();
  const { origin } = server;
  t.after(() => server.stop());

  const work = tmpDir('ash-local-');
  const home = path.join(work, 'home');
  fs.mkdirSync(home);
  const cli = path.join(work, 'cli.sh');
  fs.writeFileSync(cli, await (await fetch(`${origin}/cli.sh`)).text());
  const ash = (args, env = {}) => spawnSync('bash', [cli, ...args], {
    cwd: work, env: { ...process.env, HOME: home, ASH_TERMINAL: 'agent-a', ...env }, encoding: 'utf8',
  });
  const ok = (args, env) => {
    const r = ash(args, env);
    assert.equal(r.status, 0, `ash ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`);
    return r;
  };
  const writeSkill = (files) => {
    const dir = tmpDir('ash-src-');
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    return dir;
  };
  const idOf = async (slug) => (await (await fetch(`${origin}/api/skills/${slug}`)).json()).id;
  const approve = async (slug) => assert.equal((await fetch(`${origin}/api/skills/${await idOf(slug)}/approve`, { method: 'POST' })).status, 200);
  const publish = async (files, update = false) => {
    ok(['push', writeSkill(files), ...(update ? ['--update'] : [])]);
    await approve(files['SKILL.md'].match(/^name: (.+)$/m)[1]);
  };

  // alpha 依赖 beta 与一个不存在的技能；beta 反过来依赖 alpha（循环）
  await publish({ 'SKILL.md': md('alpha', '阿尔法', { deps: ['beta', 'ghost-skill'], tags: ['local', 'core'] }), 'scripts/a.sh': 'echo a\n' });
  await publish({ 'SKILL.md': md('beta', '贝塔', { deps: ['alpha'] }), 'references/old.md': '# old\n' });
  const skillsDir = path.join(work, 'skills');

  await t.test('templates stay bash-3.2 compatible and share one fingerprint definition', () => {
    const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'templates', 'cli.sh'), 'utf8');
    const installSrc = fs.readFileSync(path.join(__dirname, '..', 'templates', 'install.sh'), 'utf8');
    for (const src of [cliSrc, installSrc]) {
      const code = src.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
      assert.doesNotMatch(code, /declare -A|mapfile|readarray|\$\{[a-zA-Z_]+,,\}/);
    }
    const fp = (src) => src.match(/ash_fingerprint\(\) \{\n(.*)\n\}/)[1];
    assert.equal(fp(cliSrc), fp(installSrc));
    assert.equal(spawnSync('bash', ['-n', cli]).status, 0);
  });

  await t.test('pull installs dependencies once, survives cycles, warns about missing ones', () => {
    const r = ok(['pull', 'alpha', '--dir', skillsDir]);
    assert.ok(fs.existsSync(path.join(skillsDir, 'alpha', 'scripts', 'a.sh')));
    assert.ok(fs.existsSync(path.join(skillsDir, 'beta', 'SKILL.md')), 'dependency installed into the same dir');
    assert.match(r.stderr, /依赖 ghost-skill 安装失败/);
    assert.match(fs.readFileSync(path.join(skillsDir, 'alpha', '.ash'), 'utf8'), /^slug=alpha$/m);
    const nodeps = path.join(work, 'nodeps');
    ok(['pull', 'alpha', '--dir', nodeps, '--no-deps']);
    assert.ok(!fs.existsSync(path.join(nodeps, 'beta')));
    assert.ok(!fs.readdirSync(skillsDir).some((n) => n.startsWith('.ash-staging')), 'staging dirs are cleaned up');
  });

  await t.test('info shows dependencies and revision', () => {
    const info = ok(['info', 'alpha']).stdout;
    assert.match(info, /依赖: beta, ghost-skill（库中缺失或未发布: ghost-skill）/);
    assert.match(info, /修订 [0-9a-f]{12}/);
  });

  await t.test('installed / outdated / pull --all / local-modification protection', async () => {
    assert.match(ok(['installed', '--dir', skillsDir]).stdout, /alpha  ·  v1\.0\.0  ·  最新/);
    assert.match(ok(['outdated', '--dir', skillsDir]).stdout, /所有已装技能都是最新的/);

    // 远端更新 alpha 与 beta（beta 删掉一个附属文件），本地改动 alpha
    await publish({ 'SKILL.md': md('alpha', '阿尔法', { deps: ['beta'], body: 'v2' }).replace('1.0.0', '2.0.0'), 'scripts/a.sh': 'echo a2\n' }, true);
    await publish({ 'SKILL.md': md('beta', '贝塔', { body: 'v2' }).replace('1.0.0', '2.0.0') }, true);
    fs.appendFileSync(path.join(skillsDir, 'alpha', 'SKILL.md'), '\n我的本地笔记\n');

    const outdated = ok(['outdated', '--dir', skillsDir]).stdout;
    assert.match(outdated, /alpha  ·  v1\.0\.0  ·  本地有修改 · 远端有更新 v2\.0\.0/);
    assert.match(outdated, /beta  ·  v1\.0\.0  ·  有更新 → v2\.0\.0/);

    const all = ok(['pull', '--all', '--dir', skillsDir]).stdout;
    assert.match(all, /⏭  alpha：本地有修改/);
    assert.match(all, /更新 1 个，跳过 1 个，失败 0 个/);
    assert.match(fs.readFileSync(path.join(skillsDir, 'beta', 'SKILL.md'), 'utf8'), /v2/);
    assert.ok(!fs.existsSync(path.join(skillsDir, 'beta', 'references', 'old.md')), 'files removed upstream are removed locally');
    assert.match(fs.readFileSync(path.join(skillsDir, 'alpha', 'SKILL.md'), 'utf8'), /我的本地笔记/, 'modified skill untouched');

    const single = ok(['pull', 'alpha', '--dir', skillsDir]);
    assert.match(single.stderr, /本地有修改，已备份到 .*\.ash\/backups\/alpha-/);
    const backups = fs.readdirSync(path.join(home, '.ash', 'backups'));
    assert.ok(backups.some((b) => b.startsWith('alpha-')));
    assert.match(fs.readFileSync(path.join(home, '.ash', 'backups', backups.find((b) => b.startsWith('alpha-')), 'SKILL.md'), 'utf8'), /我的本地笔记/);
    assert.doesNotMatch(ok(['installed', '--dir', skillsDir]).stdout, /有更新|本地有修改/);
  });

  await t.test('pulling over a directory not installed by ash backs it up first', () => {
    fs.mkdirSync(path.join(skillsDir, 'systematic-debugging'));
    fs.writeFileSync(path.join(skillsDir, 'systematic-debugging', 'mine.md'), 'hand-written');
    const r = ok(['pull', 'systematic-debugging', '--dir', skillsDir]);
    assert.match(r.stderr, /不是由 ash 安装的，已备份到/);
    assert.ok(!fs.existsSync(path.join(skillsDir, 'systematic-debugging', 'mine.md')));
  });

  await t.test('pushing an installed directory never uploads the local .ash metadata', async () => {
    fs.appendFileSync(path.join(skillsDir, 'beta', 'SKILL.md'), '\n本地补充\n');
    fs.mkdirSync(path.join(skillsDir, 'beta', 'notes'));
    fs.writeFileSync(path.join(skillsDir, 'beta', 'notes', 'x.md'), 'x');
    assert.match(ok(['push', path.join(skillsDir, 'beta'), '--update']).stdout, /已提交 beta 的更新/);
    const detail = await (await fetch(`${origin}/api/skills/beta`)).json();
    assert.deepEqual(detail.pending_update.files.map((f) => f.path), ['notes/x.md'], 'only real skill files are uploaded');
    assert.equal((await fetch(`${origin}/api/skills/${detail.id}/reject`, { method: 'POST' })).status, 200);
  });

  await t.test('remove deletes tracked installs, backs up modified ones, refuses untracked', () => {
    ok(['pull', 'beta', '--dir', skillsDir, '--force']); // 先恢复成干净的已装状态
    assert.match(ok(['remove', 'beta', '--dir', skillsDir]).stdout, /✓ 已卸载 .*beta$/m);
    assert.ok(!fs.existsSync(path.join(skillsDir, 'beta')));
    fs.appendFileSync(path.join(skillsDir, 'alpha', 'SKILL.md'), 'edit');
    assert.match(ok(['remove', 'alpha', '--dir', skillsDir]).stdout, /本地有修改，已备份到/);
    fs.mkdirSync(path.join(skillsDir, 'handmade'));
    const r = ash(['remove', 'handmade', '--dir', skillsDir]);
    assert.notEqual(r.status, 0);
    assert.ok(fs.existsSync(path.join(skillsDir, 'handmade')));
  });

  await t.test('bundles: list, inspect by Chinese name, install published members only', async () => {
    const bundle = await (await fetch(`${origin}/api/bundles`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '本地工具箱', description: '测试组合' }),
    })).json();
    assert.match(bundle.slug, /^bundle-\d+$/, 'chinese names still get timestamp slugs');
    ok(['push', writeSkill({ 'SKILL.md': md('still-pending', '待审') })]);
    for (const slug of ['alpha', 'still-pending']) {
      await fetch(`${origin}/api/bundles/${bundle.id}/skills`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skill_id: await idOf(slug) }) });
    }
    assert.match(ok(['bundles']).stdout, new RegExp(`${bundle.slug}  ·  本地工具箱  ·  2 个技能`));
    const detail = ok(['bundle', '本地工具箱']).stdout;
    assert.match(detail, /alpha  ·  阿尔法/);
    assert.match(detail, /still-pending  ·  待审  \[待审核，安装时跳过\]/);
    const target = path.join(work, 'bundle-out');
    ok(['pull', 'bundle:本地工具箱', '--dir', target]);
    assert.ok(fs.existsSync(path.join(target, 'alpha', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(target, 'still-pending')));
    assert.notEqual(ash(['bundle', '不存在的组合']).status, 0);
  });

  await t.test('mine and withdraw track and retract only your own pending pushes', async () => {
    const mine = ok(['mine']).stdout;
    assert.match(mine, /still-pending  ·  待审  ·  新技能待审核/);
    assert.match(mine, /beta  ·  贝塔  ·  更新被拒绝/);
    assert.match(mine, /alpha  ·  阿尔法  ·  更新已采纳/);

    const other = ash(['withdraw', 'still-pending'], { ASH_TERMINAL: 'agent-b' });
    assert.notEqual(other.status, 0);
    assert.match(other.stderr, /不是由 agent-b 推送的/);
    assert.match(ok(['withdraw', 'still-pending']).stdout, /已撤回待审核的新技能/);
    assert.equal((await fetch(`${origin}/api/skills/still-pending`)).status, 404);
    ok(['push', writeSkill({ 'SKILL.md': md('still-pending', '待审') })]); // 撤回后可以重新推送，不会 409

    ok(['push', writeSkill({ 'SKILL.md': md('alpha', '阿尔法', { body: 'v3' }) }), '--update']);
    assert.match(ok(['mine']).stdout, /alpha  ·  阿尔法  ·  更新待审核/);
    assert.match(ok(['withdraw', 'alpha']).stdout, /已撤回 alpha 的待审更新/);
    assert.equal((await (await fetch(`${origin}/api/skills/alpha`)).json()).pending_update, null);
    assert.notEqual(ash(['withdraw', 'alpha']).status, 0, 'published skills cannot be withdrawn');
  });

  await t.test('versions and show --version expose history read-only', () => {
    const versions = ok(['versions', 'alpha']).stdout;
    assert.match(versions, /alpha 共 \d+ 个历史版本/);
    const id = versions.split('\n')[1].split('  ·  ')[0];
    assert.doesNotMatch(ok(['show', 'alpha', '--version', id]).stdout, /v3/);
  });

  await t.test('search and list filter by tag and folder', () => {
    const core = ok(['list', '--tag', 'core']).stdout;
    assert.match(core, /^共 1 个技能/);
    assert.match(core, /alpha/);
    assert.match(ok(['search', '阿尔法', '--folder', 'inbox']).stdout, /alpha/);
    assert.match(ok(['search', '阿尔法', '--folder', 'Engineering']).stdout, /没有找到/);
  });

  await t.test('read routes live under /s only, write routes under /api/agent only', async () => {
    assert.equal((await fetch(`${origin}/api/agent/alpha.md`)).status, 404);
    assert.equal((await fetch(`${origin}/s/push`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${origin}/s/alpha.md`)).status, 200);
  });
});
