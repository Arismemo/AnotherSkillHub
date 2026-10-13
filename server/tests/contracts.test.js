// 契约、副作用与调用方式：effects / call 的解析，副作用传递、独立调用、契约改动要升主版本这几项检查
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), 'ash-contracts-db-'));
const { effectsOf, callModeOf, stripInstallFooter } = require('../skillMeta');
const { analyzeLibrary, analyzeSkill, lintSkill } = require('../skillRefs');

const md = (front, body) => `---\n${front}\n---\n\n${body}\n`;
const skill = (id, slug, content, { description = `${slug} 何时使用`, status = 'approved', version = '1.0.0' } = {}) => ({
  id, slug, name: slug, description, status, version, tags: '[]', folder_path: 'inbox', content,
});
const contract = (rows) => `## 契约\n\n${rows.map(([k, v]) => `- ${k}：${v}`).join('\n')}\n`;

test('effects and call: English values, Chinese aliases, metadata strings, invalid values', () => {
  assert.deepEqual(effectsOf({ effects: 'read-only' }), { value: 'read-only', raw: 'read-only', invalid: false });
  assert.equal(effectsOf({ effects: '改动' }).value, 'mutating');
  assert.equal(effectsOf({ metadata: { effects: '临时占用' } }).value, 'temporary');
  assert.deepEqual(effectsOf({ effects: 'safe' }), { value: null, raw: 'safe', invalid: true });
  assert.deepEqual(effectsOf({}), { value: null, raw: null, invalid: false });
  assert.equal(callModeOf({ call: 'fork' }).value, 'fork');
  assert.equal(callModeOf({ call: '独立调用' }).value, 'fork');
  assert.equal(callModeOf({}).value, 'inline');
  assert.equal(callModeOf({ call: 'async' }).invalid, true);
});

test('install-time fork fields are stripped on push, like the footer', () => {
  const installed = '---\nname: qa\ncall: fork\ncontext: fork # ash:call-fork\nbackground: false # ash:call-fork\n---\n\n# QA\n';
  assert.equal(stripInstallFooter(installed), '---\nname: qa\ncall: fork\n---\n\n# QA\n');
  const authored = '---\nname: qa\ncontext: fork\n---\n';
  assert.equal(stripInstallFooter(authored), authored, 'fields the author wrote stay');
});

test('lint: effects propagate like const, forked skills must be safe and say what they return', () => {
  const library = [
    skill(1, 'fleet', md('effects: mutating', '# 部署启停')),
    skill(2, 'monitor-ro', md('effects: read-only\ndepends_on: [fleet]', '# 监测')),
    skill(3, 'monitor-ok', md('effects: mutating\ndepends_on: [fleet]', '# 监测')),
    skill(4, 'tunnel', md('effects: temporary', `# 隧道\n\n${contract([['输入', '端点'], ['输出', '本地端口']])}`),
      { description: '【元技能】建隧道' }),
    skill(5, 'qa', md('effects: read-only\ncall: fork', `# 体检\n\n${contract([['输入', 'base URL'], ['输出', '通过 / 不通过 + 问题清单']])}`),
      { description: '【元技能】页面体检' }),
    skill(6, 'qa-bad', md('effects: mutating\ncall: fork', '# 没写契约'), { description: '【元技能】会改东西还要放进子代理' }),
    skill(7, 'facts', md('description: x', '# 事实'), { description: '【元技能】平台事实' }),
    skill(8, 'typo', md('effects: safe\ncall: async', '# x')),
    skill(9, 'quiet', md('depends_on: [fleet]', '# 没声明副作用')),
  ];
  const analysis = analyzeLibrary(library);
  const lint = (slug) => lintSkill(analysis, analysis.bySlug.get(slug));
  const codes = (slug) => lint(slug).map((i) => i.code);
  const msg = (slug, code) => lint(slug).find((i) => i.code === code)?.msg || '';

  assert.match(msg('monitor-ro', 'effects-escalation'), /fleet.*mutating/);
  assert.ok(!codes('monitor-ok').includes('effects-escalation'));
  assert.match(msg('tunnel', 'contract-resources'), /资源/, 'temporary effects need a 资源 row saying how to release');
  assert.ok(!codes('qa').some((c) => c.startsWith('fork-')), 'a read-only forked skill with input and output is fine');
  assert.ok(codes('qa-bad').includes('fork-mutating'));
  assert.ok(codes('qa-bad').includes('fork-contract'));
  assert.ok(codes('facts').includes('effects-missing'), 'meta skills should declare effects');
  assert.ok(codes('typo').includes('effects-invalid') && codes('typo').includes('call-invalid'));
  assert.match(msg('quiet', 'effects-missing'), /fleet/, 'a skill that uses a mutating skill should declare its own effects');
});

