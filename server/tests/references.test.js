// 技能之间的引用、元技能检查、重复的步骤、双语描述：纯函数规则 + 端到端（推送提示、ash lint、安装后本地能找到被引用的技能）
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { startServer } = require('./helpers');

const tmpDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
process.env.DATA_DIR ||= tmpDir('ash-refs-db-');
const { parseReference, declaredDependencies, normalizeSkillMeta, missingLanguages } = require('../skillMeta');
const { normalizeCommand, extractCommands, sharedRuns } = require('../skillSteps');
const { analyzeLibrary, lintSkill, structuralFlags, analyzeSkill } = require('../skillRefs');
const { buildIndex, similarInIndex } = require('../skillIndex');

const fence = (lines) => `\`\`\`bash\n${lines.join('\n')}\n\`\`\``;
const BUILD = ['ssh dev@10.0.0.8', 'docker exec -it devbox bash', 'bazel build --config=j6 //app:main', 'bazel test //app:all'];
const skill = (id, slug, { description = `${slug} 何时使用`, content = '', status = 'approved', version = '1.0.0', tags = '[]' } = {}) => ({
  id, slug, name: slug, description, status, version, tags, folder_path: 'inbox', content,
});
const md = (front, body) => `---\n${front}\n---\n\n${body}\n`;

test('reference syntax: slug, @owner/slug, slug@version; metadata may hold a comma list', () => {
  assert.deepEqual(parseReference('verify'), { raw: 'verify', owner: null, slug: 'verify', pin: null });
  assert.deepEqual(parseReference('@team/verify@2.0.1'), { raw: '@team/verify@2.0.1', owner: 'team', slug: 'verify', pin: '2.0.1' });
  assert.equal(parseReference('not a slug'), null);
  assert.deepEqual(declaredDependencies({ metadata: { 'depends-on': 'a, b' }, depends_on: ['c'] }), ['c', 'a', 'b']);
});

test('bilingual descriptions: the other language is asked for, mixed descriptions already count', () => {
  assert.deepEqual(missingLanguages('遇到原因不明的 bug 时使用'), ['en']);
  assert.deepEqual(missingLanguages('Use when a test fails for no clear reason'), ['zh']);
  assert.deepEqual(missingLanguages('【元技能】验收纪律。Use when deciding whether a run passed'), []);
  assert.deepEqual(missingLanguages('遇到原因不明的 bug 时使用', { description_en: 'Use when a bug has no clear cause' }), []);
  const meta = normalizeSkillMeta(md('name: a\ndescription: 遇到原因不明的 bug 时使用', '# A'));
  assert.ok(meta.warnings.some((w) => w.includes('description_en')));
  const both = normalizeSkillMeta(md('name: a\ndescription: 遇到原因不明的 bug 时使用\nmetadata:\n  description-en: Use when a bug has no clear cause', '# A'));
  assert.ok(!both.warnings.some((w) => w.includes('description_en')), 'metadata keys (string values, per the Agent Skills spec) are accepted');
});

test('bilingual metadata lets a Chinese skill and its English twin be found as similar', () => {
  const filler = ['日报 周报 汇总', 'deploy frontend preview', '数据库 迁移 回滚', 'image generation prompt', '飞书 日历 会议', 'kubernetes pod logs']
    .map((d, i) => skill(10 + i, `filler-${i}`, { description: d, content: md(`description: ${d}`, `# ${d}`) }));
  const zh = (en) => skill(1, 'root-cause', {
    description: '遇到原因不明的故障或测试失败，动手修之前先复现、定位、解释根因',
    content: md(`description: 遇到原因不明的故障或测试失败，动手修之前先复现、定位、解释根因${en ? '\ndescription_en: "Use when a test fails or a failure has no clear cause, before fixing: reproduce, localize, explain the root cause"' : ''}`,
      '# 四步根因排查\n\n## 复现\n\n## 定位\n\n## 解释'),
  });
  const english = skill(2, 'debugging-recovery', {
    description: 'Use when a test fails or behavior is unexpected: reproduce, localize and explain the root cause before fixing',
    content: md('description: Use when a test fails or behavior is unexpected', '# Debugging and recovery\n\n## Reproduce\n\n## Localize the root cause\n\n## Fix'),
  });
  const score = (withEn) => similarInIndex(buildIndex([zh(withEn), english, ...filler]), english, { minSimilarity: 0 })
    .find((m) => m.skill.slug === 'root-cause')?.similarity || 0;
  assert.ok(score(false) < 0.25, `without a translation the pair is invisible (${score(false)})`);
  assert.ok(score(true) >= 0.25, `with description_en it is flagged as similar (${score(true)})`);
});

