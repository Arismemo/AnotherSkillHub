import assert from 'node:assert/strict';
import test from 'node:test';
import { collapseDiff, diffFileLists, diffLines, diffStats } from '../src/utils/lineDiff.js';

test('diffLines finds minimal line additions and deletions', () => {
  const lines = diffLines('a\nb\nc\nd', 'a\nB\nc\nd\ne');
  assert.deepEqual(lines, [
    { type: 'same', text: 'a' },
    { type: 'del', text: 'b' },
    { type: 'add', text: 'B' },
    { type: 'same', text: 'c' },
    { type: 'same', text: 'd' },
    { type: 'add', text: 'e' },
  ]);
  assert.deepEqual(diffStats(lines), { added: 2, removed: 1 });
});

test('identical input produces no changes', () => {
  assert.deepEqual(diffStats(diffLines('x\ny', 'x\ny')), { added: 0, removed: 0 });
});

test('collapseDiff keeps context around changes and folds the rest', () => {
  const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
  const after = before.replace('l10', 'changed');
  const collapsed = collapseDiff(diffLines(before, after), 2);
  assert.deepEqual(collapsed[0], { type: 'skip', count: 8 });
  assert.deepEqual(collapsed.at(-1), { type: 'skip', count: 7 });
  assert.equal(collapsed.filter((l) => l.type === 'same').length, 4);
});

test('diffFileLists reports added, removed and changed paths', () => {
  const result = diffFileLists(
    [{ path: 'a.sh', content: '1' }, { path: 'b.md', content: 'x' }],
    [{ path: 'a.sh', content: '2' }, { path: 'c.py', content: 'y' }],
  );
  assert.deepEqual(result, { added: ['c.py'], removed: ['b.md'], changed: ['a.sh'] });
});
