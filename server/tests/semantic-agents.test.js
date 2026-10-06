// 语义层（跨语言查重与找技能）、文字步骤比对、只改双语字段直接发布、可调用性检查、
// 固定版本安装、多 Agent 安装与 ash doctor
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { startServer } = require('./helpers');

const tmpDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
process.env.DATA_DIR ||= tmpDir('ash-sem-db-');
const { extractProseSteps, sharedProseRuns } = require('../skillSteps');
const { onlyLocalizationChanged } = require('../skillMeta');
const { analyzeLibrary, lintSkill } = require('../skillRefs');
const { semanticPair, semanticQuery } = require('../skillIndex');

const md = (front, body) => `---\n${front}\n---\n\n${body}\n`;

test('prose steps: numbered steps are matched even when worded a little differently', () => {
  const a = { id: 1, steps: extractProseSteps(md('name: a', '## 步骤\n1. 登录开发机并进入 devbox 容器\n2. 拉取最新的 main 分支代码并同步子模块\n3. 用 j6 配置编译感知模块的回放目标\n4. 把产物拷到回放目录并记录版本号\n5. 写报告')) };
  const b = { id: 2, steps: extractProseSteps(md('name: b', '# 回归\n\n1. 先登录开发机，进入 devbox 容器\n2. 拉取最新的 main 分支代码，同步子模块\n3. 用 j6 配置编译感知模块回放目标\n4. 把产物拷到回放目录，记录版本号')) };
  const c = { id: 3, steps: extractProseSteps(md('name: c', '1. 打开飞书文档\n2. 选中要评论的段落\n3. 输入评论内容并提交\n4. 通知相关同事查看')) };
  const runs = sharedProseRuns([a, b, c]);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].skills, [1, 2]);
  assert.equal(runs[0].commands.length, 4);
  // 代码块、标题处断开，短步骤不参与
  const steps = extractProseSteps(md('name: d', '1. 这是第一个比较长的步骤描述\n```bash\n1. not a step\n```\n## 下一节\n2. 验证'));
  assert.equal(steps.filter((s) => s.tokens && s.tokens.size).length, 1);
});

test('only-localization updates are recognised exactly', () => {
  const base = md('name: a\ndescription: 中文描述\ntags: [x]', '# A\n\n正文');
  assert.equal(onlyLocalizationChanged(base, base.replace('description: 中文描述', 'description: 中文描述\ndescription_en: English one')), true);
  assert.equal(onlyLocalizationChanged(base, base.replace('tags: [x]', 'tags: [x]\nmetadata:\n  description-en: English')), true);
  assert.equal(onlyLocalizationChanged(base, base.replace('中文描述', '改了主描述')), false, 'the main description is what agents read');
  assert.equal(onlyLocalizationChanged(base, base.replace('tags: [x]', 'tags: [y]')), false);
  assert.equal(onlyLocalizationChanged(base, base.replace('正文', '正文改了')), false);
  assert.equal(onlyLocalizationChanged(base, base), false);
});

test('lint: can agents load and invoke the skill', () => {
  const skill = (id, slug, content, description = `${slug} 何时使用 when to use it`) => ({ id, slug, name: slug, description, status: 'approved', version: '1.0.0', tags: '[]', content });
  const analysis = analyzeLibrary([
    skill(1, 'manual-only', md('name: manual-only\ndisable-model-invocation: true', '# m')),
    skill(2, 'caller', md('name: caller\ndepends_on: [manual-only]', '# c')),
    skill(3, 'Bad_Name', md('name: Bad_Name', '# b')),
    skill(4, 'renamed', md('name: other-name', '# r')),
    skill(5, 'silent', md('name: silent', '# s'), ''),
    skill(6, 'wordy', md('name: wordy', '# w'), `${'很长的描述'.repeat(300)} use when`),
  ]);
  const codes = (slug) => lintSkill(analysis, analysis.bySlug.get(slug)).map((i) => i.code);
  assert.ok(codes('manual-only').includes('not-invocable'));
  assert.ok(codes('caller').includes('ref-not-invocable'));
  assert.ok(codes('Bad_Name').includes('spec-name'));
  assert.ok(codes('renamed').includes('name-mismatch'));
  assert.ok(codes('silent').includes('no-description'));
  assert.ok(codes('wordy').includes('description-length'));
});

