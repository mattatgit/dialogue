// One ttyd per branch workspace, listening on a UNIX socket, running omp
// inside a tmux session so the agent survives browser disconnects. Dialogue
// proxies WebSocket upgrades to the socket (see server.js).
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');

const execFileAsync = promisify(execFile);

const TTYD_BIN = process.env.DIALOGUE_TTYD || 'ttyd';
const TMUX_BIN = process.env.DIALOGUE_TMUX || 'tmux';
const OMP_BIN = process.env.DIALOGUE_OMP || 'omp';
const START_TIMEOUT_MS = 8000;

class TerminalError extends Error {}

function ompThemesDir() {
  const home = os.homedir();
  const profile = (process.env.OMP_PROFILE ?? process.env.PI_PROFILE ?? '').trim();
  if (profile && profile !== 'default') return path.join(home, '.omp', 'profiles', profile, 'agent', 'themes');
  if (process.env.PI_CODING_AGENT_DIR) return path.join(process.env.PI_CODING_AGENT_DIR, 'themes');
  return path.join(home, '.omp', 'agent', 'themes');
}

async function installTheme(appRoot) {
  const source = path.join(appRoot, 'omp', 'dialogue-theme.json');
  const dir = ompThemesDir();
  const target = path.join(dir, 'dialogue.json');
  const content = await fsp.readFile(source);
  const existing = await fsp.readFile(target).catch(() => null);
  if (existing && existing.equals(content)) return;
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(target, content);
}

function sessionPrefix(workspaceId) {
  return `dialogue-${createHash('sha1').update(workspaceId).digest('hex').slice(0, 12)}`;
}

function waitForSocket(socketPath, child) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + START_TIMEOUT_MS;
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    const onExit = (code) => reject(new TerminalError(`ttyd exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
    child.once('exit', onExit);
    child.once('error', (error) => reject(new TerminalError(`Could not start ttyd: ${error.message}`)));
    const attempt = () => {
      if (child.exitCode !== null) return;
      const probe = net.connect({ path: socketPath });
      probe.once('connect', () => {
        probe.destroy();
        child.off('exit', onExit);
        resolve();
      });
      probe.once('error', () => {
        probe.destroy();
        if (Date.now() > deadline) reject(new TerminalError('ttyd did not start listening in time.'));
        else setTimeout(attempt, 100);
      });
    };
    setTimeout(attempt, 50);
  });
}

class TerminalManager {
  constructor({ appRoot, agentAuth }) {
    this.appRoot = appRoot;
    this.agentAuth = agentAuth;
    this.terminals = new Map();
    this.socketDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialogue-term-'));
  }

  basePath(id) {
    return `/ws/terminal/${id}`;
  }

  async ensure(workspace) {
    const existing = this.terminals.get(workspace.id);
    if (existing) return existing.starting;

    const record = { child: null, socketPath: null, starting: null };
    this.terminals.set(workspace.id, record);
    record.starting = this.start(workspace, record).catch((error) => {
      if (this.terminals.get(workspace.id) === record) this.terminals.delete(workspace.id);
      throw error;
    });
    return record.starting;
  }

  async start(workspace, record) {
    const prefix = sessionPrefix(workspace.id);
    const socketPath = path.join(this.socketDir, `${prefix.slice('dialogue-'.length)}.sock`);
    await Promise.all([fsp.rm(socketPath, { force: true }), installTheme(this.appRoot)]);

    // ttyd runs omp/attach.sh per client; the script owns the tmux session
    // (own server via -L so it inherits Dialogue's environment, e.g. API
    // keys) and rotates the session whenever the omp overlay or the model
    // arguments change. DIALOGUE_OMP_ARGS is word-split by the shell: model
    // ids never contain whitespace.
    const ttydArgs = [
      '-i', socketPath, '-W', '-b', this.basePath(workspace.id), '-T', 'xterm-256color',
      '-t', 'disableLeaveAlert=true',
      '/bin/sh', path.join(this.appRoot, 'omp', 'attach.sh')
    ];

    const child = spawn(TTYD_BIN, ttydArgs, {
      cwd: workspace.dir,
      env: {
        ...process.env,
        ...this.agentAuth.ompEnv(),
        DIALOGUE_OMP_ARGS: this.agentAuth.ompArgs().join(' '),
        COLORTERM: 'truecolor',
        DIALOGUE_APP: this.appRoot,
        DIALOGUE_WORKSPACE: workspace.id,
        DIALOGUE_WORKSPACE_DIR: workspace.dir,
        DIALOGUE_SESSION: prefix,
        DIALOGUE_TMUX: TMUX_BIN,
        DIALOGUE_OMP: OMP_BIN
      },
      stdio: ['ignore', 'ignore', 'pipe']
    });
    record.child = child;
    record.socketPath = socketPath;
    child.on('exit', () => {
      if (this.terminals.get(workspace.id) === record) this.terminals.delete(workspace.id);
      fsp.rm(socketPath, { force: true }).catch(() => {});
    });
    // waitForSocket attaches its 'error' listener in the same tick as spawn.
    await waitForSocket(socketPath, child);
    return { socketPath };
  }

  stop(id) {
    const record = this.terminals.get(id);
    if (!record) return;
    this.terminals.delete(id);
    record.child?.kill('SIGTERM');
  }

  stopAll() {
    for (const id of [...this.terminals.keys()]) this.stop(id);
  }

  // Type `text` into the workspace's omp session as if the user had entered
  // it. attach.sh names sessions `<prefix>-<overlay checksum>`; the live one
  // is whichever currently exists under the prefix.
  async sendPrompt(workspace, text) {
    let sessions = '';
    try {
      ({ stdout: sessions } = await execFileAsync(TMUX_BIN, ['-L', 'dialogue', 'list-sessions', '-F', '#S']));
    } catch {
      // no tmux server: no sessions
    }
    const prefix = `${sessionPrefix(workspace.id)}-`;
    const session = sessions.split('\n').find((name) => name.startsWith(prefix));
    if (!session) throw new TerminalError('Open the agent terminal first, then try again.');
    // `<session>:` targets the session's current window exactly (no
    // prefix matching against other session names).
    await execFileAsync(TMUX_BIN, ['-L', 'dialogue', 'send-keys', '-t', `${session}:`, '-l', text]);
    await execFileAsync(TMUX_BIN, ['-L', 'dialogue', 'send-keys', '-t', `${session}:`, 'Enter']);
  }

  shutdown() {
    this.stopAll();
    fs.rmSync(this.socketDir, { recursive: true, force: true });
  }
}

module.exports = { TerminalManager, TerminalError };