test('lint: a forked meta skill starts a new context, so depth does not continue through it', () => {
  const library = [
    skill(1, 'caller', md('depends_on: [forked]', '# 调用方')),
    skill(2, 'forked', md('effects: read-only\ncall: fork\ndepends_on: [m1]', `# x\n\n${contract([['输入', 'a'], ['输出', 'b']])}`), { description: '【元技能】独立调用' }),
    skill(3, 'm1', md('effects: read-only\ndepends_on: [m2]', '# m1'), { description: '【元技能】m1' }),
    skill(4, 'm2', md('effects: read-only', '# m2'), { description: '【元技能】m2' }),
  ];
  const analysis = analyzeLibrary(library);
  const codes = (slug) => lintSkill(analysis, analysis.bySlug.get(slug)).map((i) => i.code);
  assert.ok(!codes('caller').includes('deep-chain'), 'caller → forked(fork) → m1 → m2 would be 3 levels if inlined');
  assert.ok(!codes('forked').includes('deep-chain'), 'forked → m1 → m2 is its own two levels');
});

test('lint: changing or removing a contract item needs a major version; adding one does not', () => {
  const rows = [['输入', 'target'], ['输出', '构建是否成功'], ['失败', '返回错误']];
  const published = skill(1, 'build', md('version: 1.2.0\neffects: read-only', `# 编译\n\n${contract(rows)}`), { description: '【元技能】编译', version: '1.2.0' });
  const caller = skill(2, 'replay', md('depends_on: [build]', '# 回放'));
  const analysis = analyzeLibrary([published, caller]);
  const lintCandidate = (front, rowsAfter) => lintSkill(analysis,
    analyzeSkill({ ...published, content: md(front, `# 编译\n\n${contract(rowsAfter)}`) }, analysis.library),
    { previous: analysis.bySlug.get('build') });

  const changed = lintCandidate('version: 1.3.0\neffects: read-only', [['输入', 'target, config'], ['输出', '构建是否成功'], ['失败', '返回错误']]);
  const issue = changed.find((i) => i.code === 'contract-major');
  assert.ok(issue, 'an input change under a minor bump is flagged');
  assert.match(issue.msg, /输入/);
  assert.match(issue.msg, /2\.0\.0/);
  assert.match(issue.msg, /replay/, 'dependents to re-check are listed');

  const removed = lintCandidate('version: 1.3.0\neffects: read-only', rows.slice(0, 2));
  assert.match(removed.find((i) => i.code === 'contract-major').msg, /失败/);

  const added = lintCandidate('version: 1.3.0\neffects: read-only', [...rows, ['资源', '无']]);
  assert.ok(!added.some((i) => i.code === 'contract-major'), 'a new item is backward compatible');

  const punctuation = lintCandidate('version: 1.2.1\neffects: read-only', [['输入', '`target`'], ['输出', '构建是否成功。'], ['失败', '返回错误']]);
  assert.ok(!punctuation.some((i) => i.code === 'contract-major'), 'formatting-only edits are not a signature change');

  const withResources = [...rows, ['资源', '无常驻进程']];
  const resPublished = skill(4, 'tunnel', md('version: 1.2.0\neffects: read-only', `# 隧道\n\n${contract(withResources)}`), { description: '【元技能】隧道' });
  const resAnalysis = analyzeLibrary([resPublished]);
  const resLint = lintSkill(resAnalysis,
    analyzeSkill({ ...resPublished, content: md('version: 1.2.1\neffects: read-only', `# 隧道\n\n${contract([...rows, ['资源', '用到隧道模式时要 kill 后台 ssh']])}`) }, resAnalysis.library),
    { previous: resAnalysis.bySlug.get('tunnel') });
  assert.ok(!resLint.some((i) => i.code === 'contract-major'), 'rewording 资源 is a description, not a signature change');
  assert.match(resLint.find((i) => i.code === 'contract-effects-changed')?.msg || '', /资源.*effects/);

  const major = lintCandidate('version: 2.0.0\neffects: read-only', [['输入', 'target, config'], ['输出', '构建是否成功']]);
  assert.ok(!major.some((i) => i.code === 'contract-major'));

  const tableRows = (input) => `## 契约\n\n| 项 | 内容 |\n|---|---|\n| **输入** | ${input} |\n| **输出** | 结论 |\n`;
  const tablePublished = skill(3, 'grade', md('version: 1.0.0\neffects: read-only', `# 分级\n\n${tableRows('结果')}`), { description: '【元技能】分级' });
  const tableAnalysis = analyzeLibrary([tablePublished]);
  const tableLint = lintSkill(tableAnalysis,
    analyzeSkill({ ...tablePublished, content: md('version: 1.1.0\neffects: read-only', `# 分级\n\n${tableRows('结果 + 判据')}`) }, tableAnalysis.library),
    { previous: tableAnalysis.bySlug.get('grade') });
  assert.match(tableLint.find((i) => i.code === 'contract-major')?.msg || '', /输入/, 'table-style contracts are compared row by row too');
});
