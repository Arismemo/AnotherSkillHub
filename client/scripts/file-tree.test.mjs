import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFileTree } from '../src/utils/fileTree.js';

test('file tree groups nested paths without mixing identical basenames', () => {
  const files = [
    { path: 'SKILL.md', size: 200, isMain: true },
    { path: 'scripts/check.py', size: 1200 },
    { path: 'references/check.py', size: 300 },
    { path: 'scripts/tests/check.py', size: 500 },
    { path: 'references/中文说明.md', size: 80 },
  ];
  const root = buildFileTree(files);
  assert.deepEqual([...root.children.keys()], ['SKILL.md', 'scripts', 'references']);
  assert.equal(root.children.get('SKILL.md').file, files[0]);
  const scripts = root.children.get('scripts');
  assert.equal(scripts.path, 'scripts');
  assert.equal(scripts.file, null);
  assert.equal(scripts.children.get('check.py').file, files[1]);
  const nested = scripts.children.get('tests').children.get('check.py');
  assert.equal(nested.path, 'scripts/tests/check.py');
  assert.equal(nested.name, 'check.py');
  assert.equal(nested.file, files[3]);
  assert.equal(root.children.get('references').children.get('check.py').file, files[2]);
  assert.equal(root.children.get('references').children.get('中文说明.md').file, files[4]);
  assert.equal(files.length, 5);
});

test('empty and main-only skills do not create phantom folders', () => {
  assert.equal(buildFileTree([]).children.size, 0);
  const root = buildFileTree([{ path: 'SKILL.md', size: 0 }]);
  assert.equal(root.children.size, 1);
  assert.equal(root.children.get('SKILL.md').children.size, 0);
});