test('semantic scores map onto the lexical scale at the calibrated thresholds', () => {
  assert.equal(semanticPair(0.5), 0);
  assert.ok(Math.abs(semanticPair(0.68) - 0.25) < 1e-9);
  assert.ok(Math.abs(semanticPair(0.74) - 0.4) < 1e-9);
  assert.ok(semanticPair(0.9) > semanticPair(0.8));
  assert.ok(Math.abs(semanticQuery(0.58) - 0.12) < 1e-9);
  assert.ok(Math.abs(semanticQuery(0.68) - 0.25) < 1e-9);
  assert.equal(semanticQuery(0.4), 0);
});

// 假的向量服务（Ollama /api/embed 接口）：按概念词表给文本打分，中英文说同一件事的文本落在同一个方向上。
// 跑在单独的进程里：测试用 spawnSync 调 ash，会阻塞本进程的事件循环，服务要是在本进程里就答不上来
const FAKE_EMBEDDINGS = `
const CONCEPTS = [/数据库|迁移|回滚|database|migration|rollback|schema/gi, /部署|上线|deploy|release/gi,
  /飞书|文档|lark|doc/gi, /技能|skill|写|writ/gi, /测试|根因|调试|bug|debug|test|root cause/gi];
let calls = 0;
const server = require('http').createServer((req, res) => {
  if (req.url === '/calls') return res.end(String(calls));
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => setTimeout(() => {
    calls += 1;
    const { input } = JSON.parse(body || '{}');
    const vectors = (Array.isArray(input) ? input : [input]).map((t) => [...CONCEPTS.map((re) => (String(t).match(re) || []).length), 0.3]);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ embeddings: vectors }));
  }, Number(process.env.DELAY_MS || 0)));
});
server.listen(0, '127.0.0.1', () => console.log(server.address().port));
`;
async function startFakeEmbeddings({ delayMs = 0 } = {}) {
  const child = spawn(process.execPath, ['-e', FAKE_EMBEDDINGS], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, DELAY_MS: String(delayMs) } });
  const port = await new Promise((resolve) => child.stdout.once('data', (d) => resolve(Number(String(d).trim()))));
  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    calls: async () => Number(await (await fetch(`${url}/calls`)).text()),
    // 被信号杀掉的进程 exitCode 是 null、signalCode 才有值
    close: () => new Promise((resolve) => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else { child.once('exit', resolve); child.kill(); } }),
  };
}