test('command normalization keeps the operation and drops the caller-specific details', () => {
  assert.equal(normalizeCommand('$ sudo bazel build --config=j6_irs2 //simapp/slave:perceptor'), 'bazel build --config=V P');
  assert.equal(normalizeCommand('ssh liukun@100.112.81.111 "docker ps"'), 'ssh U@H S');
  assert.equal(normalizeCommand('cd /tmp'), null, 'trivial commands are not operations');
  assert.equal(normalizeCommand('"permission": "ask",'), null, 'data lines are not commands');
  const commands = extractCommands(`${fence(['cat > x.json <<EOF', '{"a": 1}', 'EOF', 'jq . x.json'])}\n\n\`\`\`python\nprint(1)\n\`\`\``);
  assert.deepEqual(commands.filter((c) => c.raw).map((c) => c.normalized), ['jq . x.json'], 'heredoc bodies and non-shell blocks are skipped');
});

test('shared runs are found across skills, keeping the widest group', () => {
  const a = { id: 1, commands: extractCommands(fence(BUILD)) };
  const b = { id: 2, commands: extractCommands(fence(['echo start', ...BUILD.map((l) => l.replace('j6', 'x86').replace('//app', '//other'))])) };
  const c = { id: 3, commands: extractCommands(fence(BUILD.slice(0, 3))) };
  const d = { id: 4, commands: extractCommands(fence(['git status', 'git diff', 'git log'])) };
  const runs = sharedRuns([a, b, c, d]);
  assert.deepEqual(runs.map((r) => r.skills), [[1, 2, 3], [1, 2]]);
  assert.equal(runs[1].commands.length, 4);
});

