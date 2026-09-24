// Runs one workspace's preview recipe: an optional install step, a dev
// server in its own process group, and a readiness poll. Node builtins only.
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');

// Files whose contents decide whether `install` must run again.
const MANIFESTS = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'requirements.txt', 'Gemfile.lock'];
const LOG_LINES = 500;
const POLL_MS = 250;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const KILL_DELAY_MS = 5000;

class RunnerError extends Error {
  constructor(message, { step, exitCode = null, logTail = '' }) {
    super(message);
    this.step = step;
    this.exitCode = exitCode;
    this.logTail = logTail;
  }
}

// sha256 over the install command and every manifest that exists in cwd.
async function installStamp(dir, recipe) {
  const cwd = path.resolve(dir, recipe.root);
  const hash = crypto.createHash('sha256');
  hash.update(String(recipe.install));
  for (const name of MANIFESTS) {
    const content = await fsp.readFile(path.join(cwd, name)).catch(() => null);
    if (content === null) continue;
    hash.update(`\0${name}\0`);
    hash.update(content);
  }
  return hash.digest('hex');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

class Runner extends EventEmitter {
  constructor({ dir, recipe, stampDir, env = {}, killDelayMs = KILL_DELAY_MS }) {
    super();
    this.dir = dir;
    this.recipe = recipe;
    this.stampDir = stampDir;
    this.env = env;
    this.killDelayMs = killDelayMs;
    this.state = 'stopped';
    this.target = null;
    this.starting = null;
    this.child = null;
    this.generation = 0;
    this.lines = [];
    this.partial = '';
  }

  setState(state, extra = {}) {
    this.state = state;
    this.emit('state', state, extra);
  }

  logTail(n = 80) {
    return this.lines.slice(-n).join('\n');
  }

  appendLog(chunk) {
    this.partial += String(chunk).replace(ANSI, '');
    const parts = this.partial.split(/\r?\n/);
    this.partial = parts.pop();
    for (const line of parts) {
      this.lines.push(line);
      this.emit('log', line);
    }
    if (this.lines.length > LOG_LINES) this.lines.splice(0, this.lines.length - LOG_LINES);
  }

  fail(message, step, exitCode = null) {
    return new RunnerError(message, { step, exitCode, logTail: this.logTail() });
  }

  // Not async on purpose: callers compare the returned promise for identity.
  start() {
    if (this.starting) return this.starting;
    this.lines = [];
    this.partial = '';
    const attempt = this.run().catch((error) => {
      // stop() during startup already owns the state; otherwise leave the
      // failure visible but let a later start() try again.
      if (this.starting === attempt) {
        this.starting = null;
        this.child = null;
        this.setState('crashed', { error });
      }
      throw error;
    });
    this.starting = attempt;
    return attempt;
  }

  async run() {
    const generation = ++this.generation;
    const root = path.resolve(this.dir, this.recipe.root);
    if (this.recipe.kind === 'static') return this.runStatic(root);
    await this.install(root);
    // stop() during install bumps the generation; do not go on to launch.
    if (this.generation !== generation) throw this.fail('Stopped during install.', 'install');
    await this.launch(root);
  }

  async runStatic(root) {
    const entry = this.recipe.entry === '/' ? 'index.html' : this.recipe.entry.replace(/^\//, '');
    const file = path.join(root, entry);
    if (!(await fsp.stat(file).then((s) => s.isFile(), () => false))) {
      throw this.fail(`Entry file ${entry} not found under ${this.recipe.root}.`, 'ready');
    }
    this.target = { kind: 'static', root };
    this.setState('ready');
  }

  async install(cwd) {
    if (!this.recipe.install) return;
    const stamp = await installStamp(this.dir, this.recipe);
    const stampFile = path.join(this.stampDir, 'install.sha');
    if ((await fsp.readFile(stampFile, 'utf8').catch(() => null)) === stamp) return;
    this.setState('installing');
    const child = spawn('/bin/sh', ['-c', this.recipe.install], { cwd, env: { ...process.env, ...this.env, CI: '1', FORCE_COLOR: '0' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    child.stdout.on('data', (d) => this.appendLog(d));
    child.stderr.on('data', (d) => this.appendLog(d));
    const code = await new Promise((resolve) => child.on('close', resolve));
    if (this.child === child) this.child = null;
    if (code !== 0) throw this.fail(`Install command exited with ${code}.`, 'install', code);
    await fsp.mkdir(this.stampDir, { recursive: true });
    await fsp.writeFile(stampFile, stamp);
  }

  async launch(cwd) {
    const port = await freePort();
    this.setState('starting');
    const env = { ...process.env, ...this.env, PORT: String(port), HOST: '127.0.0.1', BROWSER: 'none', FORCE_COLOR: '0', CI: '1' };
    // detached: the shell gets its own process group so stop() can take
    // down whatever it forked (node, esbuild, watchers) in one signal.
    const child = spawn('/bin/sh', ['-c', this.recipe.start], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    child.stdout.on('data', (d) => this.appendLog(d));
    child.stderr.on('data', (d) => this.appendLog(d));
    const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
    const deadline = Date.now() + this.recipe.readyTimeoutSeconds * 1000;
    const host = await Promise.race([
      this.waitReady(child, port, deadline),
      exited.then(({ code }) => { throw this.fail(`Dev server exited with ${code} before becoming ready.`, 'start', code); })
    ]);
    if (host === null) {
      await this.killGroup(child);
      throw this.fail(`Dev server did not answer on port ${port} within ${this.recipe.readyTimeoutSeconds}s.`, 'ready');
    }
    this.target = { kind: 'server', host, port };
    this.setState('ready');
    exited.then(({ code, signal }) => {
      if (this.child !== child) return; // stop() already took over
      this.child = null;
      this.target = null;
      this.starting = null;
      this.setState('crashed', { error: this.fail(`Dev server exited unexpectedly (${signal || code}).`, 'start', code) });
    });
  }

  // Poll both loopback addresses: a server bound to `localhost` may listen
  // on ::1 only. Resolves with the host that answered, null on timeout, and
  // gives up silently once the child is gone or replaced.
  async waitReady(child, port, deadline) {
    while (this.child === child && child.exitCode === null) {
      for (const host of ['127.0.0.1', '::1']) {
        if (await this.probe(host, port)) return host;
      }
      if (Date.now() >= deadline) return null;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return new Promise(() => {}); // let the exit branch of the race win
  }

  probe(host, port) {
    return new Promise((resolve) => {
      const req = http.request({ host, port, path: this.recipe.entry, method: 'GET', headers: { host: `localhost:${port}` }, timeout: 2000 }, (res) => {
        res.resume();
        resolve(res.statusCode < 400);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => req.destroy());
      req.end();
    });
  }

  // SIGTERM the process group, SIGKILL it if it is still around after the delay.
  async killGroup(child) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    const signal = (sig) => { try { process.kill(-child.pid, sig); } catch {} };
    signal('SIGTERM');
    let timer;
    await Promise.race([exited, new Promise((r) => { timer = setTimeout(r, this.killDelayMs); })]);
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      signal('SIGKILL');
      await exited;
    }
  }

  async stop() {
    const child = this.child;
    this.generation += 1;
    this.child = null;
    this.starting = null;
    this.target = null;
    if (child) await this.killGroup(child);
    this.setState('stopped');
  }
}

// Runners keyed by workspace id, stopped once nobody has looked at their
// preview for idleMs. acquire/release count connected viewers.
class RunnerPool {
  constructor({ idleMs = 10 * 60 * 1000 } = {}) {
    this.idleMs = idleMs;
    this.entries = new Map(); // key -> { runner, viewers, timer }
  }

  get(key) {
    return this.entries.get(key)?.runner;
  }

  // Replacing a runner (e.g. after a recipe change) keeps its viewers.
  set(key, runner) {
    const previous = this.entries.get(key);
    if (previous) {
      clearTimeout(previous.timer);
      previous.runner.stop().catch(() => {});
    }
    const viewers = previous?.viewers || 0;
    const entry = { runner, viewers, timer: null };
    this.entries.set(key, entry);
    if (previous && !viewers) entry.timer = setTimeout(() => this.stop(key).catch(() => {}), this.idleMs);
  }

  acquire(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.viewers += 1;
    clearTimeout(entry.timer);
    entry.timer = null;
  }

  release(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.viewers = Math.max(0, entry.viewers - 1);
    if (entry.viewers > 0) return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.stop(key).catch(() => {}), this.idleMs);
  }

  async stop(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.entries.delete(key);
    await entry.runner.stop();
  }

  async stopAll() {
    await Promise.all([...this.entries.keys()].map((key) => this.stop(key)));
  }
}

module.exports = { Runner, RunnerError, RunnerPool, installStamp };