test('semantic layer, pins, multi-agent installs and ash doctor end to end', async (t) => {
  const fake = await startFakeEmbeddings();
  const server = await startServer({ ASH_EMBED_URL: fake.url, ASH_EMBED_MODEL: 'fake', ASH_EMBED_TIMEOUT_MS: '2000' });
  const { origin } = server;
  t.after(async () => { await server.stop(); await fake.close(); });
  const work = tmpDir('ash-sem-');
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

  await t.test('a Chinese skill and its English twin are caught as duplicates without any translation', async () => {
    ok(['push', writeSkill(md('name: db-rollback\ndescription: 数据库迁移失败时回滚，恢复到迁移前的状态', '# 数据库迁移回滚\n\n## 回滚步骤\n\n## 验证数据'))]);
    await approve('db-rollback');
    const out = ok(['push', writeSkill(md('name: migration-revert\ndescription: Revert a failed database migration and roll back the schema', '# Database migration rollback\n\n## Rollback\n\n## Verify'))]).stdout;
    assert.match(out, /库中已有相近技能：db-rollback（疑似重复，语义相似度 \d+%）/);
    const d = await detail('migration-revert');
    assert.equal(d.similar[0].slug, 'db-rollback');
    assert.equal(d.similar[0].semantic, true);
    assert.ok(await fake.calls() > 0, 'vectors come from the configured embedding service');
  });

  await t.test('a Chinese task description finds the English skill', async () => {
    await approve('migration-revert');
    ok(['push', writeSkill(md('name: vercel-ship\ndescription: Deploy the site to Vercel and share the preview link', '# Deploy to Vercel'))]);
    await approve('vercel-ship');
    const out = ok(['suggest', '把网站部署上线']).stdout;
    assert.match(out, /vercel-ship/);
    const json = await (await fetch(`${origin}/api/agent/suggest?q=${encodeURIComponent('数据库回滚')}`)).json();
    assert.ok(json.results.some((r) => r.slug === 'migration-revert'), 'the English skill is found for a Chinese query');
  });

  await t.test('when the embedding service is down, search still answers from text', async () => {
    await fake.close();
    const res = await fetch(`${origin}/api/agent/suggest?q=${encodeURIComponent('数据库迁移回滚')}&format=text`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /db-rollback/);
  });

  const v1 = md('name: toolkit\ndescription: 常用工具包 common toolkit for daily tasks\nversion: 1.0.0', '# 工具包 v1\n\n第一版');
  const v2 = v1.replace('version: 1.0.0', 'version: 2.0.0').replace('第一版', '第二版');
  await t.test('pinned versions install from history and are left alone by pull --all', async () => {
    ok(['push', writeSkill(v1)]);
    await approve('toolkit');
    ok(['push', writeSkill(v2), '--update']);
    await approve('toolkit');
    const dir = path.join(work, 'pinned');
    ok(['pull', 'toolkit@1.0.0', '--dir', dir]);
    assert.match(fs.readFileSync(path.join(dir, 'toolkit', 'SKILL.md'), 'utf8'), /第一版/);
    assert.match(fs.readFileSync(path.join(dir, 'toolkit', '.ash'), 'utf8'), /^pinned=1\.0\.0$/m);
    assert.match(ok(['installed', '--dir', dir]).stdout, /固定在 v1\.0\.0（库里当前 v2\.0\.0）/);
    assert.match(ok(['outdated', '--dir', dir]).stdout, /都是最新的/);
    ok(['pull', '--all', '--dir', dir]);
    assert.match(fs.readFileSync(path.join(dir, 'toolkit', 'SKILL.md'), 'utf8'), /第一版/, 'pull --all does not upgrade a pinned skill');
    assert.match(ok(['show', 'toolkit@1.0.0']).stdout, /第一版/);
    const missing = ash(['pull', 'toolkit@9.9.9', '--dir', path.join(work, 'nope')]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /没有 9\.9\.9 版本/);
  });

  await t.test('a dependency pinned to an old version is installed at that version', async () => {
    ok(['push', writeSkill(md('name: uses-old\ndescription: 用旧版工具包 uses the old toolkit\ndepends_on: ["toolkit@1.0.0"]', '# 用旧版\n\n> 用元技能 `toolkit`'))]);
    await approve('uses-old');
    const dir = path.join(work, 'deps');
    ok(['pull', 'uses-old', '--dir', dir]);
    assert.match(fs.readFileSync(path.join(dir, 'toolkit', 'SKILL.md'), 'utf8'), /第一版/);
    const lint = (await detail('uses-old')).lint.map((i) => i.code);
    assert.ok(lint.includes('pin-old') && !lint.includes('pin-missing'));
  });

  const store = path.join(home, '.ash', 'skills');
  const linkOf = (rel) => {
    const st = fs.lstatSync(path.join(home, rel), { throwIfNoEntry: false });
    return st?.isSymbolicLink() ? fs.readlinkSync(path.join(home, rel)) : null;
  };

  await t.test('skills are stored once in ~/.ash/skills and linked into every agent, dependencies included', async () => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
    ok(['pull', 'uses-old', '--agent', 'all']);
    assert.ok(fs.existsSync(path.join(store, 'uses-old', '.ash')), 'one real copy in the shared store');
    for (const root of ['.claude/skills', '.agents/skills']) {
      assert.equal(linkOf(`${root}/uses-old`), path.join(store, 'uses-old'), `linked for ${root}`);
      assert.equal(linkOf(`${root}/toolkit`), path.join(store, 'toolkit'), `dependency linked next to it in ${root}`);
      assert.match(fs.readFileSync(path.join(home, root, 'toolkit', 'SKILL.md'), 'utf8'), /第一版/, 'the pinned dependency is what the link points at');
    }
    ok(['pull', 'vercel-ship'], { ASH_AGENT: 'claude' });
    assert.equal(linkOf('.claude/skills/vercel-ship'), path.join(store, 'vercel-ship'), 'ASH_AGENT picks which agents get the link');
    assert.ok(!fs.existsSync(path.join(home, '.agents/skills/vercel-ship')));
    ok(['pull', 'vercel-ship']);
    assert.equal(linkOf('.agents/skills/vercel-ship'), path.join(store, 'vercel-ship'), 'by default every agent on the machine gets the link');

    const installed = ok(['installed']).stdout;
    assert.equal(installed.match(/^uses-old /gm).length, 1, 'a skill linked into two agents is listed once');
    assert.match(installed, /uses-old .*\.ash\/skills\/uses-old\n   ↳ 链接给：(Claude Code |Codex ){2}/);
  });

  await t.test('pull never replaces a link that another tool owns', () => {
    const upstream = path.join(work, 'upstream-vercel-ship');
    fs.mkdirSync(upstream);
    fs.writeFileSync(path.join(upstream, 'SKILL.md'), '# upstream\n');
    fs.rmSync(path.join(home, '.claude/skills/vercel-ship'));
    fs.symlinkSync(upstream, path.join(home, '.claude/skills/vercel-ship'));
    const r = ok(['pull', 'vercel-ship']);
    assert.match(r.stderr, /不是 ash 建的，没有改动/);
    assert.equal(linkOf('.claude/skills/vercel-ship'), upstream);
    fs.rmSync(path.join(home, '.claude/skills/vercel-ship'));
    ok(['pull', 'vercel-ship']);
  });

  await t.test('ash doctor finds references that are not linked next to the skill, and --fix repairs them', () => {
    assert.match(ok(['doctor']).stdout, /✅ 没有发现问题/);
    fs.rmSync(path.join(home, '.claude/skills/toolkit'));
    const broken = ash(['doctor']);
    assert.equal(broken.status, 1);
    assert.match(broken.stdout, /\.ash\/skills（共享存储/);
    assert.match(broken.stdout, /uses-old 引用的 toolkit 没有链接进 .*\.claude\/skills/);
    assert.match(ok(['doctor', '--fix']).stdout, /已把 toolkit 链接进 .*\.claude\/skills/);
    assert.match(fs.readFileSync(path.join(home, '.claude/skills/toolkit/SKILL.md'), 'utf8'), /第一版/, '--fix respects the pin');
    assert.match(ok(['doctor']).stdout, /✅ 没有发现问题/);
    const custom = ash(['doctor', '--dir', path.join(work, 'deps')]);
    assert.match(custom.stdout, /没有 Agent 从这里加载/);
  });

  await t.test('remove deletes the stored copy and every link to it', () => {
    ok(['remove', 'vercel-ship']);
    assert.ok(!fs.existsSync(path.join(store, 'vercel-ship')));
    for (const root of ['.claude/skills', '.agents/skills']) {
      assert.ok(!fs.existsSync(path.join(home, root, 'vercel-ship')) && !linkOf(`${root}/vercel-ship`), `link removed from ${root}`);
    }
  });

  await t.test('renamed skills redirect, and ash migrate moves everything into the shared store', async () => {
    // 库里把 vercel-ship 改名为 site-ship：旧名进废纸篓并登记去向
    ok(['push', writeSkill(md('name: site-ship\ndescription: Deploy the site to Vercel 部署站点', '# Site ship'))]);
    await approve('site-ship');
    const put = await fetch(`${origin}/api/agent/redirects`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ old_slug: 'vercel-ship', new_slug: 'site-ship' }),
    });
    assert.equal(put.status, 200);
    // 改名前装进 Agent 目录的旧名（老版本 ash 的布局：文件直接在 Agent 目录里）
    const hermes = path.join(home, '.hermes', 'skills');
    ok(['pull', 'vercel-ship', '--dir', hermes]);
    assert.equal((await fetch(`${origin}/api/skills/${(await detail('vercel-ship')).id}/trash`, { method: 'POST' })).status, 200);
    assert.match(ash(['info', 'vercel-ship']).stderr, /已改名或并入 site-ship/);
    assert.match(ok(['installed']).stdout, /vercel-ship .*已改名为 site-ship/);

    // 老布局：ash 装的 migration-revert 直接在 Agent 目录里，且有本地修改
    const codex = path.join(home, '.agents', 'skills');
    ok(['pull', 'migration-revert', '--dir', codex]);
    fs.appendFileSync(path.join(codex, 'migration-revert', 'SKILL.md'), '\n本地笔记\n');
    // 手动复制进 Hermes 分类子目录的库技能副本，以及一个库里没有的技能
    fs.mkdirSync(path.join(hermes, 'devops', 'db-rollback'), { recursive: true });
    fs.writeFileSync(path.join(hermes, 'devops', 'db-rollback', 'SKILL.md'), '# 手抄的旧版\n');
    fs.mkdirSync(path.join(hermes, 'my-own'), { recursive: true });
    fs.writeFileSync(path.join(hermes, 'my-own', 'SKILL.md'), '# 自己写的\n');

    const plan = ok(['migrate']).stdout;
    assert.match(plan, /搬进存储 .*\.agents\/skills\/migration-revert/);
    assert.match(plan, /换成新版 .*\.hermes\/skills\/vercel-ship → site-ship/);
    assert.match(plan, /替换副本 .*\.hermes\/skills\/devops\/db-rollback → 库里的 db-rollback/);
    assert.doesNotMatch(plan, /my-own/, 'skills the hub does not have are left alone');
    assert.ok(fs.existsSync(path.join(hermes, 'vercel-ship', '.ash')), 'without --apply nothing changes');
    assert.doesNotMatch(ok(['migrate', '--keep-copies']).stdout, /db-rollback/);

    ok(['migrate', '--apply']);
    assert.equal(linkOf('.agents/skills/migration-revert'), path.join(store, 'migration-revert'));
    assert.match(fs.readFileSync(path.join(store, 'migration-revert', 'SKILL.md'), 'utf8'), /本地笔记/, 'ash installs move as-is, local edits kept');
    assert.equal(linkOf('.hermes/skills/site-ship'), path.join(store, 'site-ship'));
    assert.ok(!fs.existsSync(path.join(hermes, 'vercel-ship')), 'the old name is gone');
    assert.equal(linkOf('.hermes/skills/db-rollback'), path.join(store, 'db-rollback'), 'nested copies are linked at the top level');
    assert.ok(!fs.existsSync(path.join(hermes, 'devops', 'db-rollback')));
    const backups = fs.readdirSync(path.join(home, '.ash', 'backups'));
    assert.ok(backups.some((b) => b.startsWith('db-rollback-')) && backups.some((b) => b.startsWith('vercel-ship-')), 'replaced copies are backed up');
    assert.ok(fs.existsSync(path.join(hermes, 'my-own', 'SKILL.md')));
    assert.match(ok(['migrate']).stdout, /没有需要迁移的技能/, 'migrate is idempotent');
  });

  await t.test('a skill renamed after it was installed into the store is relinked under its new name', async () => {
    ok(['push', writeSkill(md('name: rollback-v2\ndescription: 数据库迁移回滚第二版 database rollback v2', '# 回滚 v2'))]);
    await approve('rollback-v2');
    ok(['pull', 'db-rollback', '--agent', 'all']);
    await fetch(`${origin}/api/agent/redirects`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ old_slug: 'db-rollback', new_slug: 'rollback-v2' }),
    });
    assert.equal((await fetch(`${origin}/api/skills/${(await detail('db-rollback')).id}/trash`, { method: 'POST' })).status, 200);
    assert.match(ok(['migrate']).stdout, /换成新名 .*\.claude\/skills\/db-rollback → rollback-v2/);
    ok(['migrate', '--apply']);
    for (const root of ['.claude/skills', '.agents/skills', '.hermes/skills']) {
      assert.equal(linkOf(`${root}/rollback-v2`), path.join(store, 'rollback-v2'), `new name linked in ${root}`);
      assert.equal(linkOf(`${root}/db-rollback`), null, `old link gone from ${root}`);
    }
    assert.ok(!fs.existsSync(path.join(store, 'db-rollback')), 'the old stored copy is moved to backups');
    assert.match(ok(['migrate']).stdout, /没有需要迁移的技能/);
  });

  await t.test('ash lint --only narrows to one kind of problem', () => {
    const out = ok(['lint', '--only', 'bilingual']).stdout;
    assert.match(out, /rollback-v2\n.*缺少英文描述/);
    assert.doesNotMatch(out, /pin-old|历史版本/);
  });
});

