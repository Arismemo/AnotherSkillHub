import assert from 'node:assert/strict';
import test from 'node:test';
import { formatShortDate, parseTimestamp, relativeTime } from '../src/utils/date.js';
import { folderLabels, targetFolderForView } from '../src/utils/systemFolders.js';

test('system views select inbox as the creation target; real folders are retained', () => {
  assert.deepEqual(Object.keys(folderLabels).sort(), ['all', 'inbox', 'pending', 'recent', 'starred', 'trash']);
  for (const view of ['all', 'starred', 'trash', 'recent', 'pending']) {
    assert.equal(targetFolderForView(view), 'inbox');
  }
  assert.equal(targetFolderForView('inbox'), 'inbox');
  assert.equal(targetFolderForView('projects/design'), 'projects/design');
  assert.equal(targetFolderForView('toString'), 'toString');
});

test('date formatters preserve empty and relative-time boundaries', () => {
  const now = new Date('2026-09-23T12:00:00Z').getTime();
  assert.equal(formatShortDate(null), '');
  assert.equal(formatShortDate('2026-09-23T00:00:00Z'), new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date('2026-09-23T00:00:00Z')));
  assert.equal(relativeTime('bad date', now), '');
  assert.equal(relativeTime(now - 20_000, now), '刚刚');
  assert.equal(relativeTime(now - 60_000, now), '1 分钟前');
  assert.equal(relativeTime(now - 60 * 60_000, now), '1 小时前');
  assert.equal(relativeTime(now - 24 * 60 * 60_000, now), '1 天前');
  assert.equal(relativeTime(now - 30 * 24 * 60 * 60_000, now), new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(now - 30 * 24 * 60 * 60_000));
});

test('SQLite UTC timestamps without a zone are parsed as UTC, not local time', () => {
  const now = new Date('2026-09-23T12:00:00Z').getTime();
  assert.equal(parseTimestamp('2026-09-23 08:00:00').toISOString(), '2026-09-23T08:00:00.000Z');
  assert.equal(relativeTime('2026-09-23 11:57:00', now), '3 分钟前');
  assert.equal(parseTimestamp('2026-09-23T08:00:00Z').toISOString(), '2026-09-23T08:00:00.000Z');
  assert.equal(parseTimestamp('2026-09-23T16:00:00+08:00').toISOString(), '2026-09-23T08:00:00.000Z');
});
