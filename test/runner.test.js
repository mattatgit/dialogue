const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { Runner, RunnerError, RunnerPool, installStamp } = require('../server/runner.js');

const recipe = (extra) => ({ version: 1, kind: 'server', root: '.', install: null, start: null, entry: '/', reload: 'dialogue', readyTimeoutSeconds: 120, ...extra });

async function tmpWorkspace() {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'dialogue-runner-'));
  const dir = path.join(base, 'wt');
  const stampDir = path.join(base, 'stamp');
  await fsp.mkdir(dir);
  await fsp.mkdir(stampDir);
  return { base, dir, stampDir, cleanup: () => fsp.rm(base, { recursive: true, force: true }) };
}

test('static recipe is ready immediately and targets the resolved root', async () => {
  const ws = await tmpWorkspace();
  await fsp.mkdir(path.join(ws.dir, 'site'));
  await fsp.writeFile(path.join(ws.dir, 'site', 'index.html'), '<h1>hi</h1>');
  const runner = new Runner({ dir: ws.dir, recipe: recipe({ kind: 'static', root: 'site' }), stampDir: ws.stampDir });
  const states = [];
  runner.on('state', (s) => states.push(s));
  assert.equal(runner.state, 'stopped');
  assert.equal(runner.target, null);
  await runner.start();
  assert.equal(runner.state, 'ready');
  assert.deepEqual(runner.target, { kind: 'static', root: path.join(ws.dir, 'site') });
  assert.deepEqual(states, ['ready']);
  await runner.stop();
  assert.equal(runner.state, 'stopped');
  await ws.cleanup();
});

test('static recipe without its entry file fails at the ready step', async () => {
  const ws = await tmpWorkspace();
  const runner = new Runner({ dir: ws.dir, recipe: recipe({ kind: 'static', root: '.' }), stampDir: ws.stampDir });
  await assert.rejects(runner.start(), (e) => e instanceof RunnerError && e.step === 'ready' && /index\.html/.test(e.message));
  assert.equal(runner.state, 'crashed');
  await ws.cleanup();
});

// A fake dev server: `node fake-server.js` listens on $HOST:$PORT, or on the
// host given by FAKE_HOST, and prints its env so tests can assert on it.
const FAKE_SERVER = `
const http = require('node:http');
const host = process.env.FAKE_HOST || process.env.HOST;
const server = http.createServer((req, res) => {
  if (req.url === '/crash') { res.end('bye'); setTimeout(() => process.exit(3), 20); return; }
  res.end(JSON.stringify({ PORT: process.env.PORT, HOST: process.env.HOST, BROWSER: process.env.BROWSER, EXTRA: process.env.EXTRA }));
});
server.listen(Number(process.env.PORT), host, () => console.log('listening on ' + host + ':' + process.env.PORT));
`;

async function serverWorkspace(extra) {
  const ws = await tmpWorkspace();
  await fsp.writeFile(path.join(ws.dir, 'fake-server.js'), FAKE_SERVER);
  ws.runner = new Runner({ dir: ws.dir, recipe: recipe({ start: `${process.execPath} fake-server.js`, ...extra }), stampDir: ws.stampDir, env: { EXTRA: 'yes' } });
  return ws;
}

const runsOf = (ws) => fsp.readFile(path.join(ws.dir, 'runs'), 'utf8').then((s) => s.length, () => 0);

test('installStamp changes with the command and the manifest contents', async () => {
  const ws = await tmpWorkspace();
  const a = await installStamp(ws.dir, recipe({ install: 'npm ci' }));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(await installStamp(ws.dir, recipe({ install: 'npm ci' })), a);
  assert.notEqual(await installStamp(ws.dir, recipe({ install: 'npm install' })), a);
  await fsp.writeFile(path.join(ws.dir, 'package.json'), '{}');
  assert.notEqual(await installStamp(ws.dir, recipe({ install: 'npm ci' })), a);
  await ws.cleanup();
});

test('install runs once and is skipped while the stamp matches', async () => {
  const ws = await serverWorkspace({ install: 'printf x >> runs' });
  await ws.runner.start();
  assert.equal(await runsOf(ws), 1);
  await ws.runner.stop();
  await ws.runner.start();
  assert.equal(await runsOf(ws), 1);
  await ws.runner.stop();
  // a changed lockfile invalidates the stamp
  await fsp.writeFile(path.join(ws.dir, 'package-lock.json'), '{}');
  await ws.runner.start();
  assert.equal(await runsOf(ws), 2);
  await ws.runner.stop();
  await ws.cleanup();
});

