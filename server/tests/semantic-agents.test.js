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
  req.on('end', () => {
    calls += 1;
    const { input } = JSON.parse(body || '{}');
    const vectors = (Array.isArray(input) ? input : [input]).map((t) => [...CONCEPTS.map((re) => (String(t).match(re) || []).length), 0.3]);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ embeddings: vectors }));
  });
});
server.listen(0, '127.0.0.1', () => console.log(server.address().port));
`;
async function startFakeEmbeddings() {
  const child = spawn(process.execPath, ['-e', FAKE_EMBEDDINGS], { stdio: ['ignore', 'pipe', 'inherit'] });
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

  await t.test('--agent all installs into every agent on the machine, dependencies included', async () => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
    ok(['pull', 'uses-old', '--agent', 'all']);
    for (const root of ['.claude/skills', '.agents/skills']) {
      assert.ok(fs.existsSync(path.join(home, root, 'uses-old', 'SKILL.md')), `installed for ${root}`);
      assert.ok(fs.existsSync(path.join(home, root, 'toolkit', 'SKILL.md')), `dependency next to it in ${root}`);
    }
    ok(['pull', 'vercel-ship'], { ASH_AGENT: 'all' });
    assert.ok(fs.existsSync(path.join(home, '.agents/skills/vercel-ship/SKILL.md')), 'ASH_AGENT=all is the default when set');
  });

  await t.test('ash doctor finds references that are not next to the skill, and --fix repairs them', () => {
    assert.match(ok(['doctor']).stdout, /✅ 没有发现问题/);
    fs.rmSync(path.join(home, '.claude/skills/toolkit'), { recursive: true });
    const broken = ash(['doctor']);
    assert.equal(broken.status, 1);
    assert.match(broken.stdout, /\.claude\/skills（Claude Code）/);
    assert.match(broken.stdout, /uses-old 引用的 toolkit 不在同一目录/);
    assert.match(ok(['installed']).stdout, /引用的技能不在旁边：toolkit@1\.0\.0/);
    assert.match(ok(['doctor', '--fix']).stdout, /已把 uses-old 引用的 toolkit 装到旁边/);
    assert.match(fs.readFileSync(path.join(home, '.claude/skills/toolkit/SKILL.md'), 'utf8'), /第一版/, '--fix respects the pin');
    assert.match(ok(['doctor']).stdout, /✅ 没有发现问题/);
    const custom = ash(['doctor', '--dir', path.join(work, 'deps')]);
    assert.match(custom.stdout, /没有 Agent 从这里加载/);
  });

  await t.test('ash lint --only narrows to one kind of problem', () => {
    const out = ok(['lint', '--only', 'bilingual']).stdout;
    assert.match(out, /db-rollback\n.*缺少英文描述/);
    assert.doesNotMatch(out, /pin-old|历史版本/);
  });
});
