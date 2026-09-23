const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const test = require('node:test');

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

test('creating a duplicate slug cannot overwrite an existing skill', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ash-skill-collision-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DATA_DIR: path.join(root, 'data'), STORAGE_DIR: path.join(root, 'files') },
    stdio: 'ignore',
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));

  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})`);
      try {
        ready = (await fetch(`${origin}/api/skills/stats`)).ok;
        if (ready) break;
      } catch { /* server is still starting */ }
      await delay(50);
    }
    assert.ok(ready, 'server did not start');

    const before = await (await fetch(`${origin}/api/skills/voyager-worldsim`)).json();
    const response = await fetch(`${origin}/api/skills`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'voyager-worldsim', name: 'overwrite attempt', content: '# unwanted replacement' }),
    });
    assert.equal(response.status, 409);
    const after = await (await fetch(`${origin}/api/skills/voyager-worldsim`)).json();
    assert.equal(after.content, before.content);
    assert.equal(after.name, before.name);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
});
