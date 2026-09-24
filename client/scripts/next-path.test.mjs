import assert from 'node:assert/strict';
import test from 'node:test';
import { safeNext } from '../src/landing/nextPath.js';

test('login returns to the app page the user came from', () => {
  assert.equal(safeNext('?next=%2Fapp%3Fskill%3Ddeploy-kit'), '/app?skill=deploy-kit');
  assert.equal(safeNext('?next=/app'), '/app');
  assert.equal(safeNext(''), '/app');
});

test('next cannot leave the app or the site', () => {
  for (const next of ['https://evil.example', '//evil.example', '/\\evil.example', '/application', '/api/auth/logout', 'javascript:alert(1)']) {
    assert.equal(safeNext(`?next=${encodeURIComponent(next)}`), '/app', next);
  }
});
