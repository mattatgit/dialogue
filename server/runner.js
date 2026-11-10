// Runs one workspace's preview recipe: an optional install step, a dev
// server in its own process group, and a readiness poll. Node builtins only.
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { message: workerMessage } = require('./worker-observation.js');
const { EventEmitter } = require('node:events');
const { spawnWorker, killWorker } = require('./workers.js');
const { readProjectFile, openProjectFile, inside } = require('./project-files.js');

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
    const content = await readProjectFile(dir, path.join(cwd, name), 8 * 1024 * 1024).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
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
  constructor({ dir, recipe, stampDir, env = {}, runtime = null, killDelayMs = KILL_DELAY_MS, attribution = {} }) {
    super();
    this.dir = dir;
    this.recipe = recipe;
    this.stampDir = stampDir;
    this.env = env;
    this.runtime = runtime; this.attribution = attribution; this.logWrite = Promise.resolve();
    this.abort = new AbortController();
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
    this.partial = parts.pop().slice(-8192);
    for (const line of parts) {
      this.lines.push(line);
      this.emit('log', line);
      if (this.logFile && (this.loggedBytes || 0) < 4*1024*1024) { this.loggedBytes = (this.loggedBytes || 0) + Buffer.byteLength(line); const file = this.logFile; this.logWrite = this.logWrite.then(() => fsp.appendFile(file, line + '\n', { mode:0o600 })).catch(error => console.error('Preview evidence write failed:',error.message)); }
    }
    if (this.lines.length > LOG_LINES) this.lines.splice(0, this.lines.length - LOG_LINES);
  }

  fail(message, step, exitCode = null) {
    return new RunnerError(message, { step, exitCode, logTail: this.logTail() });
  }

  // Not async on purpose: callers compare the returned promise for identity.
  start() {
    if (this.stopping) return this.stopping.then(() => this.start());
    if (this.starting) return this.starting;
    if (this.abort.signal.aborted) this.abort = new AbortController();
    this.lines = [];
    this.partial = '';
    const attempt = this.run().catch(async (error) => {
      const child = this.child; if (child) { await this.killGroup(child); await child.workerFinished; }
      this.releaseOwnership();
      // stop() during startup already owns the state; otherwise leave the
      // failure visible but let a later start() try again.
      if (this.starting === attempt) {
        this.starting = null;
        this.child = null;
        this.error = error;
        this.setState('crashed', { error });
      }
      throw error;
    });
    this.starting = attempt;
    return attempt;
  }

  async run() {
    const generation = ++this.generation;
    await this.previousStopped;
    const logs = path.join(this.stampDir, 'attempts'); await fsp.mkdir(logs, { recursive:true, mode:0o700 });
    this.logFile = path.join(logs, randomUUID() + '.log'); this.loggedBytes = 0;
    await fsp.writeFile(this.logFile, '', { mode:0o600 });
    if (this.runtime?.previewOwners) {
      const owner = this.runtime.previewOwners.get(this.dir);
      if (owner && owner !== this) throw this.fail('This working copy already has a managed preview. Stop it before starting another.', 'ownership');
      this.runtime.previewOwners.set(this.dir, this);
    }
    const boundary = await fsp.realpath(this.dir);
    const root = await fsp.realpath(path.resolve(this.dir, this.recipe.root));
    if (!inside(root, boundary)) throw this.fail('The preview root leaves its working copy.', 'recipe');
    if (this.recipe.kind === 'static') return this.runStatic(root);
    await this.install(root);
    // stop() during install bumps the generation; do not go on to launch.
    if (this.generation !== generation) throw this.fail('Stopped during install.', 'install');
    await this.launch(root);
  }

  async runStatic(root) {
    const entry = this.recipe.entry === '/' ? 'index.html' : this.recipe.entry.replace(/^\//, '');
    const file = path.join(root, entry);
    const opened = await openProjectFile(root, file).catch(() => null);
    if (!opened) {
      throw this.fail(`Entry file ${entry} not found under ${this.recipe.root}.`, 'ready');
    }
    await opened.handle.close();
    if (this.abort.signal.aborted) throw this.fail('The preview was stopped.', 'ready');
    this.target = { kind: 'static', root, boundary: await fsp.realpath(this.dir) };
    this.setState('ready');
  }

  async install(cwd) {
    if (!this.recipe.install) return;
    const stamp = await installStamp(this.dir, this.recipe);
    const stampFile = path.join(this.stampDir, 'install.sha');
    if ((await fsp.readFile(stampFile, 'utf8').catch(() => null)) === stamp) return;
    this.setState('queued');
    const child = await spawnWorker(this.runtime, '/bin/sh', ['-c', this.recipe.install], { cwd, env: { ...process.env, ...this.env, CI: '1', FORCE_COLOR: '0' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }, { kind: 'install', attribution: this.attribution, workspaceRoot: this.dir, signal: this.abort.signal });
    this.child = child;
    this.setState('installing');
    child.stdout.on('data', (d) => this.appendLog(d));
    child.stderr.on('data', (d) => this.appendLog(d));
    const code = await new Promise((resolve) => child.on('close', resolve));
    await child.workerFinished;
    if (this.child === child) this.child = null;
    if (code !== 0) throw this.fail(child.workerRecord ? workerMessage(child.workerRecord) : `Install command exited with ${code}.`, 'install', code);
    await fsp.mkdir(this.stampDir, { recursive: true });
    await fsp.writeFile(stampFile, stamp);
  }

  async launch(cwd) {
    const port = await freePort();
    this.setState('queued');
    const env = { ...process.env, ...this.env, PORT: String(port), HOST: '127.0.0.1', BROWSER: 'none', FORCE_COLOR: '0', CI: '1' };
    // detached: the shell gets its own process group so stop() can take
    // down whatever it forked (node, esbuild, watchers) in one signal.
    const child = await spawnWorker(this.runtime, '/bin/sh', ['-c', this.recipe.start], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }, { kind: 'preview', attribution: this.attribution, workspaceRoot: this.dir, signal: this.abort.signal });
    this.child = child;
    this.setState('starting');
    child.stdout.on('data', (d) => this.appendLog(d));
    child.stderr.on('data', (d) => this.appendLog(d));
    const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
    const deadline = Date.now() + this.recipe.readyTimeoutSeconds * 1000;
    const host = await Promise.race([
      this.waitReady(child, port, deadline),
      exited.then(async ({ code, signal }) => { await child.workerFinished; throw this.fail(child.workerRecord ? workerMessage(child.workerRecord) : `Dev server exited on ${signal || code} before becoming ready.`, 'start', code); })
    ]);
    if (host === null) {
      child.workerReason = 'timeout'; await this.killGroup(child); await child.workerFinished;
      throw this.fail(`Dev server did not answer on port ${port} within ${this.recipe.readyTimeoutSeconds}s.`, 'ready');
    }
    this.target = { kind: 'server', host, port };
    this.setState('ready');
    exited.then(async ({ code, signal }) => {
      await child.workerFinished; this.releaseOwnership();
      if (this.child !== child) return; // stop() already took over
      this.child = null;
      this.target = null;
      this.starting = null;
      this.error = this.fail(child.workerRecord ? workerMessage(child.workerRecord) : `Dev server exited unexpectedly (${signal || code}).`, 'start', code);
      this.setState('crashed', { error:this.error });
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
    const signal = (sig) => killWorker(child, sig);
    signal('SIGTERM');
    let timer;
    await Promise.race([exited, new Promise((r) => { timer = setTimeout(r, this.killDelayMs); })]);
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      signal('SIGKILL');
      await exited;
    }
  }

  releaseOwnership() { if (this.runtime?.previewOwners?.get(this.dir) === this) this.runtime.previewOwners.delete(this.dir); }

  stop() {
    if (this.stopping) return this.stopping;
    const stopping = this.doStop().finally(() => { if (this.stopping === stopping) this.stopping = null; });
    this.stopping = stopping; return stopping;
  }

  async doStop() {
    const pending = this.starting;
    if (this.child) this.child.workerReason ||= 'cancelled';
    this.abort.abort();
    const child = this.child;
    this.generation += 1;
    this.child = null;
    this.starting = null;
    this.target = null;
    if (child) await this.killGroup(child);
    if (child) await child.workerFinished;
    await pending?.catch(() => {});
    await this.logWrite; this.releaseOwnership();
    this.setState('stopped');
  }
}

// Runners keyed by workspace id, stopped once nobody has looked at their
// preview for idleMs. acquire/release count connected viewers.
class RunnerPool {
  constructor({ idleMs = 10 * 60 * 1000 } = {}) {
    this.idleMs = idleMs;
    this.entries = new Map(); // key -> { runner, viewers, timer }
    this.closing = new Map(); // key -> complete cleanup; survives entry removal
  }

  get(key) {
    return this.entries.get(key)?.runner;
  }

  // Replacing a runner (e.g. after a recipe change) keeps its viewers.
  set(key, runner) {
    const previous = this.entries.get(key);
    if (previous) {
      clearTimeout(previous.timer);
    }
    runner.previousStopped = previous ? this.stop(key) : this.closing.get(key);
    const viewers = previous?.viewers || 0;
    const entry = { runner, viewers, timer: null };
    this.entries.set(key, entry);
    if (!viewers) entry.timer = setTimeout(() => this.stop(key).catch(() => {}), this.idleMs);
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

  stop(key) {
    const entry = this.entries.get(key);
    if (!entry) return this.closing.get(key) || Promise.resolve();
    clearTimeout(entry.timer);
    this.entries.delete(key);
    const stopping = entry.runner.stop().finally(() => { if (this.closing.get(key) === stopping) this.closing.delete(key); });
    this.closing.set(key, stopping);
    return stopping;
  }

  async stopAll() {
    await Promise.all([...this.entries.keys()].map(key => this.stop(key)).concat([...this.closing.values()]));
  }
}

module.exports = { Runner, RunnerError, RunnerPool, installStamp };
