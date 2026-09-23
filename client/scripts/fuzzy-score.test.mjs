import assert from 'node:assert/strict';
import test from 'node:test';
import { fuzzyScore } from '../src/utils/fuzzyScore.js';

test('fuzzy search keeps prefix, substring, and subsequence ranking', () => {
  assert.equal(fuzzyScore('', 'anything'), 1);
  assert.equal(fuzzyScore('abc', 'acb'), 0);
  assert.ok(fuzzyScore('skill', 'SkillHub') > fuzzyScore('skill', 'My SkillHub'));
  assert.ok(fuzzyScore('skill', 'My SkillHub') > fuzzyScore('sh', 'SkillHub'));
  assert.ok(fuzzyScore('sh', 'SkillHub') > 0);
});
