// Per-project SSH deploy keys. Fetching stays on the project's HTTPS URL;
// pushing goes over SSH with a key Dialogue generates on first use and the
// user registers as a deploy key (write access) on the hosting site.
// Node builtins only; shells out to `ssh-keygen` / `ssh-keyscan`.
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const SSH_BIN = process.env.DIALOGUE_SSH || 'ssh';
const SSH_KEYGEN_BIN = process.env.DIALOGUE_SSH_KEYGEN || 'ssh-keygen';
const SSH_KEYSCAN_BIN = process.env.DIALOGUE_SSH_KEYSCAN || 'ssh-keyscan';

// --- pure helpers ---------------------------------------------------------

// Parse a git remote URL into { host, port, owner, repo }. Accepts the HTTPS
// form and, for completeness, scp-like and ssh:// forms.
function parseRemote(url) {
  if (typeof url !== 'string') return null;
  let m = /^https?:\/\/(?:[^@/]+@)?([^/:]+)(?::(\d+))?\/(.+?)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
  if (m) return { host: m[1], port: m[2] ? Number(m[2]) : null, owner: m[3], repo: m[4] };
  m = /^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::(\d+))?\/(.+?)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
  if (m) return { host: m[1], port: m[2] ? Number(m[2]) : null, owner: m[3], repo: m[4] };
  m = /^(?:[^@:]+@)?([^/:]+):(.+?)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
  if (m) return { host: m[1], port: null, owner: m[2], repo: m[3] };
  return null;
}

function pushUrl(url) {
  const remote = parseRemote(url);
  if (!remote) return null;
  if (remote.port) return `ssh://git@${remote.host}:${remote.port}/${remote.owner}/${remote.repo}.git`;
  return `git@${remote.host}:${remote.owner}/${remote.repo}.git`;
}

// Where the user registers the key, plus the site-specific wording the UI
// shows. `kind` is one of github | gitlab | gitea | generic.
function hostingSetup(url) {
  const remote = parseRemote(url);
  if (!remote) return null;
  const base = `https://${remote.host}${remote.port ? `:${remote.port}` : ''}/${remote.owner}/${remote.repo}`;
  if (remote.host === 'github.com') {
    return { kind: 'github', name: 'GitHub', settingsUrl: `${base}/settings/keys/new`, writeOption: 'Allow write access', addButton: 'Add key' };
  }
  if (remote.host === 'gitlab.com' || remote.host.startsWith('gitlab.')) {
    return { kind: 'gitlab', name: 'GitLab', settingsUrl: `${base}/-/settings/repository`, writeOption: 'Grant write permissions to this key', addButton: 'Add key' };
  }
  if (remote.host === 'codeberg.org' || remote.host.startsWith('gitea.') || remote.host.startsWith('forgejo.')) {
    return { kind: 'gitea', name: remote.host, settingsUrl: `${base}/settings/keys`, writeOption: 'Enable Write Access', addButton: 'Add Deploy Key' };
  }
  return { kind: 'generic', name: remote.host, settingsUrl: base, writeOption: 'write access', addButton: 'Add key' };
}

// POSIX single-quote for use inside core.sshCommand (parsed by /bin/sh).
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function sshCommand(privateKeyPath, knownHostsPath) {
  return [
    SSH_BIN,
    '-i', shellQuote(privateKeyPath),
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${shellQuote(knownHostsPath)}`
  ].join(' ');
}

// Map ssh/git stderr to a reason the UI can act on.
function classifyPushError(stderr) {
  const text = String(stderr || '');
  if (/Permission denied \(publickey\)|Could not read from remote repository|Host key verification failed/i.test(text)) return 'key';
  if (/Repository not found|does not appear to be a git repository|Authentication failed|could not read Username/i.test(text)) return 'repo';
  if (/Could not resolve hostname|Connection (timed out|refused)|Network is unreachable|timed out/i.test(text)) return 'network';
  return 'unknown';
}

// --- filesystem / process ----------------------------------------------------

class DeployKeys {
  constructor(root) {
    this.root = root;
    this.knownHostsPath = path.join(root, 'known_hosts');
    this.scanned = new Set();
  }

  privatePath(slug) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`Invalid project slug: ${slug}`);
    return path.join(this.root, slug);
  }

  async ensure(slug, url) {
    const privatePath = this.privatePath(slug);
    const publicPath = `${privatePath}.pub`;
    await fsp.mkdir(this.root, { recursive: true, mode: 0o700 });
    const exists = await fsp.access(privatePath).then(() => true, () => false);
    if (!exists) {
      await fsp.rm(publicPath, { force: true });
      await execFileAsync(SSH_KEYGEN_BIN, ['-q', '-t', 'ed25519', '-N', '', '-C', `dialogue-${slug}`, '-f', privatePath]);
      await fsp.chmod(privatePath, 0o600);
    }
    const remote = parseRemote(url);
    if (remote) await this.ensureKnownHost(remote.host, remote.port);
    return {
      privatePath,
      publicKey: (await fsp.readFile(publicPath, 'utf8')).trim(),
      sshCommand: sshCommand(privatePath, this.knownHostsPath)
    };
  }

  async remove(slug) {
    const privatePath = this.privatePath(slug);
    await fsp.rm(privatePath, { force: true });
    await fsp.rm(`${privatePath}.pub`, { force: true });
  }

  async ensureKnownHost(host, port) {
    const key = port ? `[${host}]:${port}` : host;
    if (this.scanned.has(key)) return;
    const existing = await fsp.readFile(this.knownHostsPath, 'utf8').catch(() => '');
    if (existing.split('\n').some((line) => line.startsWith(`${key} `) || line.startsWith(`${key},`))) {
      this.scanned.add(key);
      return;
    }
    const args = ['-T', '10', '-t', 'ed25519,rsa,ecdsa'];
    if (port) args.push('-p', String(port));
    args.push(host);
    let stdout = '';
    try {
      ({ stdout } = await execFileAsync(SSH_KEYSCAN_BIN, args));
    } catch (error) {
      stdout = String(error.stdout || '');
    }
    const lines = stdout.split('\n').filter((line) => line && !line.startsWith('#'));
    if (!lines.length) throw new Error(`Could not read the SSH host key of ${host}.`);
    await fsp.appendFile(this.knownHostsPath, `${lines.join('\n')}\n`, { mode: 0o600 });
    this.scanned.add(key);
  }
}

module.exports = {
  DeployKeys,
  classifyPushError,
  hostingSetup,
  parseRemote,
  pushUrl,
  shellQuote,
  sshCommand
};