test('lint: references, meta-skill contract, copied steps and extraction candidates', () => {
  const metaBody = (extra = '') => `# 容器编译\n\n## 契约\n输入：target\n输出：构建是否成功\n\n## 怎么用\n\n${fence(BUILD)}\n${extra}`;
  const library = [
    skill(1, 'dev-build', { description: '【元技能】在开发容器里编译。Use when building inside the dev container', content: md('description: x', metaBody('\n## 被谁引用\n- `replay`\n- `ghost-caller`')) }),
    skill(2, 'replay', { content: md('depends_on: [dev-build]', `# 回放\n\n> 用元技能 \`dev-build\`\n\n${fence(BUILD)}`) }),
    skill(3, 'sloppy', { content: md('depends_on: [missing-skill, "@bob/shared", "dev-build@0.9.0", "bad ref!"]', '# x\n\n见 [chain-a](~/.claude/skills/chain-a/SKILL.md)\n\n> 用元技能 `dev-build`') }),
    skill(4, 'chain-a', { content: md('depends_on: [chain-b]', '# a') }),
    skill(5, 'chain-b', { content: md('depends_on: [chain-c]', '# b') }),
    skill(6, 'chain-c', { content: md('depends_on: [chain-d]', '# c') }),
    skill(7, 'chain-d', { content: md('description: d', '# d') }),
    skill(8, 'loop-a', { content: md('depends_on: [loop-b]', '# a') }),
    skill(9, 'loop-b', { content: md('depends_on: [loop-a]', '# b') }),
    ...[10, 11, 12].map((id) => skill(id, `git-${id}`, { content: md('description: g', fence(['git fetch origin', 'git rebase origin/main', 'git push --force-with-lease'])) })),
    skill(13, 'bare-meta', { description: '【元技能】什么也没写', content: md('description: x', '# 空') }),
  ];
  const analysis = analyzeLibrary(library);
  const lint = (slug) => lintSkill(analysis, analysis.bySlug.get(slug), { username: 'me' });
  const codes = (slug) => lint(slug).map((i) => i.code);

  assert.deepEqual(analysis.dependents.get('dev-build').sort(), ['replay', 'sloppy']);
  assert.ok(codes('replay').includes('copies-meta'), 'declaring the meta skill is not enough when its steps are copied too');
  assert.match(lint('replay').find((i) => i.code === 'copies-meta').msg, /用元技能 `dev-build`/);

  const sloppy = lint('sloppy');
  for (const code of ['missing-ref', 'foreign-ref', 'pin-mismatch', 'invalid-ref', 'undeclared-ref', 'absolute-link']) {
    assert.ok(sloppy.some((i) => i.code === code), `sloppy should report ${code}`);
  }
  assert.ok(!sloppy.some((i) => i.code === 'undeclared-ref' && i.msg.includes('dev-build')), 'a pinned declaration still declares the skill');
  assert.ok(lintSkill(analysis, analysis.bySlug.get('sloppy'), { username: 'bob' }).every((i) => i.code !== 'foreign-ref'), '@own-name/slug is local');

  assert.match(lint('chain-a').find((i) => i.code === 'deep-chain').msg, /chain-a → chain-b → chain-c → chain-d/);
  assert.ok(!codes('chain-b').includes('deep-chain'), 'two levels are fine');
  assert.ok(codes('loop-a').includes('cycle'));

  const meta = lint('dev-build');
  assert.match(meta.find((i) => i.code === 'meta-used-by').msg, /漏了 sloppy.*ghost-caller 其实没有引用它/);
  assert.ok(!meta.some((i) => i.code === 'meta-contract'));
  assert.deepEqual(codes('bare-meta').filter((c) => c.startsWith('meta-')).sort(), ['meta-contract', 'meta-few-callers', 'meta-used-by']);

  assert.ok(codes('git-10').includes('extract-candidate'), 'three skills repeating the same operation');
  const broken = analyzeLibrary([skill(20, 'broken', { content: '---\ndescription: Use when: x\n---\n# b' })]);
  assert.match(lintSkill(broken, broken.bySlug.get('broken'))[0].msg, /frontmatter 解析失败（含「: 」的值要用引号括起来）/);

  const flags = structuralFlags(analysis);
  const flagCodes = (id) => (flags.get(id) || []).map((f) => f.code);
  assert.deepEqual(flagCodes(2), ['copies_meta']);
  assert.ok(flagCodes(3).includes('broken_ref'));
  assert.deepEqual(flagCodes(10), ['extractable']);
  assert.deepEqual(flagCodes(13), ['meta_contract']);

  // 待审内容单独分析：把抄来的步骤换成引用后，提示消失
  const fixed = analyzeSkill({ ...library[1], content: md('depends_on: [dev-build]', '# 回放\n\n> 用元技能 `dev-build`\n> - target: //app:main') }, analysis.library);
  assert.ok(!lintSkill(analysis, fixed).some((i) => i.code === 'copies-meta'));
});

