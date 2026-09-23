// 测试辅助：在临时目录里启动一个独立的服务实例（不碰真实数据）
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function startServer(env = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ash-test-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DATA_DIR: path.join(root, 'data'), STORAGE_DIR: path.join(root, 'files'), ...env },
    stdio: 'ignore',
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})`);
    try {
      ready = (await fetch(`${origin}/api/skills/stats`)).ok;
      if (ready) break;
    } catch { /* server is still starting */ }
    await delay(50);
  }
  if (!ready) throw new Error('server did not start');
  return {
    origin,
    root,
    async stop() {
      if (child.exitCode === null) {
        child.kill();
        await exited;
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}

module.exports = { startServer };
