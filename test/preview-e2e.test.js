// End to end through the real server: add a repository, let the (fake)
// agent write a server recipe, then open the default branch and load its
// live preview through the per-workspace preview origin.
const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { PreviewRenderer } = require('../server/preview.js');
const { commit, sh } = require('./helpers/git-fixture.js');

const ROOT = path.resolve(__dirname, '..');
const FAKE_OMP = path.join(__dirname, 'helpers', 'fake-omp.js');
const APP = `require('node:http').createServer((q, s) => s.end('<h1>served by node</h1>')).listen(process.env.PORT, '127.0.0.1');\n`;
const RECIPE = '{"version":1,"kind":"server","start":"node app.js","reload":"self"}\n';

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function request(port, pathname, { method = 'GET', body, host } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: { 'Content-Type': 'application/json', ...(host ? { Host: host } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

async function json(port, pathname, options) {
  const res = await request(port, pathname, options);
  return { status: res.status, data: JSON.parse(res.body.toString() || '{}') };
}

async function until(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

// Collects SSE events of one type until `predicate` matches.
function waitForEvent(port, pathname, type, predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname }, (res) => {
      let buffer = '';
      const timer = setTimeout(() => { req.destroy(); reject(new Error(`No ${type} event in time; got:\n${buffer}`)); }, timeoutMs);
      res.on('data', (chunk) => {
        buffer += chunk;
        for (const frame of buffer.split('\n\n')) {
          const event = /^event: (.*)$/m.exec(frame)?.[1];
          const data = /^data: (.*)$/m.exec(frame)?.[1];
          if (event === type && data && predicate(JSON.parse(data))) {
            clearTimeout(timer);
            resolve({ data: JSON.parse(data), close: () => req.destroy() });
            return;
          }
        }
      });
    });
    req.on('error', () => {});
  });
}

test('adding a repository sets up its preview, and opening main serves it live', { timeout: 90000 }, async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dialogue-e2e-'));
  const origin = path.join(root, 'origin', 'app');
  await fsp.mkdir(origin, { recursive: true });
  sh(origin, 'init', '-q', '-b', 'main');
  await commit(origin, { 'app.js': APP, 'package.json': '{"name":"app"}\n' }, 'initial');
  // Clone "https://github.com/o/app" from the local origin instead.
  const gitConfig = path.join(root, 'gitconfig');
  await fsp.writeFile(gitConfig, `[url "${path.join(root, 'origin')}/"]\n\tinsteadOf = https://github.com/o/\n[user]\n\tname = T\n\temail = t@x\n`);
  const plan = path.join(root, 'plan.json');
  await fsp.writeFile(plan, JSON.stringify([{ recipe: RECIPE }]));
  const home = path.join(root, 'home');
  await fsp.mkdir(home);
  const port = await freePort();

  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      HOME: home,
      DIALOGUE_DATA: path.join(root, 'data'),
      DIALOGUE_OMP: FAKE_OMP,
      DIALOGUE_SEED: '',
      FAKE_OMP_PLAN: plan,
      GIT_CONFIG_GLOBAL: gitConfig,
      GIT_CONFIG_NOSYSTEM: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  server.stdout.on('data', (d) => { output += d; });
  server.stderr.on('data', (d) => { output += d; });
  try {
    await until(() => request(port, '/api/health').then((r) => r.status === 200, () => false), 15000, 'server start');

    const added = await json(port, '/api/projects', { method: 'POST', body: { url: 'https://github.com/o/app' } });
    assert.equal(added.status, 201, JSON.stringify(added.data));

    const ready = await until(async () => {
      const { data } = await json(port, '/api/projects');
      const project = data.projects.find((p) => p.slug === 'o-app');
      assert.notEqual(project.previewSetup.status, 'failed', `setup failed: ${project.previewSetup.error}\n${output}`);
      return project.previewSetup.status === 'ready' && project;
    }, 45000, 'preview setup');
    if (new PreviewRenderer(root).available) {
      assert.ok(ready.previewUrl, 'the card shows the main screenshot');
      const image = await request(port, ready.previewUrl);
      assert.equal(image.status, 200);
      assert.equal(image.headers['content-type'], 'image/png');
    }

    const opened = await json(port, '/api/projects/o-app/workspaces', { method: 'POST', body: { ref: 'main' } });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    const workspace = opened.data.workspace;
    assert.equal(workspace.ahead, 1, 'the recipe commit waits to be pushed');
    const previewUrl = new URL(workspace.previewUrl);
    assert.match(previewUrl.hostname, /^[0-9a-f]{16}\.preview\.localhost$/);

    const runner = await waitForEvent(port, `/api/workspaces/${workspace.id}/events`, 'runner', (data) => data.state === 'ready' || data.state === 'crashed', 30000);
    try {
      assert.equal(runner.data.state, 'ready', JSON.stringify(runner.data));
      assert.equal(runner.data.reload, 'self');
      const page = await request(port, '/', { host: previewUrl.host });
      assert.equal(page.status, 200);
      assert.match(page.body.toString(), /served by node/);
    } finally {
      runner.close();
    }
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
    await fsp.rm(root, { recursive: true, force: true });
  }
});
