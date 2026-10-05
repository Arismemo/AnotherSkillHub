// 接入与反馈闭环：两层 Agent 指南、ash import 批量导入并登记为 ash 管理、
// 反馈率指标（/api/skills/insights、ash stats）、Claude Code Stop hook（ash hooks / ash hook claude-stop）
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { startServer } = require('./helpers');

const tmpDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const md = (name, description, { deps = [] } = {}) =>
  `---\nname: ${name}\ndescription: ${description}\nversion: 1.0.0\n${deps.length ? `depends_on: [${deps.join(', ')}]\n` : ''}---\n\n# ${name}\n\nsteps\n`;
const writeSkill = (dir, files) => {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
};

test('onboarding and the feedback loop', async (t) => {
  const server = await startServer();
  const { origin } = server;
  t.after(() => server.stop());

  const work = tmpDir('ash-loop-');
  const home = path.join(work, 'home');
  fs.mkdirSync(home);
  const cli = path.join(work, 'cli.sh');
  fs.writeFileSync(cli, await (await fetch(`${origin}/cli.sh`)).text());
  const ash = (args, { env = {}, input } = {}) => spawnSync('bash', [cli, ...args], {
    cwd: work, env: { ...process.env, HOME: home, ASH_TERMINAL: 'laptop', ...env }, encoding: 'utf8', input,
  });
  const ok = (args, opts) => {
    const r = ash(args, opts);
    assert.equal(r.status, 0, `ash ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`);
    return r;
  };
  const skill = async (slug) => (await fetch(`${origin}/api/skills/${slug}`)).json();
  const approve = async (slug) => assert.equal((await fetch(`${origin}/api/skills/${(await skill(slug)).id}/approve`, { method: 'POST' })).status, 200);

  const claude = path.join(home, '.claude', 'skills');
  const codex = path.join(home, '.agents', 'skills');
  writeSkill(path.join(claude, 'deploy-kit'), { 'SKILL.md': md('deploy-kit', '部署服务时使用 deploy', { deps: ['release-check'] }), 'scripts/run.sh': 'echo deploy\n' });
  writeSkill(path.join(claude, 'release-check'), { 'SKILL.md': md('release-check', '发布前检查 release checklist'), 'references/list.md': '# list\n' });
  // Codex 目录里另有一份内容完全相同的 release-check：不必提示
  writeSkill(path.join(codex, 'release-check'), { 'SKILL.md': md('release-check', '发布前检查 release checklist'), 'references/list.md': '# list\n' });
  writeSkill(path.join(codex, 'deploy-kit'), { 'SKILL.md': md('deploy-kit', '同一个技能在 Codex 目录里的副本') });
  writeSkill(path.join(claude, 'My_Notes'), { 'SKILL.md': md('my-notes', '记笔记 notes') });
  writeSkill(path.join(claude, 'already'), { 'SKILL.md': md('already', '已由 ash 安装'), '.ash': 'slug=already\n' });

  await t.test('the agent guide has a short core and a full reference', async () => {
    const core = await (await fetch(`${origin}/agent.md`)).text();
    const full = await (await fetch(`${origin}/agent-full.md`)).text();
    assert.ok(Buffer.byteLength(core) < 3500, `core guide should stay short, got ${Buffer.byteLength(core)} bytes`);
    assert.ok(Buffer.byteLength(full) > 3 * Buffer.byteLength(core));
    for (const must of ['ash suggest', 'ash feedback', 'ash push', 'ash guide --full', 'ash login']) assert.ok(core.includes(must), must);
    assert.match(full, /## 技能之间的引用/);
    assert.match(full, /ash import/);
    assert.equal(await (await fetch(`${origin}/agent.md?full=1`)).text(), full);
    assert.equal(await (await fetch(`${origin}/llms.txt`)).text(), core);
    assert.match(ok(['guide', '--full']).stdout, /什么时候提炼元技能/);
    assert.doesNotMatch(ok(['guide']).stdout, /什么时候提炼元技能/);
  });

  await t.test('insights start empty', async () => {
    const empty = await (await fetch(`${origin}/api/skills/insights`)).json();
    assert.equal(empty.uses, 0);
    assert.equal(empty.feedback_rate, null);
    assert.match(ok(['stats']).stdout, /还没有使用记录/);
  });

  await t.test('import --dry-run lists what would be imported and changes nothing', async () => {
    const out = ok(['import', '--dry-run']).stdout;
    assert.match(out, /· deploy-kit/);
    assert.match(out, /· release-check/);
    assert.match(out, /· my-notes/);
    // 同名副本：内容不同要提示导入的是哪一份、怎么换成另一份；内容相同只说跳过
    assert.match(out, /claude\/skills\/deploy-kit：与 .*agents\/skills\/deploy-kit 同名（deploy-kit）但内容不同，没有导入这一份；.*ash import '.*claude\/skills\/deploy-kit' --update/);
    assert.match(out, /claude\/skills\/release-check：与 .*agents\/skills\/release-check 内容相同，跳过/);
    assert.doesNotMatch(out, /already/, 'dirs already managed by ash are skipped silently');
    assert.equal((await fetch(`${origin}/api/skills/deploy-kit`)).status, 404);
  });

  await t.test('import pushes every local skill once and adopts dirs named after their slug', async () => {
    const out = ok(['import']).stdout;
    assert.match(out, /完成：导入 3 个，更新 0 个，无变化 0 个，已在库里 0 个，已由 ash 管理 1 个，失败 0 个/);
    assert.match(out, /3 个新技能在待审核/);
    assert.match(out, /my-notes：已导入（待审核）（目录名与 slug my-notes 不同，未登记为 ash 管理）/);
    const deploy = await skill('deploy-kit');
    assert.equal(deploy.status, 'pending');
    assert.equal(deploy.terminal_source, 'laptop');
    assert.ok((await skill('release-check')).file_tree.some((f) => f.path === 'references/list.md'), 'attached files are imported');

    // 先扫到的副本（Codex 目录）被导入并登记，另一个目录里的同名副本跳过且不登记
    const adopted = [path.join(codex, 'deploy-kit'), path.join(codex, 'release-check')];
    for (const dir of adopted) assert.match(fs.readFileSync(path.join(dir, '.ash'), 'utf8'), /adopted=1/);
    assert.ok(!fs.existsSync(path.join(claude, 'deploy-kit', '.ash')));
    assert.ok(!fs.existsSync(path.join(claude, 'release-check', '.ash')));
    assert.ok(!fs.existsSync(path.join(claude, 'My_Notes', '.ash')));
    const meta = fs.readFileSync(path.join(codex, 'release-check', '.ash'), 'utf8');
    assert.match(meta, new RegExp(`server=${origin.replace(/[.]/g, '\\.')}`));
    assert.match(meta, /pending=1/);

    const installed = ok(['installed']).stdout;
    assert.match(installed, /release-check {2}· {2}v1\.0\.0 {2}· {2}最新（仍在待审核）/);
  });

  await t.test('adopted skills follow the library after review', async () => {
    await approve('release-check');
    assert.match(ok(['installed']).stdout, /release-check .*最新 /);
    assert.doesNotMatch(ok(['installed']).stdout, /release-check .*待审核/);
  });

  await t.test('re-import skips skills already in the library unless --update', async () => {
    // Claude 目录里那份没有被导入、也没有登记：在它上面改一步，再作为更新提交
    fs.appendFileSync(path.join(claude, 'release-check', 'SKILL.md'), '\n4. 新增一步\n');
    const again = ok(['import', claude]).stdout;
    assert.match(again, /= release-check：已在库里，跳过/);
    assert.match(again, /= deploy-kit：已在库里/);
    const updated = ok(['import', path.join(claude, 'release-check'), '--update']).stdout;
    assert.match(updated, /release-check：已提交更新（待审核）（已登记为 ash 管理）/);
    assert.ok((await skill('release-check')).pending_update, 'the local edit waits for review');
  });

  await t.test('import fails cleanly without a token', () => {
    const r = ash(['import', claude], { env: { ASH_TOKEN: 'ash_invalid' } });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /ash login/);
  });

  await approve('deploy-kit');
  await approve('my-notes');
  await approve('release-check');

  await t.test('ash hooks install edits Claude Code settings idempotently and keeps other hooks', () => {
    const settings = path.join(home, '.claude', 'settings.json');
    fs.writeFileSync(settings, JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } }));
    assert.notEqual(ash(['hooks', 'status']).status, 0);
    ok(['hooks', 'install']);
    ok(['hooks', 'install']);
    const cfg = JSON.parse(fs.readFileSync(settings, 'utf8'));
    assert.equal(cfg.model, 'opus');
    const commands = cfg.hooks.Stop.flatMap((g) => g.hooks.map((h) => h.command));
    assert.equal(commands.filter((c) => c.includes('hook claude-stop')).length, 1, 'installing twice leaves one hook');
    assert.ok(commands.includes('say done'));
    assert.ok(commands.find((c) => c.includes('hook claude-stop')).startsWith(`'${cli}'`), 'the hook calls this ash by absolute path');
    assert.ok(fs.existsSync(`${settings}.ash-bak`));
    assert.match(ok(['hooks', 'status']).stdout, /已安装/);
    ok(['hooks', 'uninstall']);
    const after = JSON.parse(fs.readFileSync(settings, 'utf8'));
    assert.deepEqual(after.hooks.Stop.flatMap((g) => g.hooks.map((h) => h.command)), ['say done']);
  });

  // 模拟一份 Claude Code 会话记录：调用了 deploy-kit（Skill 工具）、读了 release-check 的 SKILL.md、
  // 只对 deploy-kit 运行过 ash feedback。release-check 的 SKILL.md 末尾那行「ash feedback release-check ok」提示不能算作回报
  const transcript = path.join(work, 'session.jsonl');
  const line = (content) => JSON.stringify({ type: 'assistant', message: { content } });
  fs.writeFileSync(transcript, [
    line([{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'deploy-kit' } }]),
    line([{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: path.join(claude, 'release-check', 'SKILL.md') } }]),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: '> 按本技能完成任务后，请运行 `ash feedback release-check ok`' }] } }),
    line([{ type: 'tool_use', id: 't3', name: 'Read', input: { file_path: path.join(claude, 'My_Notes', 'SKILL.md') } }]),
    line([{ type: 'tool_use', id: 't4', name: 'Bash', input: { command: 'ash feedback deploy-kit ok', description: 'report' } }]),
  ].join('\n') + '\n');
  const stopInput = (extra = {}) => JSON.stringify({ session_id: 'sess-1', transcript_path: transcript, hook_event_name: 'Stop', stop_hook_active: false, ...extra });
  const useEvents = async (slug) => (await skill(slug)).usage.uses_30d;

  await t.test('the Stop hook records uses and reminds once about skills used without feedback', async () => {
    // deploy-kit 的本地副本在 Codex 目录：按名字在各 Agent 目录里找 ash 装的那一份
    const r = ok(['hook', 'claude-stop'], { input: stopInput() });
    const decision = JSON.parse(r.stdout);
    assert.equal(decision.decision, 'block');
    assert.match(decision.reason, /release-check/);
    assert.doesNotMatch(decision.reason, /deploy-kit/, 'deploy-kit already got feedback in this session');
    assert.doesNotMatch(decision.reason, /my-notes/, 'skills not managed by ash are ignored');
    assert.equal(await useEvents('deploy-kit'), 1);
    assert.equal(await useEvents('release-check'), 1);
    assert.equal(await useEvents('my-notes'), 0);
    assert.match(ok(['info', 'release-check']).stdout, /Agent 调用 1 次/);

    const again = ok(['hook', 'claude-stop'], { input: stopInput() });
    assert.equal(again.stdout, '', 'one reminder per skill per session');
    assert.equal(await useEvents('release-check'), 1, 'one use per skill per session');
  });

  await t.test('the Stop hook stays quiet when continuing, when disabled, and on bad input', async () => {
    assert.equal(ok(['hook', 'claude-stop'], { input: stopInput({ session_id: 'sess-2', stop_hook_active: true }) }).stdout, '');
    assert.equal(await useEvents('release-check'), 2, 'uses are still recorded while continuing');
    assert.equal(ok(['hook', 'claude-stop'], { input: stopInput({ session_id: 'sess-3' }), env: { ASH_HOOK_REMIND: '0' } }).stdout, '');
    assert.equal(ok(['hook', 'claude-stop'], { input: 'not json' }).stdout, '');
    assert.equal(ok(['hook', 'claude-stop'], { input: stopInput({ session_id: 'sess-4', transcript_path: '/nope.jsonl' }) }).stdout, '');
    // 服务不可达时 hook 也不能失败，否则会打断 Agent
    assert.equal(ash(['hook', 'claude-stop'], { input: stopInput({ session_id: 'sess-5' }), env: { ASH_SERVER_URL: 'http://127.0.0.1:9' } }).status, 0);
  });

  await t.test('/api/agent/used ignores unknown skills and bad slugs', async () => {
    const res = await fetch(`${origin}/api/agent/used`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'slug=deploy-kit&slug=ghost&slug=..%2Fx&terminal=box',
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /已记录 1 个技能的使用：deploy-kit/);
    assert.equal((await fetch(`${origin}/api/agent/used`, { method: 'POST' })).status, 400);
  });

  await t.test('insights report the feedback rate per machine and flag silent ones', async () => {
    // 再从另一台机器装 5 次、从不回报
    for (let i = 0; i < 5; i += 1) ok(['pull', 'my-notes', '--dir', path.join(work, `box-${i}`), '--no-deps'], { env: { ASH_TERMINAL: 'gpu-box' } });
    ok(['feedback', 'deploy-kit', 'ok']);
    const insights = await (await fetch(`${origin}/api/skills/insights`)).json();
    // 使用：laptop 三个会话（sess-1/2/3）各调用 deploy-kit、release-check 一次 = 6；box 1；gpu-box 安装 5 次 → 12；反馈 1
    assert.equal(insights.uses, 12);
    assert.equal(insights.feedback, 1);
    assert.equal(insights.ok, 1);
    assert.equal(Math.round(insights.feedback_rate * 100), 8);
    assert.equal(insights.low_feedback, true);
    assert.deepEqual(insights.silent_terminals.sort(), ['box', 'gpu-box']);
    const laptop = insights.terminals.find((x) => x.terminal === 'laptop');
    assert.equal(laptop.hook, true);
    assert.equal(insights.terminals.find((x) => x.terminal === 'gpu-box').hook, false);
    const text = ok(['stats']).stdout;
    assert.match(text, /近 30 天：使用 12 次.*反馈率 8%/);
    assert.match(text, /gpu-box {2}· {2}使用 5 {2}· {2}反馈 0/);
    assert.match(text, /ash hooks install/);
    assert.equal((await (await fetch(`${origin}/api/skills/insights?days=0`)).json()).days, 30, 'bad windows fall back to 30 days');
  });
});
