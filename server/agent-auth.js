// Keeps omp signed in to a model provider without a terminal. Three jobs:
// the readiness check other code gates on (`omp token` presence check, then
// a live `omp -p` probe), the model selection every omp spawn shares, and
// the web sign-in flow driven over `omp --mode rpc` (the same machinery as
// omp's `/login`, so credentials land where omp expects them: agent.db).
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const OMP_BIN = process.env.DIALOGUE_OMP || 'omp';
const PROBE_TIMEOUT_MS = 60 * 1000;
const READY_TTL_MS = 10 * 60 * 1000;
const RPC_START_TIMEOUT_MS = 30 * 1000;
const RPC_CALL_TIMEOUT_MS = 30 * 1000;
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const PROBE_PROMPT = 'Reply with exactly: OK';
// Chat models worth picking first when a fresh sign-in cannot serve the
// current selection.
const MODEL_PREFERENCE = [/opus/i, /sonnet/i, /gpt-5/i, /gemini.*pro/i, /claude/i, /gpt/i];

class AgentAuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function configDefaultModel(configPath) {
  const text = fs.readFileSync(configPath, 'utf8');
  const match = /^modelRoles:[^\n]*\n(?:[ \t]+[^\n]*\n)*?[ \t]+default:[ \t]*([^\s#]+)/m.exec(text);
  return match ? match[1] : null;
}

function isModelId(value) {
  return typeof value === 'string' && /^[\w.-]+\/[\w./:-]+$/.test(value);
}

// Turn `omp -p` output into the reason a designer needs to act on.
function classifyFailure(text, timedOut) {
  if (timedOut) return ['unreachable', 'The model did not answer within a minute.'];
  if (/No models available|No API key/i.test(text)) return ['not-connected', 'No sign-in for this model yet.'];
  if (/\b401\b|\b403\b|invalid|unauthorized/i.test(text)) return ['rejected', 'The provider rejected the sign-in. Sign in again.'];
  if (/\b402\b|\b429\b|usage limit|quota|rate limit|insufficient/i.test(text)) return ['quota', 'The provider reports the account is out of credit or over its limit.'];
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|timeout|timed out|network/i.test(text)) return ['unreachable', 'The provider could not be reached.'];
  return ['unknown', 'The model did not answer as expected.'];
}

function lastLines(text, count = 6) {
  return text.trim().split('\n').filter((line) => line.trim() && line.trim() !== 'Working...').slice(-count).join('\n');
}

// One `omp --mode rpc` child: JSON lines in and out.
class RpcChild {
  constructor(args, { cwd, env }) {
    this.child = spawn(OMP_BIN, ['--mode', 'rpc', ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.frameHandlers = new Set();
    this.pending = new Map();
    this.nextId = 1;
    this.stderr = '';
    this.exited = new Promise((resolve) => {
      this.child.on('exit', (code) => resolve(code));
      this.child.on('error', () => resolve(-1));
    });
    this.child.stderr.on('data', (chunk) => { this.stderr = (this.stderr + chunk).slice(-4000); });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('omp did not start in time.')), RPC_START_TIMEOUT_MS);
      this.frameHandlers.add((frame) => {
        if (frame.type !== 'ready') return;
        clearTimeout(timer);
        resolve();
      });
      this.exited.then(() => {
        clearTimeout(timer);
        reject(new Error(lastLines(this.stderr) || 'omp exited before it was ready.'));
      });
    });
    this.ready.catch(() => {});
    const lines = readline.createInterface({ input: this.child.stdout });
    lines.on('line', (line) => {
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        return;
      }
      if (frame.type === 'response' && this.pending.has(frame.id)) {
        const { resolve, timer } = this.pending.get(frame.id);
        this.pending.delete(frame.id);
        clearTimeout(timer);
        resolve(frame);
      }
      for (const handler of this.frameHandlers) handler(frame);
    });
    this.exited.then(() => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error('omp stopped unexpectedly.'));
      }
      this.pending.clear();
    });
  }

  onFrame(handler) {
    this.frameHandlers.add(handler);
  }

  send(frame) {
    if (this.child.exitCode !== null || this.child.stdin.destroyed) return;
    this.child.stdin.write(`${JSON.stringify(frame)}\n`);
  }

  // Send a command and resolve with its response frame.
  call(command, timeoutMs = RPC_CALL_TIMEOUT_MS) {
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`omp did not answer "${command.type}" in time.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, ...command });
    });
  }

  async request(command, timeoutMs) {
    const response = await this.call(command, timeoutMs);
    if (!response.success) throw new Error(response.error || `omp could not ${command.type}.`);
    return response.data;
  }

  close() {
    if (this.child.exitCode !== null) return;
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 3000);
    this.exited.then(() => clearTimeout(timer));
  }

  kill() {
    if (this.child.exitCode === null) this.child.kill('SIGKILL');
  }
}

// A sign-in in progress: the rpc child, the prompt it is waiting on, and
// the SSE clients following along. Events are buffered so a client that
// connects after `open_url` was emitted still sees it.
class LoginSession {
  constructor(providerId) {
    this.id = randomUUID();
    this.providerId = providerId;
    this.events = [];
    this.clients = new Set();
    this.pendingInput = null;
    this.rpc = null;
    this.ended = false;
    this.timer = null;
  }

  subscribe(res) {
    for (const entry of this.events) LoginSession.write(res, entry);
    if (this.ended) {
      res.end();
      return;
    }
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }

  static write(res, { event, data }) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  push(event, data) {
    if (this.ended) return;
    const entry = { event, data };
    this.events.push(entry);
    for (const res of this.clients) LoginSession.write(res, entry);
    if (event === 'done' || event === 'error') this.end();
  }

  answer(value) {
    if (!this.pendingInput) throw new AgentAuthError(409, 'Nothing to paste into right now.');
    const id = this.pendingInput;
    this.pendingInput = null;
    this.rpc.send({ type: 'extension_ui_response', id, value });
  }

  end() {
    this.ended = true;
    clearTimeout(this.timer);
    this.rpc?.kill();
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}

class AgentAuth extends EventEmitter {
  constructor({ dataRoot, appRoot }) {
    super();
    this.dataRoot = dataRoot;
    this.configPath = path.join(appRoot, 'omp', 'config.yml');
    this.bootstrapPath = path.join(appRoot, 'omp', 'bootstrap-provider.js');
    this.settingsPath = path.join(dataRoot, 'agent.json');
    this.defaultModel = configDefaultModel(this.configPath);
    this.model = this.defaultModel;
    try {
      const saved = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
      if (isModelId(saved.model)) this.model = saved.model;
    } catch {
      // no saved selection: use the config default
    }
    this.last = null;
    this.inflight = null;
    this.login = null;
  }

  status() {
    return this.last;
  }

  // Extra argv every omp spawn must include so terminals, probes and
  // sign-ins agree on the model.
  ompArgs() {
    return this.model && this.model !== this.defaultModel ? ['--model', this.model] : [];
  }

  ompEnv() {
    return {};
  }

  spawnEnv() {
    return { ...process.env, ...this.ompEnv() };
  }

  // Arguments shared by every headless omp run: the Dialogue overlay and no
  // project-derived extras, so the probe only measures the model.
  headlessArgs() {
    return ['--config', this.configPath, '--no-session', '--no-skills', '--no-rules', '--no-tools', '--no-title', ...this.ompArgs()];
  }

  async check({ force = false } = {}) {
    if (!force && this.last?.ready && Date.now() - Date.parse(this.last.checkedAt) < READY_TTL_MS) return this.last;
    if (this.inflight) return this.inflight;
    this.inflight = this.probe()
      .then((result) => {
        const wasReady = Boolean(this.last?.ready);
        this.last = result;
        if (result.ready && !wasReady) this.emit('ready', result);
        return result;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  // Run omp in an empty directory so no project `.env` leaks into the
  // measurement; only HOME-level configuration counts.
  async withEmptyCwd(fn) {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'dialogue-agent-'));
    try {
      return await fn(cwd);
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true });
    }
  }

  runOmp(args, { cwd, timeoutMs }) {
    return new Promise((resolve) => {
      const child = spawn(OMP_BIN, args, { cwd, env: this.spawnEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}`, timedOut });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr, timedOut });
      });
    });
  }

  async probe() {
    const model = this.model;
    const checkedAt = () => new Date().toISOString();
    if (!model) return { ready: false, reason: 'unknown', detail: 'No model is configured.', model: null, checkedAt: checkedAt() };
    return this.withEmptyCwd(async (cwd) => {
      const provider = model.split('/')[0];
      const presence = await this.runOmp(['token', provider], { cwd, timeoutMs: PROBE_TIMEOUT_MS });
      if (presence.code !== 0) {
        return { ready: false, reason: 'not-connected', detail: `No sign-in for ${provider} yet.`, model, checkedAt: checkedAt() };
      }
      const probe = await this.runOmp(['-p', ...this.headlessArgs(), PROBE_PROMPT], { cwd, timeoutMs: PROBE_TIMEOUT_MS });
      if (probe.code === 0 && /\bOK\b/.test(probe.stdout)) {
        return { ready: true, reason: null, detail: `${model} answered.`, model, checkedAt: checkedAt() };
      }
      const output = `${probe.stdout}\n${probe.stderr}`;
      const [reason, summary] = classifyFailure(output, probe.timedOut);
      const tail = lastLines(output);
      return { ready: false, reason, detail: tail ? `${summary}\n${tail}` : summary, model, checkedAt: checkedAt() };
    });
  }

  async setModel(model) {
    if (!isModelId(model)) throw new AgentAuthError(400, 'Choose a model as provider/model-id.');
    if (model !== this.model) {
      this.model = model;
      await fsp.mkdir(this.dataRoot, { recursive: true });
      await fsp.writeFile(this.settingsPath, `${JSON.stringify({ model }, null, 2)}\n`);
      this.last = null;
      this.emit('model', model);
    }
    return this.check({ force: true });
  }

  // A short-lived rpc child for catalog questions. The bootstrap provider
  // lets omp start before any real sign-in exists.
  async withRpc(fn) {
    return this.withEmptyCwd(async (cwd) => {
      const rpc = new RpcChild([...this.headlessArgs(), '-e', this.bootstrapPath], { cwd, env: this.spawnEnv() });
      try {
        await rpc.ready;
        return await fn(rpc);
      } finally {
        rpc.close();
      }
    });
  }

  async providers() {
    const data = await this.withRpc((rpc) => rpc.request({ type: 'get_login_providers' }));
    return data.providers
      .filter((provider) => provider.available !== false)
      .map(({ id, name, authenticated }) => ({ id, name, authenticated: Boolean(authenticated) }));
  }

  static publicModels(models) {
    return models
      .filter((model) => model.provider !== 'dialogue-bootstrap')
      .map((model) => ({ id: `${model.provider}/${model.id}`, provider: model.provider, name: model.name || model.id }));
  }

  async models() {
    const data = await this.withRpc((rpc) => rpc.request({ type: 'get_available_models' }));
    return AgentAuth.publicModels(data.models || []);
  }

  static pickModel(models, providerId) {
    const candidates = models.filter((model) => model.provider === providerId);
    for (const pattern of MODEL_PREFERENCE) {
      const hit = candidates.find((model) => pattern.test(model.id));
      if (hit) return hit.id;
    }
    return candidates[0]?.id ?? null;
  }

  // Start a web sign-in for one provider. Only one runs at a time.
  async startLogin(providerId) {
    if (typeof providerId !== 'string' || !providerId.trim()) throw new AgentAuthError(400, 'Choose a provider to sign in to.');
    this.cancelLogin();
    const session = new LoginSession(providerId.trim());
    this.login = session;
    session.timer = setTimeout(() => session.push('error', { message: 'The sign-in took too long. Start it again.' }), LOGIN_TIMEOUT_MS);
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'dialogue-login-'));
    const rpc = new RpcChild([...this.headlessArgs(), '-e', this.bootstrapPath], { cwd, env: this.spawnEnv() });
    session.rpc = rpc;
    rpc.exited.then(() => fsp.rm(cwd, { recursive: true, force: true }).catch(() => {}));
    rpc.onFrame((frame) => {
      if (frame.type !== 'extension_ui_request') return;
      switch (frame.method) {
        case 'open_url':
          session.push('open_url', { url: frame.url, ...(frame.launchUrl ? { launchUrl: frame.launchUrl } : {}), ...(frame.instructions ? { instructions: frame.instructions } : {}) });
          break;
        case 'notify':
          if (frame.message) session.push('progress', { message: frame.message });
          break;
        case 'input':
          session.pendingInput = frame.id;
          session.push('input', { title: frame.title || 'Paste the code', ...(frame.placeholder ? { placeholder: frame.placeholder } : {}) });
          break;
        case 'select':
        case 'confirm':
        case 'editor':
          // Dialogs the web flow cannot render; let omp fall back.
          rpc.send({ type: 'extension_ui_response', id: frame.id, cancelled: true });
          break;
        default:
          break;
      }
    });
    this.driveLogin(session, rpc).catch((error) => session.push('error', { message: error.message }));
    return session;
  }

  async driveLogin(session, rpc) {
    await rpc.ready;
    if (session.ended) return;
    await rpc.request({ type: 'login', providerId: session.providerId }, LOGIN_TIMEOUT_MS);
    if (session.ended) return;
    session.push('progress', { message: 'Signed in. Checking the connection...' });
    // A provider that cannot serve the current model gets a model of its own.
    const provider = this.model?.split('/')[0];
    if (provider !== session.providerId) {
      const [available, presence] = await Promise.all([
        rpc.request({ type: 'get_available_models' }).then((data) => AgentAuth.publicModels(data.models || [])).catch(() => []),
        this.withEmptyCwd((cwd) => this.runOmp(['token', provider], { cwd, timeoutMs: RPC_CALL_TIMEOUT_MS }))
      ]);
      const picked = presence.code === 0 ? null : AgentAuth.pickModel(available, session.providerId);
      rpc.close();
      if (picked) {
        session.push('progress', { message: `Using ${picked}. You can change this in Settings.` });
        session.push('done', { status: await this.setModel(picked) });
        return;
      }
    } else {
      rpc.close();
    }
    session.push('done', { status: await this.check({ force: true }) });
  }

  loginSession(id) {
    if (!this.login || this.login.id !== id) throw new AgentAuthError(404, 'That sign-in is no longer running.');
    return this.login;
  }

  cancelLogin() {
    if (!this.login) return;
    const session = this.login;
    this.login = null;
    session.push('error', { message: 'Sign-in cancelled.' });
  }

  shutdown() {
    this.cancelLogin();
  }
}

module.exports = { AgentAuth, AgentAuthError, classifyFailure, configDefaultModel };
