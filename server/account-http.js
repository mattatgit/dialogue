const { AccountError } = require('./accounts.js');

function accountHttp({ accounts, readJson, sendJson, onRevoke = () => {}, onRelease = async () => {} }) {
  const finish = async (req, res, raw) => {
    const previous = accounts.identity(req);
    if (previous) { accounts.logout(previous); await onRevoke(previous.user.id, previous.session.hash); }
    res.setHeader('Set-Cookie', accounts.cookie(raw));
    sendJson(res, 200, { signedIn: true });
  };
  return async (req, res, url) => {
    const route = url.pathname;
    if (!route.startsWith('/api/auth/') && !route.startsWith('/api/account/')) return false;
    if (!['GET', 'HEAD'].includes(req.method)) accounts.checkOrigin(req);
    const body = () => readJson(req);
    const ip = req.socket.remoteAddress;
    if (route === '/api/auth/session' && req.method === 'GET') {
      const identity = accounts.identity(req);
      sendJson(res, 200, { user: identity?.user || null, workspace: identity?.workspace || null,
        development: accounts.config.mode === 'development',
        ...(accounts.config.mode === 'development' ? { developmentAccounts: accounts.members().map(m => ({ email: m.email, name: m.name })) } : {}) });
      return true;
    }
    if (route === '/api/auth/email/start' && req.method === 'POST') {
      sendJson(res, 200, await accounts.startEmail((await body()).email, ip)); return true;
    }
    if (route === '/api/auth/email/verify' && req.method === 'POST') {
      accounts.rate(`verify:${ip}`, 40);
      const { challengeId, code } = await body();
      const session = accounts.verifyEmail(challengeId, code);
      if (!session) throw new AccountError(400, 'That code is not valid. Please try again.');
      await finish(req, res, session); return true;
    }
    if (route === '/api/auth/passkey/options' && req.method === 'POST') {
      sendJson(res, 200, await accounts.authenticationOptions(ip)); return true;
    }
    if (route === '/api/auth/passkey/verify' && req.method === 'POST') {
      accounts.rate(`passkey-verify:${ip}`, 40);
      await finish(req, res, await accounts.authenticate(await body())); return true;
    }
    if (route === '/api/auth/development-session' && req.method === 'POST' && accounts.config.mode === 'development') {
      await finish(req, res, accounts.developmentSession((await body()).email)); return true;
    }
    const identity = accounts.requireIdentity(req);
    if (route === '/api/auth/logout' && req.method === 'POST') {
      accounts.logout(identity); await onRevoke(identity.user.id, identity.session.hash);
      res.setHeader('Set-Cookie', accounts.cookie('', true)); sendJson(res, 200, { signedOut: true }); return true;
    }
    if (route === '/api/account/profile' && req.method === 'PATCH') {
      const name = String((await body()).name || '').trim();
      if (!name || name.length > 80 || /[\u0000-\u001f]/.test(name)) throw new AccountError(400, 'Choose a name of 1–80 characters.');
      accounts.db.prepare('UPDATE users SET name=? WHERE id=?').run(name, identity.user.id);
      sendJson(res, 200, { saved: true }); return true;
    }
    if (route === '/api/account/members' && req.method === 'GET') {
      sendJson(res, 200, { members: accounts.members() }); return true;
    }
    if (route === '/api/account/members' && req.method === 'POST') {
      accounts.requireOwner(identity);
      const input = await body();
      const member = accounts.invite(input.email, input.name);
      // The invitation grants eligibility; the recipient verifies their own
      // email from the sign-in page. No unsolicited email is sent here.
      sendJson(res, 201, { member, signInUrl: accounts.config.origin }); return true;
    }
    const memberRoute = /^\/api\/account\/members\/([\w-]+)$/.exec(route);
    if (memberRoute && req.method === 'DELETE') {
      const copies = accounts.removeMember(identity, memberRoute[1]); await onRevoke(memberRoute[1], null, copies);
      sendJson(res, 200, { removed: true }); return true;
    }
    if (route === '/api/account/passkeys' && req.method === 'GET') {
      sendJson(res, 200, { passkeys: accounts.keys(identity.user.id) }); return true;
    }
    if (route === '/api/account/passkeys/options' && req.method === 'POST') {
      sendJson(res, 200, await accounts.registrationOptions(identity)); return true;
    }
    if (route === '/api/account/passkeys' && req.method === 'POST') {
      await accounts.register(identity, await body()); sendJson(res, 201, { saved: true }); return true;
    }
    const keyRoute = /^\/api\/account\/passkeys\/([\w-]+)$/.exec(route);
    if (keyRoute && req.method === 'DELETE') {
      accounts.removeKey(identity, keyRoute[1]); sendJson(res, 200, { removed: true }); return true;
    }
    if (route === '/api/account/editing' && req.method === 'GET') {
      const workingCopies = identity.workspace.role === 'owner'
        ? accounts.db.prepare('SELECT e.workspace_id AS id,u.name AS editorName FROM editors e JOIN users u ON u.id=e.user_id').all()
        : accounts.db.prepare('SELECT workspace_id AS id FROM editors WHERE user_id=?').all(identity.user.id);
      sendJson(res, 200, { workingCopies }); return true;
    }
    if (route === '/api/account/editing/release' && req.method === 'POST') {
      const id = (await body()).id;
      const editor = typeof id === 'string' && accounts.editor(id);
      if (!editor || (editor.id !== identity.user.id && identity.workspace.role !== 'owner')) throw new AccountError(403, 'This working copy belongs to another editor.');
      await onRelease(id, editor.id);
      sendJson(res, 200, { released: true }); return true;
    }
    throw new AccountError(404, 'Account action not found.');
  };
}
module.exports = { accountHttp };
