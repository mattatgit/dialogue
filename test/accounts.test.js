const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Accounts, accountConfig, AccountError, DAY } = require('../server/accounts.js');
const { authenticator } = require('./helpers/passkey-fixture.js');
const { AccountAgents } = require('../server/agent-accounts.js');
const { AsyncLocalStorage } = require('node:async_hooks');

function fixture(t, mode = 'test') {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dialogue-accounts-'));
  const env = { DIALOGUE_MODE: mode, DIALOGUE_ORIGIN: 'http://localhost:4174', DIALOGUE_OWNER_EMAIL: 'owner@example.test', DIALOGUE_INITIAL_MEMBERS: 'editor@example.test' };
  let now = Date.now(); const mail = [];
  const config = accountConfig(env);
  const store = new Accounts({ dataRoot, config, sendMail: async message => mail.push(message), clock: () => now });
  t.after(() => { try { store.close(); } catch {} fs.rmSync(dataRoot, { recursive: true, force: true }); });
  const signin = async (email = config.ownerEmail) => {
    const start = await store.startEmail(email, 'test');
    const code = mail.at(-1)?.text.match(/code is (\d{6})/)[1];
    const raw = store.verifyEmail(start.challengeId, code);
    assert.ok(raw);
    return { raw, req: { headers: { cookie: `${config.cookieName}=${raw}` } } };
  };
  return { store, dataRoot, env, mail, signin, advance: value => { now += value; } };
}

test('sessions survive a server restart, expire, and are revoked on logout/member removal', async t => {
  const f = fixture(t); const signed = await f.signin(); const id = f.store.identity(signed.req);
  assert.equal(id.workspace.role, 'owner'); assert.ok(!fs.readFileSync(path.join(f.dataRoot, 'accounts.sqlite')).includes(signed.raw));
  const second = new Accounts({ dataRoot: f.dataRoot, config: accountConfig(f.env), sendMail: async () => {} });
  assert.equal(second.identity(signed.req).user.id, id.user.id); second.close();
  f.store.logout(id); assert.equal(f.store.identity(signed.req), null);
  const editor = await f.signin('editor@example.test'); const editorId = f.store.identity(editor.req).user.id;
  const owner = f.store.identity((await f.signin()).req);
  f.store.removeMember(owner, editorId); assert.equal(f.store.identity(editor.req), null);
  const revived = new Accounts({ dataRoot: f.dataRoot, config: accountConfig(f.env), sendMail: async () => {} });
  assert.equal(revived.member(editorId), undefined, 'startup does not re-invite a removed member'); revived.close();
  f.advance(31 * DAY); assert.equal(f.store.identity({ headers: { cookie: `${f.store.config.cookieName}=${signed.raw}` } }), null);
});

test('email codes are private, single-use, bounded, expiring and invitation-only', async t => {
  const f = fixture(t);
  const start = await f.store.startEmail('owner@example.test', 'ip');
  const code = f.mail.at(-1).text.match(/code is (\d{6})/)[1];
  assert.ok(!JSON.stringify(f.store.db.prepare('SELECT * FROM challenges').all()).includes(code));
  const wrong = code === '000000' ? '000001' : '000000';
  for (let i = 0; i < 5; i++) assert.equal(f.store.verifyEmail(start.challengeId, wrong), null);
  assert.throws(() => f.store.verifyEmail(start.challengeId, code), /expired/);
  const retry = await f.store.startEmail('owner@example.test', 'ip'); const good = f.mail.at(-1).text.match(/code is (\d{6})/)[1];
  assert.ok(f.store.verifyEmail(retry.challengeId, good)); assert.throws(() => f.store.verifyEmail(retry.challengeId, good), /expired/);
  const count = f.mail.length; const outsider = await f.store.startEmail('outsider@example.test', 'ip');
  assert.equal(f.mail.length, count); assert.equal(outsider.message, start.message); assert.equal(f.store.verifyEmail(outsider.challengeId, '123456'), null);
  f.advance(15 * DAY); const expiredInvite = await f.store.startEmail('editor@example.test', 'ip'); assert.equal(f.mail.length, count); assert.equal(f.store.verifyEmail(expiredInvite.challengeId, '123456'), null);
});

test('email rate limits persist and challenge expiry prevents late verification', async t => {
  const f = fixture(t); const first = await f.store.startEmail('owner@example.test', 'ip'); const code = f.mail.at(-1).text.match(/code is (\d{6})/)[1];
  for (let i = 1; i < 5; i++) await f.store.startEmail('owner@example.test', 'ip');
  await assert.rejects(f.store.startEmail('owner@example.test', 'ip'), error => error.status === 429);
  f.advance(11 * 60000); assert.throws(() => f.store.verifyEmail(first.challengeId, code), /expired/);
});

test('email delivery failures do not reveal whether an address is invited', async t => {
  const f = fixture(t); f.store.sendMail = async () => { throw new Error('mail unavailable'); };
  const known = await f.store.startEmail('owner@example.test', 'ip');
  const unknown = await f.store.startEmail('nobody@example.test', 'ip');
  assert.equal(known.message, unknown.message);
  assert.throws(() => f.store.verifyEmail(known.challengeId, '123456'), /expired/);
});

