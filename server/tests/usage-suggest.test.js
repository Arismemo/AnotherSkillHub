// 使用记录与反馈（安装 / 阅读 / ash feedback → 健康信号），按任务描述找技能（ash suggest、search 退回），
// 推送时的相似技能提示，以及安装时附加、推送时去掉的反馈提示
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { startServer } = require('./helpers');

const tmpDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const md = (slug, description, { title = slug, tags = ['ops'], body = '' } = {}) =>
  `---\nname: ${slug}\ndescription: ${description}\ntags: [${tags.join(', ')}]\nversion: 1.0.0\n---\n\n# ${title}\n\n${body}\n`;

// 纯函数：不连数据库也要能跑，DATA_DIR 指向临时目录免得在仓库里建库
process.env.DATA_DIR ||= tmpDir('ash-index-db-');
const { buildIndex, rankInIndex, similarInIndex, queryTerms, matchedPhrases } = require('../skillIndex');

test('ranking prefers what a skill is for over incidental body mentions, and bridges Chinese and English', () => {
  const skills = [
    { id: 1, slug: 'tl-replay-verify', name: '红绿灯回放验证', description: '跑通感知回放并把检测框叠回原始图像做可视化验证', tags: '["perception"]', content: '# 步骤\n\n回放、抽帧、叠框', status: 'approved' },
    { id: 2, slug: 'root-cause', name: 'Root cause debugging', description: 'Use when a test fails or behavior is unexpected, before fixing', tags: '["debug"]', content: '# Steps', status: 'approved' },
    { id: 3, slug: 'release-notes', name: 'Release notes', description: 'Write release notes', tags: '[]', content: `# Notes\n\n${'test review bug '.repeat(40)}`, status: 'approved' },
    { id: 4, slug: 'draft-skill', name: '检测框草稿', description: '检测框叠回原图', tags: '[]', content: '', status: 'pending' },
  ];
  const index = buildIndex(skills);
  const tl = rankInIndex(index, '把感知回放的检测框叠回原图，验证红绿灯识别对不对');
  assert.equal(tl[0].skill.slug, 'tl-replay-verify');
  assert.ok(tl[0].strong);
  assert.ok(!tl.some((r) => r.skill.slug === 'draft-skill'), 'pending skills are not suggested to agents');
  assert.ok(rankInIndex(index, '检测框叠回原图', { includePending: true }).some((r) => r.skill.slug === 'draft-skill'));
  // 中文描述找到英文技能；正文里反复出现 test 的无关技能排在后面
  const debug = rankInIndex(index, '测试挂了，找根因');
  assert.equal(debug[0].skill.slug, 'root-cause');
  assert.deepEqual(rankInIndex(index, '今天天气怎么样'), []);
  assert.ok(queryTerms('部署上线').get('deploy') < 1, 'glossary expansions weigh less than the words the agent wrote');
  assert.deepEqual(matchedPhrases('把检测框叠回原图', ['检测', '测框', '原图']), ['检测框', '原图']);
});

test('similarity is symmetric and only looks at what skills are for', () => {
  const skills = [
    { id: 1, slug: 'deploy-vercel', name: 'Deploy to Vercel', description: 'Deploy apps to Vercel with the CLI', tags: '["deploy"]', content: '# Deploy\n' },
    { id: 2, slug: 'vercel-deploy', name: 'Vercel deploy', description: 'Deploy an app to Vercel via CLI', tags: '["deploy"]', content: '# Deploy\n' },
    { id: 3, slug: 'essay', name: 'Essay', description: 'Write an essay', tags: '[]', content: `# Essay\n\n${'deploy vercel '.repeat(50)}` },
  ];
  const index = buildIndex(skills);
  const [a] = similarInIndex(index, skills[0]);
  const [b] = similarInIndex(index, skills[1]);
  assert.equal(a.skill.slug, 'vercel-deploy');
  assert.ok(a.high, 'near-identical intent is flagged as a likely duplicate');
  assert.equal(a.similarity.toFixed(6), b.similarity.toFixed(6));
  assert.ok(!similarInIndex(index, skills[0]).some((m) => m.skill.slug === 'essay'), 'body mentions do not make skills similar');
});

