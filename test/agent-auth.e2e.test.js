// End-to-end: the web sign-in flow against the real Dialogue server and the
// real omp binary, with a fake model provider served from this process.
// The provider is an omp extension (discovered from the temp HOME) whose
// login sends the browser to the fake server and completes when the code
// from that page is pasted back — the remote-browser path.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const OMP_BIN = process.env.DIALOGUE_OMP || 'omp';
const AUTH_CODE = 'fake-code-4242';
const API_KEY = 'fake-key-9f1c';

const ompAvailable = spawnSync(OMP_BIN, ['--version'], { stdio: 'ignore' }).status === 0;

const chunk = (delta, finish) => `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'fake-model', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

// OpenAI-compatible completions plus the "sign in" page a browser would land on.
function fakeProvider() {
  const state = { mode: 'ok', requests: [] };
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/authorize')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body><p>Your code: <code id="code">${AUTH_CODE}</code></p></body></html>`);
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      state.requests.push({ authorization: req.headers.authorization });
      req.resume();
      req.on('end', () => {
        if (state.mode !== 'ok' || req.headers.authorization !== `Bearer ${API_KEY}`) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(`${chunk({ role: 'assistant', content: 'OK' }, null)}${chunk({}, 'stop')}data: [DONE]\n\n`);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, base: `http://127.0.0.1:${server.address().port}` })));
}

const extensionSource = (base) => `
export default function (pi) {
  pi.registerProvider('fake-cloud', {
    baseUrl: '${base}/v1',
    api: 'openai-completions',
    authHeader: true,
    models: [{ id: 'fake-model', name: 'Fake Model', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8000, maxTokens: 1000 }],
    oauth: {
      name: 'Fake Cloud',
      async login(callbacks) {
        callbacks.onAuth({ url: '${base}/authorize?state=abc', instructions: 'Sign in on the page that opens.' });
        callbacks.onProgress?.('Waiting for browser authentication...');
        const raw = await callbacks.onPrompt({ message: 'Paste the authorization code (or full redirect URL):' });
        const code = raw.includes('code=') ? new URL(raw).searchParams.get('code') : raw.trim();
        if (code !== '${AUTH_CODE}') throw new Error('The code was not accepted.');
        return '${API_KEY}';
      }
    }
  });
}
`;

function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function api(base, method, route, body) {
  const response = await fetch(`${base}${route}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}

// Collect SSE events; `next(name)` resolves with the first event of that name.
function subscribe(url) {
  const events = [];
  const waiters = [];
  const settle = () => {
    for (const waiter of [...waiters]) {
      const hit = events.find((entry) => entry.event === waiter.name && !entry.taken);
      if (hit) {
        hit.taken = true;
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(hit.data);
      }
    }
  };
  const request = http.get(url, (res) => {
    let buffer = '';
    res.setEncoding('utf8');
    res.on('data', (piece) => {
      buffer += piece;
      let index;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        let event = 'message';
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7);
          else if (line.startsWith('data: ')) data += line.slice(6);
        }
        if (data) events.push({ event, data: JSON.parse(data) });
      }
      settle();
    });
  });
  return {
    events,
    next: (name, timeoutMs = 60000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No "${name}" event within ${timeoutMs}ms; saw ${JSON.stringify(events)}`)), timeoutMs);
      waiters.push({ name, resolve: (value) => { clearTimeout(timer); resolve(value); } });
      settle();
    }),
    close: () => request.destroy()
  };
}

async function waitForServer(base, child) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Server did not start.');
}