// 线上实测：繁忙服务器的 CPU 上 bge-m3 每条要好几秒。后台补齐不能因为「整批超时」永远补不上，
// 找技能也不能被慢模型拖住
test('a slow embedding model still gets every vector, and never slows down suggest', async (t) => {
  const fake = await startFakeEmbeddings({ delayMs: 800 });
  const server = await startServer({ ASH_EMBED_URL: fake.url, ASH_EMBED_MODEL: 'fake', ASH_EMBED_TIMEOUT_MS: '300', ASH_EMBED_QUERY_TIMEOUT_MS: '300' });
  t.after(async () => { await server.stop(); await fake.close(); });
  const detail = await (await fetch(`${server.origin}/api/skills/systematic-debugging`)).json();
  assert.ok(detail.id);
  const Database = require('better-sqlite3');
  const count = () => {
    const db = new Database(path.join(server.env.DATA_DIR, 'another-skillhub.db'), { readonly: true });
    try { return db.prepare('SELECT COUNT(*) AS n FROM skill_embeddings').get().n; } finally { db.close(); }
  };
  for (let i = 0; i < 40 && count() < 3; i += 1) await new Promise((r) => setTimeout(r, 250));
  assert.equal(count(), 3, 'batches get a per-text allowance instead of the short request timeout');
  const started = Date.now();
  const res = await fetch(`${server.origin}/api/agent/suggest?q=${encodeURIComponent('测试失败找根因')}&format=text`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /systematic-debugging/, 'falls back to text matching');
  assert.ok(Date.now() - started < 700, `suggest does not wait for the slow model (${Date.now() - started}ms)`);
});
