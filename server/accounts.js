// Dialogue identity is independent of OMP provider credentials and Git worktrees.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomInt, createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DAY = 86400000;
const token = () => randomBytes(32).toString('base64url');
const digest = (value) => createHash('sha256').update(String(value)).digest('hex');
const emailAddress = (value) => {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@<>"(),:;\\]+@[^\s@<>"(),:;\\]+\.[a-z]{2,}$/.test(email)) throw new AccountError(400, 'Enter a valid email address.');
  return email;
};
class AccountError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function accountConfig(env = process.env) {
  const mode = env.DIALOGUE_MODE || 'production';
  if (!['production', 'development', 'test'].includes(mode)) throw new Error('Choose a valid DIALOGUE_MODE.');
  const local = mode !== 'production';
  const origin = new URL(env.DIALOGUE_ORIGIN || (local ? `http://localhost:${env.PORT || 4173}` : 'https://invalid.invalid'));
  if (origin.origin !== origin.href.replace(/\/$/, '') || origin.username || origin.password || origin.hostname === 'invalid.invalid') throw new Error('Set DIALOGUE_ORIGIN to the exact Dialogue web origin.');
  if (local && (env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || !['127.0.0.1', 'localhost', '::1'].includes(env.HOST || '127.0.0.1'))) throw new Error('Development/test accounts require a loopback-only server and origin outside production.');
  if (!local && origin.protocol !== 'https:') throw new Error('Production accounts require an HTTPS DIALOGUE_ORIGIN.');
  const ownerEmail = emailAddress(env.DIALOGUE_OWNER_EMAIL || (local ? 'owner@example.test' : ''));
  if (!local && (!env.DIALOGUE_SMTP_URL || !env.DIALOGUE_MAIL_FROM)) throw new Error('Production accounts require DIALOGUE_SMTP_URL and DIALOGUE_MAIL_FROM.');
  if (!local) {
    let smtp;
    try { smtp = new URL(env.DIALOGUE_SMTP_URL); } catch { throw new Error('Set a valid SMTP delivery URL.'); }
    if (!['smtp:', 'smtps:'].includes(smtp.protocol)) throw new Error('Email delivery requires SMTP with TLS.');
  }
  return { mode, local, origin: origin.origin, rpID: origin.hostname, ownerEmail,
    workspaceName: env.DIALOGUE_WORKSPACE_NAME || 'Idealogue', ownerName: env.DIALOGUE_OWNER_NAME || 'Owner',
    initialMembers: (env.DIALOGUE_INITIAL_MEMBERS || '').split(',').filter(Boolean).map(emailAddress),
    smtpURL: env.DIALOGUE_SMTP_URL, mailFrom: env.DIALOGUE_MAIL_FROM,
    cookieName: local ? 'dialogue-session' : '__Host-dialogue-session' };
}

