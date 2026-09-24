import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('App wires every interactive component callback to an implementation', async () => {
  const app = await source('src/App.jsx');
  const requiredWiring = [
    'onRenameFolder={handleRenameFolder}',
    'onDeleteFolder={handleDeleteFolder}',
    'onBatchMove={handleBatchMove}',
    'onTrashSkill={handleTrashSkill}',
    'onRestoreSkill=',
    'onPermanentDelete={handlePermanentDelete}',
    'onSelectFolder={handleSelectFolder}',
  ];
  for (const prop of requiredWiring) assert.ok(app.includes(prop), `missing callback wiring: ${prop}`);
  assert.ok(app.includes("requestJson('/api/skills/stats')"), 'stats must use the existing /api/skills/stats contract');
});

test('detail breadcrumb navigates to the folder instead of moving the skill into it', async () => {
  const detail = await source('src/components/SkillDetail.jsx');
  assert.ok(!detail.includes('onMoveFolder'), 'breadcrumb must not trigger a move mutation');
  assert.match(detail, /crumb-link[\s\S]{0,80}?onSelectFolder\?\.\(arr\.slice\(0, i \+ 1\)\.join\('\/'\)\)/, 'each crumb segment navigates to its own path prefix');
});

test('detail always fetches the full record so file_tree stays available', async () => {
  const detail = await source('src/components/SkillDetail.jsx');
  assert.match(detail, /requestJson\(`\/api\/skills\/\$\{skill\.id\}`\)/);
  assert.match(detail, /setFileTree\(Array\.isArray\(detail\.file_tree\)/);
  const fetchIndex = detail.indexOf('requestJson(`/api/skills/${skill.id}`)');
  const contentBranchIndex = detail.indexOf('if (skill.content');
  assert.equal(contentBranchIndex, -1, 'full-detail fetch must not be conditional on list content');
  assert.ok(fetchIndex > -1);
});

test('every keyboard shortcut comes from the one registry that also feeds the cheat sheet', async () => {
  const app = await source('src/App.jsx');
  assert.match(app, /useHotkeys\(/, 'App must drive shortcuts through the shared hook');
  for (const id of ['palette', 'help', 'search', 'new', 'escape', 'next', 'prev', 'open', 'select-all', 'star', 'edit', 'save', 'trash']) {
    assert.ok(app.includes(`id: '${id}'`), `missing shortcut registration: ${id}`);
  }
  assert.ok(app.includes('shortcuts={shortcuts}'), 'the ? cheat sheet must be generated from the same registry');
  assert.ok(!/window\.addEventListener\('keydown'/.test(app), 'App must not hand-roll extra keydown listeners');
  const hook = await source('src/hooks/useHotkeys.js');
  assert.ok(hook.includes("['INPUT', 'TEXTAREA', 'SELECT']"), 'single-key shortcuts must be skipped while typing');
  assert.match(hook, /allowInInput/, 'bindings need an explicit opt-in to fire inside inputs');
});

test('dialog hooks are unconditional and dialogs support focus, Escape, and accessible names', async () => {
  const modals = await source('src/components/Modals.jsx');
  for (const functionName of ['NewSkillModal', 'PasteSkillModal', 'AgentSetupModal']) {
    const start = modals.indexOf(`export function ${functionName}`);
    const nextExport = modals.indexOf('export function ', start + 16);
    const block = modals.slice(start, nextExport === -1 ? undefined : nextExport);
    assert.ok(block.indexOf('useState(') < block.indexOf('if (!isOpen)'), `${functionName} hooks must run before conditional return`);
  }
  assert.ok(modals.includes('aria-modal="true"'));
  assert.ok(modals.includes("event.key === 'Escape'"));
  assert.ok(modals.includes('firstFocusable?.focus()'));
  assert.ok(modals.includes('aria-label={`关闭${title}`}'));
});

test('three-pane shell and readable Markdown styles remain present', async () => {
  const css = await source('src/index.css');
  assert.match(css, /\.app-shell\s*\{[^}]*grid-template-columns:\s*var\(--w-sidebar[^)]*\)\s*var\(--w-list[^)]*\)\s*minmax\(0, 1fr\)/s, 'shell columns must stay driven by the persisted width variables');
  assert.match(css, /\.pane-resizer\s*\{[^}]*cursor:\s*col-resize/s, 'panes need a shared resizer affordance');
  assert.match(css, /\.markdown-document\s*\{[^}]*line-height:\s*1\.6/s);
  assert.match(css, /\.detail-content\s*\{[^}]*max\(44rem,\s*82%\)/s, 'body column must stay a soft cap, not a hard 40rem lock');
  assert.match(await source('src/tokens.css'), /--measure:\s*48rem/, 'readable measure token must exist for markdown text blocks');
  assert.ok(css.includes(':focus-visible'));
});