test('failed install rejects with step install, exit code and log tail', async () => {
  const ws = await serverWorkspace({ install: 'echo installing; echo boom >&2; exit 7' });
  const states = [];
  ws.runner.on('state', (s) => states.push(s));
  await assert.rejects(ws.runner.start(), (e) => e instanceof RunnerError && e.step === 'install' && e.exitCode === 7 && /boom/.test(e.logTail));
  assert.equal(ws.runner.state, 'crashed');
  assert.deepEqual(states, ['installing', 'crashed']);
  assert.equal(ws.runner.logTail(), 'installing\nboom');
  assert.equal(await fsp.readFile(path.join(ws.stampDir, 'install.sha'), 'utf8').catch(() => null), null);
  await ws.cleanup();
});

test('stop during install kills the install command and ends stopped', async () => {
  const ws = await serverWorkspace({ install: 'echo $$ > pid; exec sleep 30' });
  const attempt = ws.runner.start();
  await new Promise((r) => setTimeout(r, 150));
  const pid = Number(await fsp.readFile(path.join(ws.dir, 'pid'), 'utf8'));
  await ws.runner.stop();
  await assert.rejects(attempt, (e) => e.step === 'install');
  assert.equal(ws.runner.state, 'stopped');
  await new Promise((r) => setTimeout(r, 100));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  await ws.cleanup();
});

test('start command exiting before readiness rejects with step start', async () => {
  const ws = await serverWorkspace({ start: 'echo nope; exit 5' });
  await assert.rejects(ws.runner.start(), (e) => e instanceof RunnerError && e.step === 'start' && e.exitCode === 5 && /nope/.test(e.logTail));
  assert.equal(ws.runner.state, 'crashed');
  await ws.cleanup();
});

test('readiness timeout rejects with step ready and kills the server', async () => {
  const ws = await serverWorkspace({ start: 'echo $$ > pid; exec sleep 30', readyTimeoutSeconds: 0.5 });
  await assert.rejects(ws.runner.start(), (e) => e instanceof RunnerError && e.step === 'ready');
  assert.equal(ws.runner.state, 'crashed');
  const pid = Number(await fsp.readFile(path.join(ws.dir, 'pid'), 'utf8'));
  await new Promise((r) => setTimeout(r, 100));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  await ws.cleanup();
});

test('ready server receives PORT/HOST/BROWSER and the extra env, and start is idempotent', async () => {
  const ws = await serverWorkspace();
  const states = [];
  ws.runner.on('state', (s) => states.push(s));
  const first = ws.runner.start();
  assert.equal(ws.runner.start(), first);
  await first;
  assert.deepEqual(states, ['starting', 'ready']);
  const { host, port } = ws.runner.target;
  assert.equal(host, '127.0.0.1');
  const body = await fetch(`http://${host}:${port}/`).then((r) => r.json());
  assert.deepEqual(body, { PORT: String(port), HOST: '127.0.0.1', BROWSER: 'none', EXTRA: 'yes' });
  assert.match(ws.runner.logTail(), /listening on 127\.0\.0\.1:\d+/);
  await ws.runner.stop();
  await ws.cleanup();
});

const hasIpv6Loopback = () => new Promise((resolve) => {
  const srv = require('node:net').createServer();
  srv.once('error', () => resolve(false));
  srv.listen(0, '::1', () => srv.close(() => resolve(true)));
});

test('a server bound only to ::1 is detected and targeted there', async (t) => {
  if (!(await hasIpv6Loopback())) return t.skip('no IPv6 loopback');
  const ws = await serverWorkspace({ start: `FAKE_HOST=::1 ${process.execPath} fake-server.js` });
  await ws.runner.start();
  assert.equal(ws.runner.target.host, '::1');
  await ws.runner.stop();
  await ws.cleanup();
});

test('server exiting after ready moves to crashed with an error', async () => {
  const ws = await serverWorkspace();
  await ws.runner.start();
  const crashed = new Promise((resolve) => ws.runner.on('state', (s, extra) => s === 'crashed' && resolve(extra)));
  const { host, port } = ws.runner.target;
  await fetch(`http://${host}:${port}/crash`).then((r) => r.text());
  const { error } = await crashed;
  assert.ok(error instanceof RunnerError);
  assert.equal(error.exitCode, 3);
  assert.equal(ws.runner.state, 'crashed');
  await ws.runner.stop();
  await ws.cleanup();
});