test('passkey registration and login verify real ES256 signatures and reject replay/origin/RP/user-verification failures', async t => {
  const f = fixture(t); const { req } = await f.signin(); const identity = f.store.identity(req); const device = authenticator(); const origin = f.store.config.origin;
  let registration = await f.store.registrationOptions(identity);
  await f.store.register(identity, { challengeId: registration.challengeId, credential: device.register(registration.options, origin), name: 'Test device' });
  assert.equal(f.store.keys(identity.user.id).length, 1);
  await assert.rejects(f.store.register(identity, { challengeId: registration.challengeId, credential: device.register(registration.options, origin) }), /expired/);
  let login = await f.store.authenticationOptions('ip'); const credential = device.authenticate(login.options, origin);
  const raw = await f.store.authenticate({ challengeId: login.challengeId, credential }); assert.ok(raw);
  await assert.rejects(f.store.authenticate({ challengeId: login.challengeId, credential }), /expired/);
  for (const overrides of [{ origin: 'https://evil.example' }, { rpID: 'evil.example' }, { verified: false }]) {
    login = await f.store.authenticationOptions('ip');
    await assert.rejects(f.store.authenticate({ challengeId: login.challengeId, credential: device.authenticate(login.options, overrides.origin || origin, overrides) }), /could not sign in/);
  }
  const invalid = authenticator(); registration = await f.store.registrationOptions(identity);
  await assert.rejects(f.store.register(identity, { challengeId: registration.challengeId, credential: invalid.register(registration.options, 'https://evil.example') }), /could not be verified/);
  const another = await f.signin('editor@example.test'); const other = f.store.identity(another.req);
  registration = await f.store.registrationOptions(identity);
  await assert.rejects(f.store.register(other, { challengeId: registration.challengeId, credential: invalid.register(registration.options, origin) }), /expired/);
  f.store.removeMember(identity, other.user.id); assert.equal(f.store.identity(another.req), null);
  f.advance(11 * 60000); await assert.rejects(f.store.registrationOptions(identity), /Sign in again/);
});

test('membership, editing ownership and model profiles are separate per person', async t => {
  const f = fixture(t); const owner = f.store.identity((await f.signin()).req); const editor = f.store.identity((await f.signin('editor@example.test')).req);
  assert.throws(() => f.store.requireOwner(editor), error => error.status === 403);
  f.store.claimEditor('repo/prototype-one', owner); f.store.claimEditor('repo/prototype-two', editor);
  assert.throws(() => f.store.claimEditor('repo/prototype-one', editor), error => error.status === 409);
  const context = new AsyncLocalStorage(); const agents = new AccountAgents({ accounts: f.store, context, dataRoot: f.dataRoot, appRoot: path.resolve(__dirname, '..') });
  const ownerAgent = context.run(owner, () => agents.current()); const memberAgent = context.run(editor, () => agents.current());
  assert.notEqual(memberAgent.settingsPath, ownerAgent.settingsPath); assert.notEqual(memberAgent.ompEnv().DIALOGUE_TMUX_SERVER, ownerAgent.ompEnv().DIALOGUE_TMUX_SERVER);
  assert.ok(memberAgent.ompEnv().HOME.startsWith(f.dataRoot)); assert.equal(ownerAgent.ompEnv().HOME, undefined);
  agents.shutdown();
});

test('development identity shortcuts cannot be enabled on public origins or production', t => {
  const f = fixture(t, 'development'); assert.ok(f.store.developmentSession('owner@example.test'));
  const strict = fixture(t); assert.throws(() => strict.store.developmentSession('owner@example.test'), error => error.status === 404);
  assert.throws(() => accountConfig({ ...f.env, NODE_ENV: 'production' }), /loopback/);
  assert.throws(() => accountConfig({ ...f.env, HOST: '0.0.0.0' }), /loopback/);
  assert.throws(() => accountConfig({ ...f.env, DIALOGUE_ORIGIN: 'https://dialogue.example.com' }), /loopback/);
  assert.throws(() => accountConfig({ DIALOGUE_MODE: 'production' }), /DIALOGUE_ORIGIN/);
  assert.throws(() => accountConfig({ DIALOGUE_MODE: 'production', DIALOGUE_ORIGIN: 'http://dialogue.example.com', DIALOGUE_OWNER_EMAIL: 'owner@example.test' }), /HTTPS/);
  assert.throws(() => f.store.checkOrigin({ method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' } }), error => error.status === 403);
  const productionConfig = accountConfig({ DIALOGUE_MODE: 'production', NODE_ENV: 'production', DIALOGUE_ORIGIN: 'https://dialogue.example.com', DIALOGUE_OWNER_EMAIL: 'owner@example.test', DIALOGUE_SMTP_URL: 'smtps://mail.example.com', DIALOGUE_MAIL_FROM: 'Dialogue <dialogue@example.com>' });
  assert.equal(productionConfig.cookieName, '__Host-dialogue-session');
  assert.equal(productionConfig.local, false);
});
