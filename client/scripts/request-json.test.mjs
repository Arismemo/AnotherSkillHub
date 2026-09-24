import assert from 'node:assert/strict';
import test from 'node:test';
import { requestJson } from '../src/utils/requestJson.js';

test('requestJson forwards options, adds the same-site header and returns parsed JSON', async (t) => {
  const original = globalThis.fetch;
  const options = { method: 'POST', body: '{}', signal: new AbortController().signal, headers: { 'Content-Type': 'application/json' } };
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, received) => {
    assert.equal(url, '/api/skills');
    assert.equal(received.method, 'POST');
    assert.equal(received.body, '{}');
    assert.equal(received.signal, options.signal);
    assert.equal(received.headers.get('content-type'), 'application/json');
    assert.equal(received.headers.get('x-ash-request'), '1');
    return { ok: true, json: async () => ({ id: 3 }) };
  };
  assert.deepEqual(await requestJson('/api/skills', options), { id: 3 });
});

test('requestJson hands 401 to the unauthorized handler unless disabled', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: '未登录' }) });
  let called = 0;
  await assert.rejects(requestJson('/api/skills', {}, { onUnauthorized: () => { called += 1; } }), (error) => error.status === 401);
  assert.equal(called, 1);
  await assert.rejects(requestJson('/api/auth/login', {}, { onUnauthorized: null }), /未登录/);
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) });
  await assert.rejects(requestJson('/api/skills', {}, { onUnauthorized: () => { called += 1; } }), /forbidden/);
  assert.equal(called, 1, 'only 401 triggers the handler');
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
