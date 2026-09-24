// 测试辅助：在临时目录里启动一个独立的服务实例（不碰真实数据）
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

// 服务全部需要登录：startServer 会注册一个测试账号，之后发往该服务的 fetch 自动带上它的 token，
// 并写入 ASH_TOKEN，让测试里启动的 ash CLI / 安装脚本继承。要测未登录的行为，用 rawFetch。
const rawFetch = globalThis.fetch;
const tokensByOrigin = new Map();
globalThis.fetch = (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const token = [...tokensByOrigin].find(([origin]) => url.startsWith(`${origin}/`))?.[1];
  if (!token) return rawFetch(input, init);
  const headers = new Headers(init.headers);
  if (!headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
  return rawFetch(input, { ...init, headers });
};

const SAME_SITE = { 'content-type': 'application/json', 'x-ash-request': '1' };

// 注册并拿到网页会话 cookie 和 CLI token
async function registerUser(origin, username, password = 'password123') {
  const reg = await rawFetch(`${origin}/api/auth/register`, { method: 'POST', headers: SAME_SITE, body: JSON.stringify({ username, password }) });
  if (reg.status !== 201) throw new Error(`register ${username} failed: ${reg.status} ${await reg.text()}`);
  const cookie = reg.headers.get('set-cookie').split(';')[0];
  const tok = await rawFetch(`${origin}/api/auth/cli-token`, { method: 'POST', headers: SAME_SITE, body: JSON.stringify({ username, password }) });
  const { token, user } = await tok.json();
  return { cookie, token, user };
}

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

// options.user=false 不注册测试账号；options.prepare(root) 在启动前往 <root>/data、<root>/files 预置数据
async function startServer(env = {}, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ash-test-'));
  if (options.prepare) await options.prepare(root);
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
      ready = (await rawFetch(`${origin}/healthz`)).ok;
      if (ready) break;
    } catch { /* server is still starting */ }
    await delay(50);
  }
  if (!ready) throw new Error('server did not start');
  const tester = options.user === false ? null : await registerUser(origin, 'tester');
  if (tester) {
    tokensByOrigin.set(origin, tester.token);
    process.env.ASH_TOKEN = tester.token;
  }
  return {
    origin,
    root,
    env: { DATA_DIR: path.join(root, 'data'), STORAGE_DIR: path.join(root, 'files'), ...env },
    token: tester?.token,
    cookie: tester?.cookie,
    async stop() {
      tokensByOrigin.delete(origin);
      if (tester && process.env.ASH_TOKEN === tester.token) delete process.env.ASH_TOKEN;
      if (child.exitCode === null) {
        child.kill();
        await exited;
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}

module.exports = { startServer, registerUser, rawFetch, SAME_SITE };
