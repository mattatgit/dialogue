const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { seedAccounts } = require('./helpers/account-fixture.js');
const { authenticator } = require('./helpers/passkey-fixture.js');

async function fixture(t, mode = 'test') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dialogue-accounts-http-'));
  const port = await new Promise(resolve => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const data = path.join(root, 'data'); const account = seedAccounts(data, port); const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.resolve(__dirname, '../server.js')], { env: { ...process.env, ...account.env, DIALOGUE_MODE: mode, DIALOGUE_DATA: data, DIALOGUE_SEED: '', DIALOGUE_OMP: path.resolve(__dirname, 'helpers/fake-omp.js'), HOME: root }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', b => { log += b; }); child.stderr.on('data', b => { log += b; });
  t.after(async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); } await fs.rm(root, { recursive: true, force: true }); });
  let ready = false;
  for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error(log); try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 100)); }
  assert.ok(ready, log);
  const request = async (route, { method = 'GET', body, cookie = account.headers.Cookie, headers = {}, redirect = 'manual' } = {}) => {
    const response = await fetch(origin + route, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), redirect });
    const text = await response.text(); let json; try { json = JSON.parse(text); } catch {}
    return { status: response.status, headers: response.headers, json, text };
  };
  const emailSignIn = async email => {
    const start = await request('/api/auth/email/start', { method: 'POST', cookie: null, body: { email } });
    const files = await fs.readdir(path.join(data, 'mail'));
    const mail = await Promise.all(files.map(async f => JSON.parse(await fs.readFile(path.join(data, 'mail', f), 'utf8'))));
    const message = mail.filter(m => m.to === email).at(-1);
    const code = message.text.match(/code is (\d{6})/)[1];
    return request('/api/auth/email/verify', { method: 'POST', cookie: null, body: { challengeId: start.json.challengeId, code } });
  };
  return { root, data, origin, port, account, child, request, emailSignIn };
}

test('real server gates pages, APIs, streams and terminal; email/passkey login and logout use real sessions', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  for (const route of ['/api/projects', '/api/agent', '/api/account/members', '/api/workspaces/missing/main/events', '/api/projects/missing/preview/000.png']) assert.equal((await f.request(route, { cookie: null })).status, 401, route);
  for (const route of ['/projects.html', '/settings.html', '/workspace.html?id=missing', '/projects%2ehtml', '/projects.html/']) assert.equal((await f.request(route, { cookie: null })).status, 302, route);
  assert.match((await f.request('/', { cookie: null })).text, /Sign in with a passkey/);
  assert.equal((await f.request('/?reauth=1')).status, 200, 'a signed-in person can reauthenticate without a redirect loop');
  assert.equal((await f.request('/')).status, 302);
  assert.equal((await f.request('/api/auth/development-session', { method: 'POST', cookie: null, body: { email: 'owner@example.test' } })).status, 401);
  assert.equal((await f.request('/api/projects', { method: 'POST', body: {}, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await f.request('/api/projects', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await f.request('/api/projects', { method: 'POST', body: {}, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await f.request('/api/auth/session')).json.workspace.role, 'owner');
  const signed = await f.emailSignIn('editor@example.test'); assert.equal(signed.status, 200);
  const cookie = signed.headers.get('set-cookie').split(';')[0]; assert.match(signed.headers.get('set-cookie'), /HttpOnly.*SameSite=Lax/);
  assert.equal((await f.request('/api/auth/session', { cookie })).json.user.email, 'editor@example.test');
  assert.equal((await f.request('/api/account/members', { method: 'POST', cookie, body: { email: 'new@example.test' } })).status, 403);
  const invited = await f.request('/api/account/members', { method: 'POST', body: { email: 'new@example.test', name: 'New member' } }); assert.equal(invited.status, 201);
  const device = authenticator(); const options = (await f.request('/api/account/passkeys/options', { method: 'POST', cookie })).json;
  assert.equal((await f.request('/api/account/passkeys', { method: 'POST', cookie, body: { challengeId: options.challengeId, credential: device.register(options.options, f.origin) } })).status, 201);
  const authOptions = (await f.request('/api/auth/passkey/options', { method: 'POST', cookie: null })).json;
  const signedWithKey = await f.request('/api/auth/passkey/verify', { method: 'POST', cookie: null, body: { challengeId: authOptions.challengeId, credential: device.authenticate(authOptions.options, f.origin) } });
  assert.equal(signedWithKey.status, 200, signedWithKey.text);
  const passkeyCookie = signedWithKey.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.request('/api/auth/logout', { method: 'POST', cookie: passkeyCookie })).status, 200);
  assert.equal((await f.request('/api/projects', { cookie: passkeyCookie })).status, 401);
  const session = (await f.request('/api/auth/session', { cookie })).json;
  assert.equal((await f.request(`/api/account/members/${session.user.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await f.request('/api/projects', { cookie })).status, 401);
  const websocket = await new Promise(resolve => {
    const request = http.request(f.origin + '/ws/terminal/missing/main/ws', { headers: { Connection: 'Upgrade', Upgrade: 'websocket', Origin: f.origin, 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': Buffer.alloc(16).toString('base64') } });
    request.on('upgrade', (_res, socket, head) => { const chunks = [head]; socket.on('data', chunk => chunks.push(chunk)); socket.on('end', () => resolve(Buffer.concat(chunks).toString())); }); request.end();
  });
  assert.match(websocket, /Sign in to Dialogue/);
});

test('local development shortcut returns a normal session and remains explicit', { timeout: 15000 }, async t => {
  const f = await fixture(t, 'development');
  const info = await f.request('/api/auth/session', { cookie: null }); assert.equal(info.json.development, true);
  const local = await f.request('/api/auth/development-session', { method: 'POST', cookie: null, body: { email: 'editor@example.test' } }); assert.equal(local.status, 200);
  assert.equal((await f.request('/api/auth/session', { cookie: local.headers.get('set-cookie').split(';')[0] })).json.workspace.role, 'editor');
});
