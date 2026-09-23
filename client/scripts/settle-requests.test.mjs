import assert from 'node:assert/strict';
import test from 'node:test';
import { settleRequests } from '../src/utils/settleRequests.js';

test('batch result names successful and failed ids without hiding errors', async () => {
  const result = await settleRequests([1, 2, 3], async (id) => {
    if (id === 2) throw new Error('not found');
    return { id };
  });
  assert.deepEqual(result.succeeded, [1, 3]);
  assert.deepEqual(result.failed.map(({ id }) => id), [2]);
  assert.equal(result.failed[0].error.message, 'not found');
});