class Accounts {
  constructor({ dataRoot, config, sendMail, clock = Date.now }) {
    this.config = config;
    this.clock = clock;
    this.sendMail = sendMail;
    fs.mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(dataRoot, 'accounts.sqlite'));
    fs.chmodSync(path.join(dataRoot, 'accounts.sqlite'), 0o600);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members (user_id TEXT PRIMARY KEY REFERENCES users(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id), role TEXT NOT NULL CHECK(role IN ('owner','editor')), invited_at INTEGER NOT NULL, expires_at INTEGER);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id TEXT REFERENCES users(id), session_hash TEXT, value TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), public_key BLOB NOT NULL, counter INTEGER NOT NULL, transports TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, starts_at INTEGER NOT NULL, count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS editors (workspace_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id));`);
    this.db.prepare('INSERT OR IGNORE INTO metadata VALUES (?,?)').run('pepper', token());
    this.pepper = this.db.prepare('SELECT value FROM metadata WHERE key=?').get('pepper').value;
    this.db.prepare('INSERT OR IGNORE INTO workspaces VALUES (?,?)').run('shared', config.workspaceName);
    // Bootstrap once only. Subsequent restarts must not re-add removed members.
    if (!this.db.prepare('SELECT 1 FROM metadata WHERE key=?').get('bootstrapped')) {
      this.transaction(() => {
        this.invite(config.ownerEmail, config.ownerName, 'owner');
        for (const email of config.initialMembers) if (email !== config.ownerEmail) this.invite(email, null, 'editor');
        this.db.prepare('INSERT INTO metadata VALUES (?,?)').run('bootstrapped', '1');
      });
    }
    this.ownerId = this.db.prepare("SELECT user_id FROM members WHERE role='owner'").get().user_id;
    this.prune();
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  prune() {
    const now = this.clock();
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    this.db.prepare('DELETE FROM challenges WHERE expires_at <= ?').run(now);
    this.db.prepare('DELETE FROM limits WHERE starts_at < ?').run(now - DAY);
  }
  user(id) { return this.db.prepare('SELECT id,email,name,verified FROM users WHERE id=?').get(id); }
  member(id) {
    return this.db.prepare('SELECT u.id,u.email,u.name,u.verified,m.role,m.workspace_id,w.name AS workspace_name,m.expires_at AS invitation_expires FROM users u JOIN members m ON m.user_id=u.id JOIN workspaces w ON w.id=m.workspace_id WHERE u.id=?').get(id);
  }
  invite(rawEmail, name, role = 'editor') {
    const email = emailAddress(rawEmail);
    const id = this.db.prepare('SELECT id FROM users WHERE email=?').get(email)?.id || token();
    const localName = email.split('@')[0];
    const cleanName = String(name || localName.charAt(0).toUpperCase() + localName.slice(1)).trim().slice(0, 80);
    this.db.prepare('INSERT OR IGNORE INTO users(id,email,name) VALUES (?,?,?)').run(id, email, cleanName || 'Member');
    this.db.prepare('INSERT OR IGNORE INTO members VALUES (?,?,?,?,?)').run(id, 'shared', role, this.clock(), role === 'owner' ? null : this.clock() + 14 * DAY);
    if (role !== 'owner' && !this.user(id).verified) this.db.prepare("UPDATE members SET expires_at=? WHERE user_id=? AND role='editor'").run(this.clock() + 14 * DAY, id);
    return this.member(id);
  }
  requireOwner(identity) {
    if (this.member(identity.user.id)?.role !== 'owner') throw new AccountError(403, 'Only the workspace owner can manage members.');
  }
  members() { return this.db.prepare('SELECT u.id,u.email,u.name,u.verified,m.role,m.expires_at FROM members m JOIN users u ON u.id=m.user_id ORDER BY m.invited_at,u.email').all(); }
  removeMember(identity, id) {
    this.requireOwner(identity);
    if (id === this.ownerId) throw new AccountError(409, 'The workspace owner cannot be removed.');
    const copies = this.db.prepare('SELECT workspace_id AS id FROM editors WHERE user_id=?').all(id);
    this.transaction(() => {
      this.db.prepare('DELETE FROM members WHERE user_id=?').run(id);
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      this.db.prepare('DELETE FROM challenges WHERE user_id=?').run(id);
      this.db.prepare('DELETE FROM editors WHERE user_id=?').run(id);
    });
    return copies;
  }
  rate(key, max, window = 15 * 60000) {
    const row = this.db.prepare('SELECT * FROM limits WHERE key=?').get(key);
    if (!row || row.starts_at + window <= this.clock()) this.db.prepare('INSERT OR REPLACE INTO limits VALUES (?,?,1)').run(key, this.clock());
    else {
      if (row.count >= max) throw new AccountError(429, 'Too many attempts. Please try again later.');
      this.db.prepare('UPDATE limits SET count=count+1 WHERE key=?').run(key);
    }
  }
  cookie(value, clear = false) {
    return `${this.config.cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 30 * 86400}${this.config.local ? '' : '; Secure'}`;
  }
  createSession(id) {
    if (!this.member(id)?.verified) throw new AccountError(403, 'This account does not have access to the workspace.');
    const raw = token();
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(digest(raw), id, this.clock(), this.clock() + 30 * DAY);
    return raw;
  }
  identity(req) {
    const cookies = String(req.headers.cookie || '').split(';').map(s => s.trim());
    const raw = cookies.find(s => s.startsWith(`${this.config.cookieName}=`))?.slice(this.config.cookieName.length + 1);
    if (!raw || !/^[\w-]{43}$/.test(raw)) return null;
    const hash = digest(raw);
    const session = this.db.prepare('SELECT * FROM sessions WHERE hash=? AND expires_at>?').get(hash, this.clock());
    const member = session && this.member(session.user_id);
    if (!member?.verified) return null;
    return { user: { id: member.id, email: member.email, name: member.name }, workspace: { id: member.workspace_id, name: member.workspace_name, role: member.role }, session };
  }
  requireIdentity(req) {
    const identity = this.identity(req);
    if (!identity) throw new AccountError(401, 'Sign in to Dialogue to continue.');
    return identity;
  }
  requireFresh(identity) {
    if (!this.db.prepare('SELECT 1 FROM sessions WHERE hash=? AND user_id=? AND expires_at>?').get(identity.session.hash, identity.user.id, this.clock())) throw new AccountError(401, 'Sign in again before changing passkeys.');
    if (identity.session.created_at + 10 * 60000 < this.clock()) throw new AccountError(428, 'Sign in again before changing passkeys.');
  }
  checkOrigin(req) {
    if (req.headers.origin !== this.config.origin) throw new AccountError(403, 'This request must come from Dialogue.');
    if (req.method !== 'GET' && req.method !== 'DELETE' && !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new AccountError(415, 'Send a JSON request.');
  }
  logout(identity) {
    this.db.prepare('DELETE FROM sessions WHERE hash=?').run(identity.session.hash);
    this.db.prepare('DELETE FROM challenges WHERE session_hash=?').run(identity.session.hash);
  }
  challenge(kind, value, userId = null, sessionHash = null) {
    this.prune();
    const id = token();
    this.db.prepare('INSERT INTO challenges(id,kind,user_id,session_hash,value,expires_at) VALUES (?,?,?,?,?,?)').run(id, kind, userId, sessionHash, value, this.clock() + 10 * 60000);
    return id;
  }
  takeChallenge(id, kind, sessionHash = null) {
    const row = this.db.prepare('SELECT * FROM challenges WHERE id=? AND kind=? AND expires_at>?').get(String(id || ''), kind, this.clock());
    if (!row || row.session_hash !== sessionHash) throw new AccountError(400, 'This sign-in has expired. Please start again.');
    this.db.prepare('DELETE FROM challenges WHERE id=?').run(row.id);
    return row;
  }
  async startEmail(rawEmail, address) {
    const email = emailAddress(rawEmail);
    this.rate(`ip:${address}`, 20);
    this.rate(`email:${digest(email)}`, 5);
    const user = this.db.prepare('SELECT id FROM users WHERE email=?').get(email);
    const member = user && this.member(user.id);
    const allowed = member && (member.verified || member.invitation_expires === null || member.invitation_expires > this.clock());
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const hashed = createHmac('sha256', this.pepper).update(`${email}:${code}`).digest('hex');
    const id = this.challenge('email', JSON.stringify({ email, hashed }), allowed ? member.id : null);
    if (allowed) {
      try { await this.sendMail({ to: email, subject: 'Your Dialogue sign-in code', text: `Your Dialogue sign-in code is ${code}. It expires in 10 minutes.\n\nOpen ${this.config.origin}/ to sign in. If you did not request this code, ignore this email.` }); }
      catch { this.db.prepare('DELETE FROM challenges WHERE id=?').run(id); console.warn('Dialogue could not deliver a sign-in email. Check the mail configuration.'); }
    }
    return { challengeId: id, message: 'If this address is invited to Dialogue, a sign-in code is on its way.' };
  }
  verifyEmail(id, code) {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM challenges WHERE id=? AND kind='email' AND expires_at>?").get(String(id || ''), this.clock());
      if (!row || row.attempts >= 5) throw new AccountError(400, 'This code has expired. Request a new one.');
      const { email, hashed } = JSON.parse(row.value);
      const candidate = createHmac('sha256', this.pepper).update(`${email}:${String(code)}`).digest();
      if (!row.user_id || !timingSafeEqual(candidate, Buffer.from(hashed, 'hex'))) {
        // Commit failed attempts too: throwing inside this transaction would roll them back.
        this.db.prepare('UPDATE challenges SET attempts=attempts+1 WHERE id=?').run(row.id);
        return null;
      }
      const member = this.member(row.user_id);
      if (!member || (!member.verified && member.invitation_expires !== null && member.invitation_expires <= this.clock())) return null;
      this.db.prepare('DELETE FROM challenges WHERE id=?').run(row.id);
      this.db.prepare('UPDATE users SET verified=1 WHERE id=?').run(row.user_id);
      this.db.prepare('UPDATE members SET expires_at=NULL WHERE user_id=?').run(row.user_id);
      return this.createSession(row.user_id);
    });
  }
  developmentSession(rawEmail) {
    if (!this.config.local || this.config.mode !== 'development') throw new AccountError(404, 'Not found.');
    const email = emailAddress(rawEmail);
    const user = this.db.prepare('SELECT id FROM users WHERE email=?').get(email);
    if (!user || !this.member(user.id)) throw new AccountError(403, 'Choose a configured development account.');
    this.db.prepare('UPDATE users SET verified=1 WHERE id=?').run(user.id);
    this.db.prepare('UPDATE members SET expires_at=NULL WHERE user_id=?').run(user.id);
    return this.createSession(user.id);
  }
  keys(id) { return this.db.prepare('SELECT id,name,created_at FROM passkeys WHERE user_id=? ORDER BY created_at').all(id); }
  async registrationOptions(identity) {
    this.requireFresh(identity);
    const { generateRegistrationOptions } = await import('@simplewebauthn/server');
    const options = await generateRegistrationOptions({ rpName: 'Dialogue', rpID: this.config.rpID,
      userName: identity.user.email, userDisplayName: identity.user.name, userID: Buffer.from(identity.user.id),
      supportedAlgorithmIDs: [-7, -257],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: this.keys(identity.user.id).map(k => ({ id: k.id })) });
    return { options, challengeId: this.challenge('register', options.challenge, identity.user.id, identity.session.hash) };
  }
  async register(identity, { challengeId, credential, name }) {
    this.requireFresh(identity);
    const challenge = this.takeChallenge(challengeId, 'register', identity.session.hash);
    if (challenge.user_id !== identity.user.id) throw new AccountError(400, 'Invalid passkey registration.');
    const { verifyRegistrationResponse } = await import('@simplewebauthn/server');
    let result;
    try { result = await verifyRegistrationResponse({ response: credential, expectedChallenge: challenge.value, expectedOrigin: this.config.origin, expectedRPID: this.config.rpID, requireUserVerification: true, supportedAlgorithmIDs: [-7, -257] }); }
    catch { throw new AccountError(400, 'The passkey could not be verified. Please try again.'); }
    if (!result.verified || !this.member(identity.user.id)) throw new AccountError(400, 'The passkey could not be verified.');
    this.requireFresh(identity);
    const key = result.registrationInfo.credential;
    try { this.db.prepare('INSERT INTO passkeys VALUES (?,?,?,?,?,?,?)').run(key.id, identity.user.id, Buffer.from(key.publicKey), key.counter, JSON.stringify(key.transports || []), String(name || 'Passkey').trim().slice(0, 80) || 'Passkey', this.clock()); }
    catch { throw new AccountError(409, 'This passkey has already been added.'); }
  }
  async authenticationOptions(address) {
    this.rate(`passkey:${address}`, 30);
    const { generateAuthenticationOptions } = await import('@simplewebauthn/server');
    const options = await generateAuthenticationOptions({ rpID: this.config.rpID, userVerification: 'required' });
    return { options, challengeId: this.challenge('authenticate', options.challenge) };
  }
  async authenticate({ challengeId, credential }) {
    const challenge = this.takeChallenge(challengeId, 'authenticate');
    const key = this.db.prepare('SELECT * FROM passkeys WHERE id=?').get(String(credential?.id || ''));
    if (!key || !this.member(key.user_id)?.verified) throw new AccountError(400, 'This passkey could not sign in.');
    const { verifyAuthenticationResponse } = await import('@simplewebauthn/server');
    let result;
    try { result = await verifyAuthenticationResponse({ response: credential, expectedChallenge: challenge.value, expectedOrigin: this.config.origin, expectedRPID: this.config.rpID,
      credential: { id: key.id, publicKey: new Uint8Array(key.public_key), counter: key.counter, transports: JSON.parse(key.transports) }, requireUserVerification: true }); }
    catch { throw new AccountError(400, 'This passkey could not sign in.'); }
    if (!result.verified) throw new AccountError(400, 'This passkey could not sign in.');
    this.db.prepare('UPDATE passkeys SET counter=? WHERE id=?').run(result.authenticationInfo.newCounter, key.id);
    return this.createSession(key.user_id);
  }
  removeKey(identity, id) {
    this.requireFresh(identity);
    this.db.prepare('DELETE FROM passkeys WHERE id=? AND user_id=?').run(id, identity.user.id);
  }
  editor(workspaceId) {
    return this.db.prepare('SELECT u.id,u.name FROM editors e JOIN users u ON u.id=e.user_id WHERE e.workspace_id=?').get(workspaceId);
  }
  claimEditor(workspaceId, identity) {
    this.db.prepare('INSERT OR IGNORE INTO editors VALUES (?,?)').run(workspaceId, identity.user.id);
    const editor = this.editor(workspaceId);
    if (editor.id !== identity.user.id) throw new AccountError(409, `${editor.name} has this working copy. They can release it in Settings before you edit it.`);
  }
  close() { this.db.close(); }
}

function mailer(config, dataRoot) {
  if (config.local) return async (message) => {
    const dir = path.join(dataRoot, 'mail');
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.promises.writeFile(path.join(dir, `${token()}.json`), JSON.stringify(message), { mode: 0o600 });
  };
  const smtp = new URL(config.smtpURL);
  for (const [key, value] of Object.entries({ requireTLS: 'true', ignoreTLS: 'false', 'tls.rejectUnauthorized': 'true', connectionTimeout: '10000', greetingTimeout: '10000', socketTimeout: '20000' })) smtp.searchParams.set(key, value);
  const transport = require('nodemailer').createTransport(smtp.href);
  return (message) => transport.sendMail({ ...message, from: config.mailFrom });
}
module.exports = { Accounts, AccountError, accountConfig, mailer, emailAddress, digest, DAY };
