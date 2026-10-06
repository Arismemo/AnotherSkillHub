// 全库写作约定的机器检查：conventionIssues（经 lintSkill 输出）的规则与豁免、
// 推送前自查接口 POST /api/agent/lint（只读不写库），以及 CLI 把规则递到 Agent 手上的部分
// （--help 的规则块、ash new 骨架、对本地目录的 ash lint）
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const R = require('../skillRefs');
const { startServer } = require('./helpers');

const tmpDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const md = (front, body) => `---\n${front}\n---\n\n${body}\n`;

// description 只查约定本身：别的问题（双语、元技能结构）在这里不关心
const CONVENTIONS = ['desc-zh', 'desc-boundary', 'desc-use-when', 'desc-long', 'hardcoded-host', 'personal-path', 'secret-literal'];
const convOf = (analysis, slug) => Object.fromEntries(
  R.lintSkill(analysis, analysis.bySlug.get(slug), { username: 'u' }).filter((i) => CONVENTIONS.includes(i.code)).map((i) => [i.code, i.level]),
);
// 合规的 description：中文主句 + 「不要用于…（交给 X）」+ 英文 Use when …，且在 450 字以内
const GOOD_DESC = '把感知回放结果叠到原图上做一致性验证。不要用于实时预览（交给 live-preview）。Use when you need to verify replay results against the original frames.';

test('writing conventions: description 结构（中文主句 / 边界 / Use when / 长度）', () => {
  const skill = (id, slug, description, body = '# 标题\n\n正文') => ({
    id, slug, name: slug, content: md(`name: ${slug}`, body), files: '[]', status: 'approved', description, folder_path: '', tags: '[]',
  });
  const a = R.analyzeLibrary([
    skill(1, 'desc-en', 'deploy the site 使用一次'), // 中文不足 8 个字，也没有边界和 Use when
    skill(2, 'desc-no-boundary', '把网站部署到线上环境并返回预览链接。Use when you need to deploy the site.'),
    skill(3, 'desc-no-use-when', '把网站部署到线上环境并返回预览链接，不要用于本地调试（交给 local-dev）。'),
    skill(4, 'desc-long', `${'部署站点上线并返回链接。'.repeat(40)}不要用于本地调试（交给 local-dev）。Use when you deploy the site.`),
    skill(5, 'desc-good', GOOD_DESC),
  ]);
  assert.deepEqual(convOf(a, 'desc-en'), { 'desc-zh': 'info', 'desc-boundary': 'info', 'desc-use-when': 'info' });
  assert.deepEqual(convOf(a, 'desc-no-boundary'), { 'desc-boundary': 'info' }, '只缺「不要用于…（交给 X）」');
  assert.deepEqual(convOf(a, 'desc-no-use-when'), { 'desc-use-when': 'info' }, '只缺英文 Use when');
  assert.deepEqual(convOf(a, 'desc-long'), { 'desc-long': 'info' }, '只超长');
  assert.deepEqual(convOf(a, 'desc-good'), {}, '结构合规的 description 不提示');
});