test('references end to end: push hints, ash lint, local resolution after install', async (t) => {
  const server = await startServer();
  const { origin } = server;
  t.after(() => server.stop());
  const work = tmpDir('ash-refs-');
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

  const meta = md('name: dev-build\ndescription: 【元技能】在开发容器里编译并判断构建状态。Use when building inside the dev container',
    `# 容器编译\n\n## 契约\n输入：target\n输出：构建是否成功\n\n## 怎么用\n\n${fence(BUILD)}\n\n## 被谁引用\n- \`replay\``);
  ok(['push', writeSkill(meta)]);
  await approve('dev-build');

  await t.test('pushing a skill that copies a meta skill tells the agent to reference it instead', async () => {
    const copy = md('name: replay\ndescription: 跑回放并验证结果\ndescription_en: Run the replay and verify the results', `# 回放\n\n${fence(BUILD)}`);
    const out = ok(['push', writeSkill(copy)]).stdout;
    assert.match(out, /有 4 条命令与元技能 dev-build 相同：引用它/);
    assert.doesNotMatch(out, /缺少英文描述/);
    const review = await detail('replay');
    assert.ok(review.lint.some((i) => i.code === 'copies-meta'));
    assert.equal(review.shared_steps[0].skills[0].slug, 'dev-build');
  });

  await t.test('the fixed version references the meta skill; the update is flagged metadata-only only when the body is unchanged', async () => {
    const fixed = md('name: replay\ndescription: 跑回放并验证结果\ndescription_en: Run the replay and verify the results\ndepends_on: [dev-build]',
      '# 回放\n\n> 用元技能 `dev-build`\n> - target: //app:main');
    const out = ok(['push', writeSkill(fixed), '--update']).stdout;
    assert.doesNotMatch(out, /相同：引用它/);
    await approve('replay');
    const d = await detail('dev-build');
    assert.deepEqual(d.refs.dependents.map((s) => s.slug), ['replay']);
    assert.ok(!d.lint.some((i) => i.code === 'meta-used-by'), '「被谁引用」 matches reality');
    assert.match(ok(['info', 'dev-build']).stdout, /被引用: 1 个技能（replay）/);

    ok(['push', writeSkill(fixed.replace('description_en: Run the replay and verify the results', 'description_en: Run the perception replay and verify results')), '--update']);
    const pending = await detail('replay');
    assert.equal(pending.pending_metadata_only, true);
    assert.equal((await fetch(`${origin}/api/skills/${pending.id}/reject`, { method: 'POST' })).status, 200);
  });

  await t.test('after install the local agent can follow the reference to a real file', async () => {
    const dir = path.join(work, 'skills');
    ok(['pull', 'replay', '--dir', dir]);
    const installed = fs.readFileSync(path.join(dir, 'replay', 'SKILL.md'), 'utf8');
    const link = installed.match(/\[dev-build\]\((\.\.\/dev-build\/SKILL\.md)\)/);
    assert.ok(link, 'the footer lists the referenced skill with a relative link');
    assert.ok(fs.existsSync(path.resolve(dir, 'replay', link[1])), 'the relative link resolves to the installed dependency');
    assert.match(ok(['installed', '--dir', dir]).stdout, /replay .* 最新/);
    assert.match(ok(['push', path.join(dir, 'replay'), '--update']).stdout, /内容无变化/, 'the multi-line footer is stripped on push');
    assert.match(ok(['show', 'replay']).stdout, /本技能引用：`dev-build`（ash show dev-build）/);
  });

  await t.test('inside Claude Code, skills install where Claude Code loads them', () => {
    ok(['pull', 'replay'], { CLAUDECODE: '1' });
    assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'replay', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'dev-build', 'SKILL.md')), 'its reference is installed next to it');
  });

  await t.test('@own-account references install; other accounts are reported, not fetched', async () => {
    const d = md('name: nightly\ndescription: 每晚编译并回放\ndescription_en: Build and replay every night\ndepends_on: ["@tester/dev-build", "@bob/secret"]', '# 夜间任务\n\n> 用元技能 `dev-build`');
    ok(['push', writeSkill(d)]);
    await approve('nightly');
    const dir = path.join(work, 'nightly');
    const r = ok(['pull', 'nightly', '--dir', dir]);
    assert.ok(fs.existsSync(path.join(dir, 'dev-build', 'SKILL.md')));
    assert.doesNotMatch(r.stdout + r.stderr, /secret/);
    const refs = (await detail('nightly')).refs.declared;
    assert.deepEqual(refs.map((x) => x.status), ['ok', 'foreign']);
  });

  await t.test('ash lint lists what needs fixing across the library', async () => {
    const all = ok(['lint']).stdout;
    assert.match(all, /nightly\n.*@bob\/secret 指向其他账号/);
    assert.match(ok(['lint', 'replay']).stdout, /✅ replay 没有发现问题/);
    const json = await (await fetch(`${origin}/api/agent/lint?slug=nightly`)).json();
    assert.equal(json.results[0].issues[0].code, 'foreign-ref');
    assert.equal(ash(['lint', 'nope']).status, 1);
  });

  await t.test('attention shows skills that copy a meta skill', async () => {
    const copy = md('name: copycat\ndescription: 另一个抄了编译步骤的技能\ndescription_en: Another skill that copied the build steps', `# 抄\n\n${fence(BUILD)}`);
    ok(['push', writeSkill(copy)]);
    await approve('copycat');
    const list = await (await fetch(`${origin}/api/skills?folder=attention`)).json();
    const copycat = list.find((s) => s.slug === 'copycat');
    assert.deepEqual(copycat.health.map((h) => h.code), ['copies_meta']);
  });
});
