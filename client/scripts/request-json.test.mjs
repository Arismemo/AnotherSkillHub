import assert from 'node:assert/strict';
import test from 'node:test';
import { requestJson } from '../src/utils/requestJson.js';

test('requestJson forwards options and returns parsed JSON', async (t) => {
  const original = globalThis.fetch;
  const options = { method: 'POST', body: '{}', signal: new AbortController().signal };
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, received) => {
    assert.equal(url, '/api/skills');
    assert.equal(received, options);
    return { ok: true, json: async () => ({ id: 3 }) };
  };
  assert.deepEqual(await requestJson('/api/skills', options), { id: 3 });
});

test('requestJson preserves API errors and status', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ error: '重复技能' }) });
  await assert.rejects(requestJson('/api/skills'), (error) => error.message === '重复技能' && error.status === 409);
});

test('requestJson distinguishes invalid JSON, network failure, and abort', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('bad JSON'); } });
  await assert.rejects(requestJson('/api/skills'), /服务器返回了无效响应/);
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(requestJson('/api/skills'), /网络连接失败/);
  const abort = new DOMException('cancelled', 'AbortError');
  globalThis.fetch = async () => { throw abort; };
  await assert.rejects(requestJson('/api/skills'), (error) => error === abort);
});