test('writing conventions: 正文里的内网地址 / 个人路径 / 口令明文', () => {
  const skill = (id, slug, body) => ({
    id, slug, name: slug, content: md(`name: ${slug}`, body), files: '[]', status: 'approved', description: GOOD_DESC, folder_path: '', tags: '[]',
  });
  const a = R.analyzeLibrary([
    // 地址最常出现在命令里：连代码块一起查（stripFences 之前的正文原文）
    skill(1, 'host-office', '```bash\ncurl http://10.12.34.56:8080/api\n```'),
    skill(2, 'host-dc', '```bash\nssh ubuntu@172.24.0.1\n```'),
    skill(3, 'host-tailnet', '```bash\nping 100.100.1.2\n```'),
    skill(4, 'host-lan', '```bash\nping 192.168.1.10\n```'),
    // 版本号长得像 IP：不报
    skill(5, 'host-version', '已安装 TensorRT version 10.13.3.9，直接跑推理即可'),
    // 端点的唯一来源技能：默认值放在那里是约定本身，不报
    skill(6, 'host-endpoint', '## 端点（全库唯一存放默认值的地方）\n\n```bash\ncurl http://10.12.34.56/api\n```'),
    // 个人路径要改掉；容器公共账号和变量写法不算
    skill(7, 'path-linux', 'cp /home/alice/work/data .'),
    skill(8, 'path-mac', 'cat /Users/alice/notes/x.md'),
    skill(9, 'path-shared', 'ls /home/vscode/ /home/$USER/ /home/<user>/'),
    // 口令只写变量名；引用环境变量和占位符不算明文
    skill(10, 'secret', '```bash\nexport DB_PASSWORD=abcd1234efgh\n```'),
    skill(11, 'secret-safe', '```bash\nexport DB_PASSWORD="$DB_PASSWORD"\nAPI_KEY=<redacted>\n```'),
    skill(13, 'secret-bare', '```bash\nAPI_KEY=realsecret123\n```'),
    skill(12, 'all-clean', '在共享开发机上完成构建，产物上传到制品库。\n\n```bash\nmake build && upload artifacts\n```'),
  ]);
  assert.deepEqual(convOf(a, 'host-office'), { 'hardcoded-host': 'warn' }, '办公网 10.x 必须改掉');
  assert.deepEqual(convOf(a, 'host-dc'), { 'hardcoded-host': 'warn' }, '172.16-31 也是内网地址');
  assert.deepEqual(convOf(a, 'host-tailnet'), { 'hardcoded-host': 'warn' }, '100.64-127（tailnet）同样是内网地址');
  assert.deepEqual(convOf(a, 'host-lan'), { 'hardcoded-host': 'info' }, '192.168 多是固定设备拓扑，只提醒');
  assert.deepEqual(convOf(a, 'host-version'), {}, '版本号不是地址');
  assert.deepEqual(convOf(a, 'host-endpoint'), {}, '端点技能是默认值的唯一来源');
  assert.deepEqual(convOf(a, 'path-linux'), { 'personal-path': 'warn' });
  assert.deepEqual(convOf(a, 'path-mac'), { 'personal-path': 'warn' });
  assert.deepEqual(convOf(a, 'path-shared'), {}, '公共账号与变量写法不是个人路径');
  assert.deepEqual(convOf(a, 'secret'), { 'secret-literal': 'warn' });
  assert.deepEqual(convOf(a, 'secret-safe'), {}, '引用环境变量和占位符不算明文');
  assert.deepEqual(convOf(a, 'secret-bare'), { 'secret-literal': 'warn' }, '没有前缀的 API_KEY 也要查');
  assert.deepEqual(convOf(a, 'all-clean'), {}, '干净的正文不产生任何约定问题');
});

test('POST /api/agent/lint 检查草稿但不写库；缺 content 报 400', async (t) => {
  const server = await startServer();
  const { origin } = server;
  t.after(() => server.stop());
  const draft = md('name: lint-draft\ndescription: 检查接口用的草稿技能。不要用于线上技能（交给 real-skill）。Use when testing the lint endpoint.',
    '# 草稿\n\n备份命令：\n\n```bash\ncp -r /home/alice/work /tmp/backup\n```');
  const res = await fetch(`${origin}/api/agent/lint`, { method: 'POST', body: new URLSearchParams({ content: draft, format: 'text' }) });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /本地版本/);
  assert.match(text, /个人路径 \/home\/alice\//);
  assert.equal((await fetch(`${origin}/api/skills/lint-draft`)).status, 404, 'lint 只读，不创建技能');
  const missing = await fetch(`${origin}/api/agent/lint`, { method: 'POST', body: new URLSearchParams({ format: 'text' }) });
  assert.equal(missing.status, 400);
});

