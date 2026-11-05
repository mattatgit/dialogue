const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentAuth, publicLoginProviders, loginURL } = require('../server/agent-auth.js');

test('ChatGPT has one account row, canonical authentication and device/browser choices', () => {
  const canonical = { id: 'openai-codex', name: 'ChatGPT Plus/Pro', authenticated: true };
  const alias = { id: 'openai-codex-device', name: 'Headless', authenticated: false };
  const custom = { id: 'custom', name: 'Custom', authenticated: false };
  assert.deepEqual(publicLoginProviders([canonical, alias, custom, { ...canonical, authenticated: false }]), [
    { id: 'openai-codex', name: 'ChatGPT', authenticated: true, loginMethods: ['device', 'browser'] }, custom
  ]);
  assert.deepEqual(publicLoginProviders([canonical, { ...alias, available: false }])[0].loginMethods, ['browser']);
  assert.deepEqual(publicLoginProviders([canonical])[0].loginMethods, ['browser']);
});

test('sign-in links allow HTTPS and local test providers, never executable or credential-bearing URLs', () => {
  for (const url of ['https://auth.openai.com/codex/device', 'http://localhost:1234/auth', 'http://127.0.0.1:1234/auth', 'http://[::1]:1234/auth']) assert.equal(loginURL(url), url);
  for (const url of ['javascript:alert(1)', 'data:text/html,test', '//evil.example', 'http://evil.example/auth', 'https://user:secret@example.com', 'garbage']) assert.equal(loginURL(url), null);
});

test('device selection uses the canonical account for verification and keeps a browser fallback', async () => {
  for (const [method, available, expected] of [['auto', true, 'openai-codex-device'], ['browser', true, 'openai-codex'], ['auto', false, 'openai-codex'], ['device', false, null]]) {
    const auth = Object.create(AgentAuth.prototype);
    auth.model = 'other/previous';
    const calls = [], events = [];
    const session = { providerId: 'openai-codex', loginProviderId: 'openai-codex', requestedMethod: method, method: 'browser', ended: false,
      push(event, data) { events.push({ event, data }); } };
    const rpc = { ready: Promise.resolve(), exited: Promise.resolve(), child: { workerFinished: Promise.resolve() }, close() { calls.push('close'); },
      async request(command) {
        calls.push(command);
        if (command.type === 'get_login_providers') return { providers: available ? [{ id: 'openai-codex-device' }] : [] };
        if (command.type === 'get_available_models') return { models: [{ id: 'fake', provider: 'openai-codex', name: 'Fake' }] };
        return {};
      } };
    auth.withEmptyCwd = async fn => fn('/unused');
    auth.runOmp = async () => { assert.equal(calls.at(-1), 'close'); return { code: 1 }; };
    auth.setModel = async model => ({ ready: true, model });
    if (!expected) { await assert.rejects(auth.driveLogin(session, rpc), /not available.*browser/i); continue; }
    await auth.driveLogin(session, rpc);
    assert.equal(calls.find(c => c.type === 'login').providerId, expected);
    assert.equal(events.at(-1).data.status.model, 'openai-codex/fake');
    assert.equal(session.method, expected.endsWith('-device') ? 'device' : 'browser');
  }
});

test('invalid method requests do not cancel an existing sign-in', async () => {
  const auth = Object.create(AgentAuth.prototype);
  auth.cancelLogin = () => assert.fail('must validate before cancellation');
  await assert.rejects(auth.startLogin('openai-codex', 'unknown'), { status: 400 });
  await assert.rejects(auth.startLogin('another-provider', 'device'), { status: 400 });
});
