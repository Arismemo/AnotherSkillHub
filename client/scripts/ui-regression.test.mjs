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
    'onMoveFolder={handleMoveSkill}',
  ];
  for (const prop of requiredWiring) assert.ok(app.includes(prop), `missing callback wiring: ${prop}`);
  assert.ok(app.includes("requestJson('/api/skills/stats')"), 'stats must use the existing /api/skills/stats contract');
  assert.ok(!app.includes('onCopySkill'), 'duplicate-skill copy action was removed from the list per product decision');
});

test('detail always fetches the full record so file_tree stays available', async () => {
  const detail = await source('src/components/SkillDetail.jsx');
  assert.match(detail, /getJson\(`\/api\/skills\/\$\{skill\.id\}`\)/);
  assert.match(detail, /setFileTree\(Array\.isArray\(detail\.file_tree\)/);
  const fetchIndex = detail.indexOf('getJson(`/api/skills/${skill.id}`)');
  const contentBranchIndex = detail.indexOf('if (skill.content');
  assert.equal(contentBranchIndex, -1, 'full-detail fetch must not be conditional on list content');
  assert.ok(fetchIndex > -1);
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
  assert.match(css, /grid-template-columns:\s*clamp\(11\.5rem, 14vw, 13\.5rem\)\s*clamp\(15\.5rem, 19vw, 18rem\)\s*minmax\(0, 1fr\)/);
  assert.match(css, /\.markdown-document\s*\{[^}]*line-height:\s*1\.7/s);
  assert.match(css, /\.detail-content\s*\{[^}]*max\(44rem,\s*82%\)/s, 'body column must stay a soft cap, not a hard 40rem lock');
  assert.match(css, /--measure:\s*48rem/, 'readable measure token must exist for markdown text blocks');
  assert.ok(css.includes(':focus-visible'));
});