test('CLI 把规则递到 Agent 手上：--help 规则块、push --help、ash new 骨架、本地 lint', async (t) => {
  const server = await startServer();
  const { origin } = server;
  t.after(() => server.stop());
  const work = tmpDir('ash-conv-');
  const home = path.join(work, 'home');
  fs.mkdirSync(home);
  const cli = path.join(work, 'cli.sh');
  fs.writeFileSync(cli, await (await fetch(`${origin}/cli.sh`)).text());
  const ash = (args, env = {}) => spawnSync('bash', [cli, ...args], { cwd: work, env: { ...process.env, HOME: home, ASH_TERMINAL: 'box', ...env }, encoding: 'utf8' });
  const ok = (args, env) => {
    const r = ash(args, env);
    assert.equal(r.status, 0, `ash ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`);
    return r;
  };
  const writeSkill = (content) => {
    const dir = tmpDir('ash-src-');
    fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
    return dir;
  };
  const detail = async (slug) => (await fetch(`${origin}/api/skills/${slug}`)).json();
  const approve = async (slug) => assert.equal((await fetch(`${origin}/api/skills/${(await detail(slug)).id}/approve`, { method: 'POST' })).status, 200);

  await t.test('ash --help 带给 Agent 的规则块和新技能入口', () => {
    const out = ok(['--help']).stdout;
    assert.match(out, /给 Agent 的规则/);
    assert.match(out, /ash new <slug>/);
  });

  await t.test('ash push --help 只看这条命令的用法和规则块，不真的推送', () => {
    const r = ok(['push', '--help']);
    assert.match(r.stdout, /ash push <技能目录\|SKILL\.md>/);
    assert.match(r.stdout, /给 Agent 的规则/);
    assert.doesNotMatch(r.stderr, /推送/, '推送会先在 stderr 打出「→ 推送…」');
  });

  await t.test('ash new 生成符合规范的骨架；非法 slug 与已存在的目录直接失败', () => {
    const dir = path.join(work, 'skeleton');
    ok(['new', 'demo-skill', '--dir', dir]);
    assert.match(fs.readFileSync(path.join(dir, 'demo-skill', 'SKILL.md'), 'utf8'), /^name: demo-skill$/m);

    const metaDir = path.join(work, 'meta-skeleton');
    ok(['new', 'meta-demo', '--meta', '--dir', metaDir]);
    const meta = fs.readFileSync(path.join(metaDir, 'meta-demo', 'SKILL.md'), 'utf8');
    assert.match(meta, /^## 契约$/m);
    assert.match(meta, /^## 被谁引用$/m);
    assert.match(meta, /^description: 【元技能】/m);

    const bad = ash(['new', 'Bad_Slug', '--dir', dir]);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /slug 只能用小写字母/);
    const exists = ash(['new', 'demo-skill', '--dir', dir]);
    assert.notEqual(exists.status, 0);
    assert.match(exists.stderr, /已存在/);
  });

  await t.test('ash new 拒绝库里已发布的同名技能，指路 ash pull', async () => {
    ok(['push', writeSkill(md('name: hub-taken\ndescription: 库里已占用的标识 hub skill already taken', '# 已占用'))]);
    await approve('hub-taken');
    const r = ash(['new', 'hub-taken', '--dir', path.join(work, 'nope')]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /库里已有 hub-taken/);
    assert.match(r.stderr, /ash pull hub-taken/);
  });

  await t.test('ash lint <目录> 检查的是还没推送的本地版本', () => {
    const dir = writeSkill(md('name: local-draft\ndescription: 本地草稿技能。不要用于已推送技能的检查（交给 ash push）。Use when checking a local draft.',
      '# 本地草稿\n\n```bash\ncp -r /home/alice/work /tmp/backup\n```'));
    const r = ok(['lint', dir]);
    assert.match(r.stdout, /本地版本/);
    assert.match(r.stdout, /个人路径 \/home\/alice\//);
  });
});