test('stop kills the whole process group, including grandchildren', async () => {
  const ws = await serverWorkspace({ start: `sleep 1000 & echo $! > grandchild; echo $$ > pid; exec ${process.execPath} fake-server.js` });
  await ws.runner.start();
  const pids = await Promise.all(['pid', 'grandchild'].map((f) => fsp.readFile(path.join(ws.dir, f), 'utf8').then(Number)));
  for (const pid of pids) process.kill(pid, 0);
  await ws.runner.stop();
  assert.equal(ws.runner.state, 'stopped');
  await new Promise((r) => setTimeout(r, 100));
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), /ESRCH/);
  await ws.cleanup();
});

test('stop escalates to SIGKILL when the group ignores SIGTERM', async () => {
  const ws = await tmpWorkspace();
  const start = `trap '' TERM; echo $$ > pid; ${process.execPath} -e "process.on('SIGTERM', () => {}); require('node:http').createServer((q, s) => s.end('ok')).listen(process.env.PORT, process.env.HOST)"`;
  ws.runner = new Runner({ dir: ws.dir, recipe: recipe({ start }), stampDir: ws.stampDir, killDelayMs: 200 });
  await ws.runner.start();
  const pid = Number(await fsp.readFile(path.join(ws.dir, 'pid'), 'utf8'));
  const t0 = Date.now();
  await ws.runner.stop();
  assert.ok(Date.now() - t0 >= 150, 'waited for the kill delay');
  await new Promise((r) => setTimeout(r, 100));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  await ws.cleanup();
});

// Static runners are enough to observe pool lifecycle: stop() flips state.
async function staticRunner() {
  const ws = await tmpWorkspace();
  await fsp.writeFile(path.join(ws.dir, 'index.html'), 'x');
  const runner = new Runner({ dir: ws.dir, recipe: recipe({ kind: 'static' }), stampDir: ws.stampDir });
  await runner.start();
  return { runner, cleanup: ws.cleanup };
}

test('RunnerPool stops an idle runner after the last viewer leaves', async () => {
  const pool = new RunnerPool({ idleMs: 100 });
  const a = await staticRunner();
  pool.set('ws1', a.runner);
  assert.equal(pool.get('ws1'), a.runner);
  pool.acquire('ws1');
  pool.acquire('ws1');
  pool.release('ws1');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(a.runner.state, 'ready', 'one viewer still connected');
  pool.release('ws1');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(a.runner.state, 'stopped');
  assert.equal(pool.get('ws1'), undefined);
  await a.cleanup();
});

test('RunnerPool acquire cancels a pending idle timer', async () => {
  const pool = new RunnerPool({ idleMs: 100 });
  const a = await staticRunner();
  pool.set('ws1', a.runner);
  pool.acquire('ws1');
  pool.release('ws1');
  pool.acquire('ws1');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(a.runner.state, 'ready');
  assert.equal(pool.get('ws1'), a.runner);
  await pool.stopAll();
  assert.equal(a.runner.state, 'stopped');
  assert.equal(pool.get('ws1'), undefined);
  await a.cleanup();
});

test('RunnerPool set replaces and stops the previous runner; stop removes by key', async () => {
  const pool = new RunnerPool({ idleMs: 100 });
  const a = await staticRunner();
  const b = await staticRunner();
  pool.set('ws1', a.runner);
  pool.set('ws1', b.runner);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(a.runner.state, 'stopped');
  assert.equal(pool.get('ws1'), b.runner);
  await pool.stop('ws1');
  assert.equal(b.runner.state, 'stopped');
  assert.equal(pool.get('ws1'), undefined);
  await pool.stop('missing');
  await a.cleanup();
  await b.cleanup();
});

test('RunnerPool set keeps the connected viewers of the runner it replaces', async () => {
  const pool = new RunnerPool({ idleMs: 50 });
  const a = await staticRunner();
  const b = await staticRunner();
  pool.set('ws1', a.runner);
  pool.acquire('ws1');
  pool.set('ws1', b.runner); // e.g. the recipe changed while someone watches
  pool.acquire('ws1'); // a second tab comes and goes
  pool.release('ws1');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(pool.get('ws1'), b.runner, 'still watched, so not idle');
  pool.release('ws1');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(pool.get('ws1'), undefined);
  await a.cleanup();
  await b.cleanup();
});
