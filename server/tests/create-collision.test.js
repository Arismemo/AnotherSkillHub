const assert = require('node:assert/strict');
const test = require('node:test');
const { startServer } = require('./helpers');

test('creating a duplicate slug cannot overwrite an existing skill', async () => {
  const server = await startServer();
  const { origin } = server;
  try {
    const before = await (await fetch(`${origin}/api/skills/systematic-debugging`)).json();
    const response = await fetch(`${origin}/api/skills`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'systematic-debugging', name: 'overwrite attempt', content: '# unwanted replacement' }),
    });
    assert.equal(response.status, 409);
    const after = await (await fetch(`${origin}/api/skills/systematic-debugging`)).json();
    assert.equal(after.content, before.content);
    assert.equal(after.name, before.name);
  } finally {
    await server.stop();
  }
});