test('a designer signs in to a model provider from the web UI and the agent becomes ready', { skip: ompAvailable ? false : `${OMP_BIN} is not on PATH` }, async (t) => {
  const provider = await fakeProvider();
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dialogue-agent-e2e-'));
  const home = path.join(tmp, 'home');
  const dataRoot = path.join(tmp, 'data');
  await fsp.mkdir(path.join(home, '.omp', 'agent', 'extensions'), { recursive: true });
  await fsp.writeFile(path.join(home, '.omp', 'agent', 'extensions', 'fake-cloud.js'), extensionSource(provider.base));

  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.endsWith('_API_KEY') || key.startsWith('PI_') || key.startsWith('OMP_')) continue;
    env[key] = value;
  }
  const port = await freePort();
  Object.assign(env, { HOME: home, DIALOGUE_DATA: dataRoot, PORT: String(port), HOST: '127.0.0.1' });
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: tmp, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '';
  server.stdout.on('data', (piece) => { serverLog += piece; });
  server.stderr.on('data', (piece) => { serverLog += piece; });
  t.after(async () => {
    server.kill('SIGTERM');
    provider.server.close();
    await new Promise((resolve) => server.on('exit', resolve));
    await fsp.rm(tmp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(base, server);

  // 3. Nothing is signed in: not ready.
  const before = await api(base, 'POST', '/api/agent/check');
  assert.equal(before.status, 200, serverLog);
  assert.equal(before.body.status.ready, false);
  assert.equal(before.body.status.reason, 'not-connected');
  assert.equal(before.body.model, 'openrouter/anthropic/claude-opus-5.5');
  assert.equal(provider.state.requests.length, 0);

  // 4. The GUI flow: pick the provider, open its page, paste the code back.
  const providers = await api(base, 'GET', '/api/agent/providers');
  const fake = providers.body.providers.find((entry) => entry.id === 'fake-cloud');
  assert.deepEqual(fake, { id: 'fake-cloud', name: 'Fake Cloud', authenticated: false });

  const started = await api(base, 'POST', '/api/agent/login', { providerId: 'fake-cloud' });
  assert.equal(started.status, 201);
  const stream = subscribe(`${base}/api/agent/login/${started.body.id}/events`);
  t.after(() => stream.close());
  const opened = await stream.next('open_url');
  assert.ok(opened.url.startsWith(`${provider.base}/authorize`), opened.url);
  assert.equal(opened.instructions, 'Sign in on the page that opens.');
  const page = await (await fetch(opened.url)).text();
  const code = /<code id="code">([^<]+)<\/code>/.exec(page)[1];
  await stream.next('input');
  const tooEarly = await api(base, 'POST', `/api/agent/login/${started.body.id}/input`, { value: '' });
  assert.equal(tooEarly.status, 400);
  // The browser lands on a redirect URL the user copies wholesale.
  const pasted = await api(base, 'POST', `/api/agent/login/${started.body.id}/input`, { value: `http://localhost:54549/callback?code=${code}&state=abc` });
  assert.equal(pasted.status, 202);
  const done = await stream.next('done', 90000);
  assert.equal(done.status.ready, true, JSON.stringify(done.status));
  assert.equal(done.status.model, 'fake-cloud/fake-model');
  assert.ok(stream.events.some((entry) => entry.event === 'progress' && /Waiting for browser/.test(entry.data.message)));

  // 5. Ready, the probe carried the issued key, and the choice persisted.
  const after = await api(base, 'GET', '/api/agent');
  assert.equal(after.body.status.ready, true);
  assert.equal(after.body.model, 'fake-cloud/fake-model');
  assert.ok(provider.state.requests.length >= 1);
  assert.ok(provider.state.requests.every((entry) => entry.authorization === `Bearer ${API_KEY}`));
  assert.deepEqual(JSON.parse(await fsp.readFile(path.join(dataRoot, 'agent.json'), 'utf8')), { model: 'fake-cloud/fake-model' });
  const signedIn = await api(base, 'GET', '/api/agent/providers');
  assert.equal(signedIn.body.providers.find((entry) => entry.id === 'fake-cloud').authenticated, true);
  const models = await api(base, 'GET', '/api/agent/models');
  assert.ok(models.body.models.some((entry) => entry.id === 'fake-cloud/fake-model'));
  assert.ok(!models.body.models.some((entry) => entry.provider === 'dialogue-bootstrap'));

  // 6. The provider starts rejecting the key.
  provider.state.mode = 'reject';
  const rejected = await api(base, 'POST', '/api/agent/check');
  assert.equal(rejected.body.status.ready, false);
  assert.equal(rejected.body.status.reason, 'rejected', rejected.body.status.detail);
});