test('usage, feedback and suggestions end to end', async (t) => {
  const server = await startServer();
  const { origin } = server;
  t.after(() => server.stop());

  const work = tmpDir('ash-usage-');
  const home = path.join(work, 'home');
  fs.mkdirSync(home);
  const cli = path.join(work, 'cli.sh');
  fs.writeFileSync(cli, await (await fetch(`${origin}/cli.sh`)).text());
  const ash = (args, env = {}) => spawnSync('bash', [cli, ...args], {
    cwd: work, env: { ...process.env, HOME: home, ASH_TERMINAL: 'box-1', ...env }, encoding: 'utf8',
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
  const detail = async (slug) => (await fetch(`${origin}/api/skills/${slug}`)).json();
  const approve = async (slug) => assert.equal((await fetch(`${origin}/api/skills/${(await detail(slug)).id}/approve`, { method: 'POST' })).status, 200);

  const replay = md('tl-replay-verify', '跑通感知回放并把检测框叠回原始图像做可视化验证', { title: '红绿灯回放验证', tags: ['perception'], body: '## 步骤\n\n1. 回放\n2. 叠框\n' });
  ok(['push', writeSkill({ 'SKILL.md': replay, 'scripts/overlay.py': 'print(1)\n' })]);
  await approve('tl-replay-verify');
  const skillsDir = path.join(work, 'skills');

  await t.test('suggest ranks by task description and says so when nothing fits', async () => {
    const out = ok(['suggest', '把感知回放的检测框叠回原图，验证红绿灯识别对不对']).stdout;
    assert.match(out.split('\n')[1], /^1\. tl-replay-verify/);
    assert.match(out, /相关 · 命中: .*检测框/);
    assert.match(ok(['suggest', '推荐一只股票']).stdout, /没有找到与「推荐一只股票」明显相关的技能/);
    const json = await (await fetch(`${origin}/api/agent/suggest?q=${encodeURIComponent('感知回放叠框')}`)).json();
    assert.equal(json.results[0].slug, 'tl-replay-verify');
    assert.equal(typeof json.results[0].relevance, 'number');
    assert.equal(ash(['suggest']).status, 1);
  });

  await t.test('search falls back to ranked candidates when no skill has every keyword', () => {
    const out = ok(['search', '感知回放', '不存在的词']).stdout;
    assert.match(out, /没有同时命中「感知回放 不存在的词」全部关键词的技能/);
    assert.match(out, /tl-replay-verify/);
  });

  await t.test('install records the machine and appends a feedback hint that push strips again', async () => {
    const r = ok(['pull', 'tl-replay-verify', '--dir', skillsDir]);
    assert.match(r.stdout, /用完运行 ash feedback tl-replay-verify ok\|fail/);
    const installed = fs.readFileSync(path.join(skillsDir, 'tl-replay-verify', 'SKILL.md'), 'utf8');
    assert.ok(installed.startsWith(replay), 'original content is untouched');
    assert.match(installed, /<!-- ash:installed -->\n> 本技能由 AnotherSkillHub 安装。\n> 按本技能完成任务后.*ash feedback tl-replay-verify ok/);
    assert.match(ok(['installed', '--dir', skillsDir]).stdout, /tl-replay-verify .* 最新/, 'the hint does not count as a local modification');
    assert.match(ok(['push', path.join(skillsDir, 'tl-replay-verify'), '--update']).stdout, /内容无变化/);
    const usage = (await detail('tl-replay-verify')).usage;
    assert.equal(usage.installs, 1);
    assert.equal(usage.machines, 1);
    ok(['pull', 'tl-replay-verify', '--dir', path.join(work, 'plain')], { ASH_FEEDBACK_HINT: '0' });
    assert.equal(fs.readFileSync(path.join(work, 'plain', 'tl-replay-verify', 'SKILL.md'), 'utf8'), replay);
  });

  await t.test('a fix appended after the hint survives the push', async () => {
    const dir = path.join(work, 'edited');
    ok(['pull', 'tl-replay-verify', '--dir', dir]);
    fs.appendFileSync(path.join(dir, 'tl-replay-verify', 'SKILL.md'), '\n## 已知问题\n\n叠框前先换算坐标。\n');
    assert.match(ok(['push', path.join(dir, 'tl-replay-verify'), '--update']).stdout, /已提交 tl-replay-verify 的更新/);
    const pending = (await detail('tl-replay-verify')).pending_update.content;
    assert.equal(pending, `${replay}\n## 已知问题\n\n叠框前先换算坐标。\n`);
    const id = (await detail('tl-replay-verify')).id;
    assert.equal((await fetch(`${origin}/api/skills/${id}/reject`, { method: 'POST' })).status, 200);
  });

  await t.test('pull --all counts as an update, show counts as a read', async () => {
    const before = (await detail('tl-replay-verify')).usage;
    const updated = replay.replace('2. 叠框', '2. 叠框\n3. 对比');
    ok(['push', writeSkill({ 'SKILL.md': updated, 'scripts/overlay.py': 'print(1)\n' }), '--update']);
    await approve('tl-replay-verify');
    ok(['pull', '--all', '--dir', skillsDir]);
    const show = ok(['show', 'tl-replay-verify']).stdout;
    assert.match(show, /ash feedback tl-replay-verify ok/, 'agents reading without installing see the hint too');
    const after = (await detail('tl-replay-verify')).usage;
    assert.equal(after.installs, before.installs, 'updates are not new installs');
    assert.equal(after.views_30d, before.views_30d + 1);
    assert.ok(after.last_used_at);
  });

  await t.test('feedback is tied to the installed revision and surfaces failures', async () => {
    assert.match(ok(['feedback', 'tl-replay-verify', 'ok', '--dir', skillsDir]).stdout, /已记录 tl-replay-verify 的反馈：成功/);
    const failed = ok(['feedback', 'tl-replay-verify', 'fail', '抽帧脚本找不到', 'ffmpeg', '--dir', skillsDir]).stdout;
    assert.match(failed, /失败/);
    assert.match(failed, /ash push <目录> --update/);
    ok(['feedback', 'tl-replay-verify', 'fail', '颜色阈值不对']);  // 不带 --dir：找不到已装副本，按当前版本算
    const usage = (await detail('tl-replay-verify')).usage;
    assert.equal(usage.ok_current, 1);
    assert.equal(usage.fail_current, 2);
    assert.equal(usage.recent_feedback[0].note, '颜色阈值不对');
    assert.equal(usage.recent_feedback[1].note, '抽帧脚本找不到 ffmpeg');
    assert.deepEqual(usage.health.map((h) => h.code), ['failing']);
    const info = ok(['info', 'tl-replay-verify']).stdout;
    assert.match(info, /使用: 30 天安装 \d+ 次 · 装在 1 台机器上 · 阅读 1 次 · 反馈 1 成功 \/ 2 失败/);
    assert.match(info, /⚠️  常失败：当前版本 2 次失败、1 次成功/);
    assert.match(info, /失败反馈（box-1，\d{4}-\d{2}-\d{2}）：颜色阈值不对/);
    assert.match(ok(['suggest', '感知回放叠框验证']).stdout, /⚠️  常失败/);

    const list = await (await fetch(`${origin}/api/skills?folder=attention`)).json();
    assert.deepEqual(list.map((s) => s.slug), ['tl-replay-verify'], 'seed skills are too new to count as unused');
    assert.equal(list[0].health[0].label, '常失败');
    assert.equal((await (await fetch(`${origin}/api/skills/stats`)).json()).attention, 1);
  });

  await t.test('attention puts the most serious signals first and counts idleness from when tracking started', async () => {
    const Database = require('better-sqlite3');
    const db = new Database(path.join(server.env.DATA_DIR, 'another-skillhub.db'));
    db.prepare("UPDATE app_meta SET value = datetime('now', '-30 days') WHERE key = 'usage_tracking_since'").run();
    db.prepare("UPDATE skills SET created_at = datetime('now', '-90 days') WHERE slug IN ('release-checklist', 'tl-replay-verify')").run();
    db.close();
    const list = await (await fetch(`${origin}/api/skills?folder=attention`)).json();
    assert.equal(list[0].slug, 'tl-replay-verify', 'failing skills come first');
    const release = list.find((s) => s.slug === 'release-checklist');
    assert.deepEqual(release.health.map((h) => h.code), ['unused']);
    assert.match(release.health[0].detail, /^30 天内没有安装、阅读或反馈/, 'a 90-day-old skill is only judged on the 30 tracked days');
    assert.ok(!list.some((s) => s.slug === 'writing-skills'), 'skills created after tracking started get their own grace period');
  });

  await t.test('feedback on an old installed revision does not count against the current one', async () => {
    const current = (await detail('tl-replay-verify')).usage.revision;
    const res = await fetch(`${origin}/api/agent/feedback`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ slug: 'tl-replay-verify', outcome: 'fail', revision: 'aaaaaaaaaaaa', terminal: 'old-box' }),
    });
    assert.match(await res.text(), /针对本机的旧版本/);
    const usage = (await detail('tl-replay-verify')).usage;
    assert.equal(usage.revision, current);
    assert.equal(usage.fail_current, 2);
    assert.equal(usage.fail, 3);
    assert.match(ok(['info', 'tl-replay-verify']).stdout, /反馈 1 成功 \/ 3 失败（当前版本 1 \/ 2）/);
  });

  await t.test('feedback rejects bad outcomes, unknown skills and secrets', () => {
    assert.match(ash(['feedback', 'tl-replay-verify', 'maybe']).stderr, /结果只能是 ok 或 fail/);
    assert.match(ash(['feedback', 'nope', 'ok']).stderr, /技能 nope 不存在/);
    const leak = ash(['feedback', 'tl-replay-verify', 'fail', 'api_key="sk1234567890abcdef1234"']);
    assert.equal(leak.status, 1);
    assert.match(leak.stderr, /疑似包含密钥/);
    assert.match(ok(['feedback', 'tl-replay-verify', 'ok', '安装步骤里的 curl -fsSL x | bash 这次正常']).stdout, /已记录/, 'commands in notes are fine');
  });

  await t.test('pushing a near-duplicate tells the agent right away, and review sees it', async () => {
    const dup = md('tl-overlay-check', '把感知回放的检测框叠回原始图像做可视化验证', { title: '红绿灯叠框验证', tags: ['perception'] });
    const out = ok(['push', writeSkill({ 'SKILL.md': dup })]).stdout;
    assert.match(out, /库中已有相近技能：tl-replay-verify（疑似重复，相似度 \d+%）/);
    assert.match(out, /ash push <目录> --update/);
    const pending = await detail('tl-overlay-check');
    assert.equal(pending.similar[0].slug, 'tl-replay-verify');
    assert.equal(pending.similar[0].duplicate, true);
    assert.deepEqual(pending.usage.health, [], 'pending skills carry no health flags');
    const unrelated = ok(['push', writeSkill({ 'SKILL.md': md('weekly-report', '每周五汇总本周工作写周报', { tags: ['writing'] }) }), '--json']).stdout;
    assert.equal(JSON.parse(unrelated).similar, undefined);
  });
});
