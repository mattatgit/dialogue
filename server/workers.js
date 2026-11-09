// Application-owned worker policy. Host provisioning belongs to Setup & install.
// Production has no unsandboxed fallback: a failed namespace/cgroup check is fatal.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID, createHash } = require('node:crypto');
const exec = promisify(execFile);
const { outcome, message: workerMessage, noListenFilter, sampleCgroup } = require('./worker-observation.js');
const MiB = 1024 * 1024;
const PROFILES = Object.freeze({
  agent: { pool: 'heavy', memory: 1280, tasks: 96, cpu: 100, seconds: 660 },
  provider: { pool: 'heavy', memory: 1280, tasks: 96, cpu: 100, seconds: 660 },
  install: { pool: 'heavy', memory: 768, tasks: 96, cpu: 100, seconds: 600 },
  preview: { pool: 'preview', memory: 256, tasks: 64, cpu: 50, seconds: 3600 },
  terminal: { pool: 'terminal', memory: 1280, tasks: 96, cpu: 75, seconds: 3600 },
  control: { pool: 'control', memory: 128, tasks: 48, cpu: 50, seconds: 660 },
  browser: { pool: 'browser', memory: 256, tasks: 96, cpu: 75, seconds: 40 }
});
class WorkerError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}
const within = (file, root) => file === root || file.startsWith(root + path.sep);
function integer(value, fallback, min, max, name) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new WorkerError(`Invalid ${name}.`, 500);
  return n;
}
function workerConfig(env = process.env, platform = process.platform) {
  const production = env.DIALOGUE_MODE === 'production' || env.NODE_ENV === 'production';
  const mode = env.DIALOGUE_WORKER_MODE || (production ? 'isolated' : 'direct');
  if (!['direct', 'isolated'].includes(mode) || (production && mode !== 'isolated')) throw new WorkerError('Production requires isolated workers.', 500);
  if (mode === 'isolated' && platform !== 'linux') throw new WorkerError('Isolated workers require Linux namespaces and systemd.', 500);
  const config = { isolated: mode === 'isolated',
    budget: integer(env.DIALOGUE_WORKER_BUDGET_MB, 2048, 1280, 16384, 'worker memory budget'),
    sliceMiB: integer(env.DIALOGUE_WORKER_SLICE_MB, 2304, 1536, 16640, 'worker slice ceiling'),
    profiles: Object.fromEntries(Object.entries(PROFILES).map(([kind, profile]) => [kind, { ...profile, memory: integer(env[`DIALOGUE_WORKER_${kind.toUpperCase()}_MB`], profile.memory, 128, 8192, `${kind} memory limit`) }])),
    queue: integer(env.DIALOGUE_WORKER_QUEUE, 8, 1, 32, 'worker queue size'),
    waitMs: integer(env.DIALOGUE_WORKER_WAIT_MS, 60000, 100, 120000, 'worker wait timeout'),
    diskFloor: integer(env.DIALOGUE_WORKER_DISK_FLOOR_MB, 1024, 256, 8192, 'disk reserve') * MiB,
    bwrap: env.DIALOGUE_BWRAP || '/usr/bin/bwrap',
    systemdRun: env.DIALOGUE_SYSTEMD_RUN || '/usr/bin/systemd-run',
    systemctl: env.DIALOGUE_SYSTEMCTL || '/usr/bin/systemctl',
    prlimit: env.DIALOGUE_PRLIMIT || '/usr/bin/prlimit',
    parentUnit: env.DIALOGUE_WORKER_PARENT_UNIT || 'dialogue.service',
    toolRoots: (env.DIALOGUE_WORKER_TOOL_ROOTS || '').split(path.delimiter).filter(Boolean),
    counts: { heavy: 1, preview: integer(env.DIALOGUE_WORKER_PREVIEWS, 2, 1, 2, 'preview concurrency'), terminal: 1, control: 2, browser: 1 }
  };
  if (config.budget > config.sliceMiB || Object.values(config.profiles).some(p => p.memory > config.budget)) throw new WorkerError('Worker limits must fit the aggregate budget and installed slice.', 500);
  if (!/^dialogue(?:-[a-z0-9-]+)?\.service$/.test(config.parentUnit)) throw new WorkerError('Invalid worker parent service.', 500);
  if (![config.bwrap, config.systemdRun, config.systemctl, config.prlimit].every(file => path.isAbsolute(file))) throw new WorkerError('Worker supervisor binaries must use absolute paths.', 500);
  return config;
}

// FIFO, bounded waiting, cancellation, and a total reservation budget shared by
// installs, agents, terminals, previews, provider RPC and screenshot processes.
class WorkerBudget {
  constructor(config) { this.config = config; this.active = new Map(); this.pending = []; this.closed = false; }
  fits(kind) {
    const profiles = this.config.profiles || PROFILES;
    const profile = profiles[kind];
    const active = [...this.active.values()];
    return active.filter(k => profiles[k].pool === profile.pool).length < this.config.counts[profile.pool] &&
      active.reduce((n, k) => n + profiles[k].memory, 0) + profile.memory <= this.config.budget;
  }
  acquire(kind, { signal, wait = true } = {}) {
    if (!PROFILES[kind]) return Promise.reject(new WorkerError('Unknown worker type.', 500));
    if (this.closed || signal?.aborted) return Promise.reject(new WorkerError('The worker request was cancelled.'));
    if (!this.pending.some(e => PROFILES[e.kind].pool === PROFILES[kind].pool) && this.fits(kind)) return Promise.resolve(this.reserve(kind));
    if (!wait || this.pending.length >= this.config.queue) return Promise.reject(new WorkerError('The server is busy. Close an unused preview, or try again shortly.'));
    return new Promise((resolve, reject) => {
      const entry = { kind, resolve, reject, signal };
      entry.cancel = () => { this.remove(entry); reject(new WorkerError('The worker request was cancelled.')); this.drain(); };
      entry.timer = setTimeout(() => { this.remove(entry); reject(new WorkerError('The server is still busy. Please try again shortly.')); this.drain(); }, this.config.waitMs);
      signal?.addEventListener('abort', entry.cancel, { once: true });
      this.pending.push(entry);
    });
  }
  remove(entry) {
    const index = this.pending.indexOf(entry); if (index >= 0) this.pending.splice(index, 1);
    clearTimeout(entry.timer); entry.signal?.removeEventListener('abort', entry.cancel);
  }
  reserve(kind) {
    const id = randomUUID(); this.active.set(id, kind); let released = false;
    return () => { if (!released) { released = true; this.active.delete(id); this.drain(); } };
  }
  drain() {
    while (!this.closed && this.pending.length) {
      const seen = new Set();
      const entry = this.pending.find(e => { const pool = PROFILES[e.kind].pool; if (seen.has(pool)) return false; seen.add(pool); return this.fits(e.kind); });
      if (!entry) break; this.remove(entry); entry.resolve(this.reserve(entry.kind));
    }
  }
  close() {
    this.closed = true;
    for (const entry of [...this.pending]) { this.remove(entry); entry.reject(new WorkerError('The server is stopping.')); }
  }
}

function killWorker(child, signal = 'SIGTERM') {
  if (!child) return;
  if (child.workerStop) return child.workerStop(signal);
  killProcessGroup(child, signal);
}
function killProcessGroup(child, signal) {
  if (child.exitCode !== null) return;
  try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
}
async function spawnWorker(runtime, bin, args, options, policy = {}) {
  if (runtime) return runtime.spawn(bin, args, options, policy);
  if (process.env.DIALOGUE_MODE === 'production' || process.env.NODE_ENV === 'production') throw new WorkerError('An isolated worker runtime is required.');
  return spawn(bin, args, options);
}

// Serialized into the worker so the check executes inside its namespaces.
// Compare kernel namespace identities: PID 1's argv can contain this probe's
// own source (including 'systemd') when Bubblewrap is the namespace init.
function isolationProbe(canary, parentPidNamespace) {
  const fs = require('node:fs');
  if (fs.existsSync(canary) || fs.existsSync('/etc/dialogue/mail.env') || fs.existsSync('/run/systemd') || fs.existsSync('/sys/fs/cgroup')) process.exit(11);
  if (!/NoNewPrivs:\s+1/.test(fs.readFileSync('/proc/self/status', 'utf8'))) process.exit(12);
  const ownPidNamespace = fs.readlinkSync('/proc/self/ns/pid');
  if (ownPidNamespace === parentPidNamespace || fs.readlinkSync('/proc/1/ns/pid') !== ownPidNamespace) process.exit(13);
  process.stdin.resume();
  process.stdin.on('end', () => process.exit(0));
  console.log('isolated');
}

class Workers {
  constructor({ dataRoot, appRoot, config = workerConfig(), execute = exec, spawnProcess = spawn }) {
    this.dataRoot = path.resolve(dataRoot); this.appRoot = path.resolve(appRoot); this.config = config;
    this.execute = execute; this.spawnProcess = spawnProcess; this.budget = new WorkerBudget(config);
    this.previewOwners = new Map(); this.children = new Set(); this.ready = !config.isolated; this.stopping = false;
  }
  get isolated() { return this.config.isolated; }
  async directory(prefix) {
    const root = path.join(this.dataRoot, 'workers'); await fsp.mkdir(root, { recursive: true, mode: 0o700 });
    return fsp.mkdtemp(path.join(root, prefix + '-'));
  }
  canonical(file) {
    const resolved = fs.realpathSync(file);
    if (resolved !== path.resolve(file)) throw new WorkerError('Worker paths must be canonical and cannot be symbolic links.', 500);
    return resolved;
  }
  async diskReady() {
    const stats = await fsp.statfs(this.dataRoot);
    if (stats.bavail * stats.bsize < this.config.diskFloor) throw new WorkerError('The server is low on disk space. Stop work and contact the workspace owner.');
  }
  systemRoots() {
    for (const root of this.config.toolRoots) {
      if (!/^\/opt\/[^/]+(?:\/|$)/.test(root) || within(this.appRoot, root) || within(root, this.appRoot)) throw new WorkerError('Extra worker tool roots must be separate /opt tool installations.', 500);
    }
    const roots = ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/nix/store', ...this.config.toolRoots].filter(file => fs.existsSync(file));
    for (const root of roots) {
      if (!path.isAbsolute(root) || root === '/' || within(this.dataRoot, fs.realpathSync(root)) || within(root, this.dataRoot)) throw new WorkerError('A worker tool root overlaps private application data.', 500);
    }
    return roots;
  }
  plan(bin, args, options, policy, unit) {
    const kind = policy.kind || 'agent'; const profile = this.config.profiles[kind];
    if (!profile) throw new WorkerError('Unknown worker type.', 500);
    const cwd = this.canonical(options.cwd);
    const work = kind === 'agent' || kind === 'install' || kind === 'preview' || kind === 'terminal';
    const workspaceRoot = work ? this.canonical(policy.workspaceRoot || cwd) : cwd;
    if (work && (!within(cwd, workspaceRoot) || ![path.join(this.dataRoot, 'workspaces'), path.join(this.dataRoot, 'setup')].some(root => within(workspaceRoot, root)))) throw new WorkerError('A worker must target a Dialogue working copy.', 500);
    if (!work && !within(cwd, this.dataRoot) && !within(cwd, fs.realpathSync(os.tmpdir()))) throw new WorkerError('Invalid worker temporary directory.', 500);
    const roots = this.systemRoots();
    const argv = [...(kind === 'agent' ? ['--seccomp', '3'] : []), '--die-with-parent', '--new-session', '--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--unshare-cgroup', '--disable-userns', '--cap-drop', 'ALL', '--clearenv'];
    for (const root of roots) {
      const stat = fs.lstatSync(root);
      if (stat.isSymbolicLink()) argv.push('--symlink', fs.readlinkSync(root), root);
      else argv.push('--ro-bind', root, root);
    }
    argv.push('--proc', '/proc', '--dev', '/dev', '--size', String(64 * MiB), '--tmpfs', '/dev/shm', '--size', String(256 * MiB), '--tmpfs', '/tmp');
    // NSS account names are public metadata, required by tmux/getpwuid.
    // Shadow databases and every credential/configuration directory stay hidden.
    for (const file of ['/etc/passwd', '/etc/group', '/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf', '/etc/ld.so.cache', '/etc/localtime', '/etc/ssl/certs', '/etc/alternatives']) {
      if (fs.existsSync(file)) argv.push('--ro-bind', fs.realpathSync(file), file);
    }
    argv.push('--ro-bind', path.join(this.appRoot, 'omp'), path.join(this.appRoot, 'omp'));
    // Provider credentials are only present for that member's agent/control
    // worker. Project installs, servers and Chromium never mount a member home.
    let home = '/home/worker';
    if (policy.home && ['agent', 'provider', 'terminal', 'control'].includes(kind)) {
      home = this.canonical(policy.home);
      if (!within(home, path.join(this.dataRoot, 'users')) || path.basename(home) !== 'home') throw new WorkerError('Invalid member credential directory.', 500);
      argv.push('--bind', home, home);
    } else if (policy.cacheDir) {
      const cache = this.canonical(policy.cacheDir);
      if (!['install', 'preview'].includes(kind) || !within(cache, path.join(this.dataRoot, 'workers', 'cache'))) throw new WorkerError('Invalid preview cache directory.', 500);
      argv.push('--bind', cache, home);
    } else argv.push('--dir', home);
    argv.push(policy.readOnlyWorkspace ? '--ro-bind' : '--bind', workspaceRoot, workspaceRoot);
    if (policy.runnerFile) {
      const file = this.canonical(policy.runnerFile);
      if (kind !== 'agent' || !within(file, path.join(this.dataRoot, 'requests', '.runner'))) throw new WorkerError('Invalid managed runner mailbox.',500);
      argv.push('--bind', file, file);
    }
    if (policy.sessionDir) {
      const session = this.canonical(policy.sessionDir);
      if (kind !== 'agent' || !within(session, path.join(this.dataRoot, 'requests', '.sessions'))) throw new WorkerError('Invalid conversation session directory.', 500);
      argv.push('--bind', session, session);
    }
    if (policy.attachmentDir) {
      const attachments = this.canonical(policy.attachmentDir);
      if (kind !== 'agent' || !within(attachments, path.join(this.dataRoot, 'requests', '.attachments'))) throw new WorkerError('Invalid conversation attachment directory.', 500);
      argv.push('--ro-bind', attachments, attachments);
    }
    const dotgit = path.join(workspaceRoot, '.git');
    if (fs.existsSync(dotgit)) {
      if (!fs.lstatSync(dotgit).isFile()) throw new WorkerError('Expected a linked Dialogue working copy.', 500);
      const value = fs.readFileSync(dotgit, 'utf8').trim();
      if (!value.startsWith('gitdir: ')) throw new WorkerError('Invalid working-copy Git metadata.', 500);
      const gitdir = this.canonical(path.resolve(workspaceRoot, value.slice(8)));
      const common = this.canonical(path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim()));
      if (!within(common, path.join(this.dataRoot, 'repos')) || !within(gitdir, path.join(common, 'worktrees'))) throw new WorkerError('Git metadata is outside this project.', 500);
      // Git writes (including hooks/config/refs) stay in the trusted app. Even
      // the linked worktree's commondir must not be writable by project code.
      argv.push('--ro-bind', common, common, '--ro-bind', dotgit, dotgit);
    }
    for (const file of policy.readOnlyFiles || []) {
      const real = this.canonical(file);
      if (![path.join(this.dataRoot, 'requests', '.figma-snapshots'), path.join(this.dataRoot, 'requests', '.attachments')].some(root => within(real, root))) throw new WorkerError('Invalid worker design snapshot or attachment.', 500);
      argv.push('--ro-bind', real, real);
    }
    if (policy.activityFile) {
      const real = this.canonical(policy.activityFile);
      if (![path.join(this.dataRoot, 'activity'), path.join(this.dataRoot, 'requests', '.activity')].some(root => within(real, root))) throw new WorkerError('Invalid worker activity file.', 500);
      argv.push('--bind', real, real);
    }
    if (policy.replyFile) {
      const real = this.canonical(policy.replyFile);
      if (kind !== 'agent' || !within(real, path.join(this.dataRoot, 'requests', '.replies'))) throw new WorkerError('Invalid worker reply file.', 500);
      argv.push('--bind', real, real);
    }
    for (const dir of policy.ipcDirs || []) {
      const real = this.canonical(dir);
      if (kind !== 'terminal' || !within(real, path.join(this.dataRoot, 'workers'))) throw new WorkerError('Invalid terminal IPC directory.', 500);
      argv.push('--bind', real, real);
    }
    const env = options.env || {};
    const allowed = /^(?:LANG|LC_ALL|TERM|COLORTERM|TZ|CI|FORCE_COLOR|PORT|HOST|BROWSER|DIALOGUE_(?:OMP_ARGS|APP|WORKSPACE|ACTIVITY_FILE|REPLY_FILE|RUNNER_FILE|WORKSPACE_DIR|SESSION|TMUX|TMUX_SOCKET|OMP))$/;
    for (const [key, value] of Object.entries(env)) if (allowed.test(key)) argv.push('--setenv', key, String(value));
    const safePath = (process.env.PATH || '/usr/local/bin:/usr/bin:/bin').split(path.delimiter).filter(dir => roots.some(root => within(path.resolve(dir), root))).join(path.delimiter);
    const baseEnv = { PATH: safePath, HOME: home, TMPDIR: '/tmp', XDG_CACHE_HOME: `${home}/.cache`, XDG_CONFIG_HOME: `${home}/.config`,
      PI_CODING_AGENT_DIR: `${home}/.omp/agent`, OMP_PROFILE: 'default', PI_PROFILE: 'default',
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
      DIALOGUE_ACTIVITY_DIRECT: '1', NODE_OPTIONS: `--max-old-space-size=${Math.max(64,Math.floor(profile.memory * .6))}`, PWD: cwd };
    // Native OMP embeds Bun/JSC, not V8. Fixed low-memory GC hints complement
    // (never replace) the kernel ceiling, and cannot be supplied by a project.
    baseEnv.BUN_OPTIONS = '--smol';
    baseEnv.BUN_JSC_forceRAMSize = String(Math.max(64, Math.floor(profile.memory / 2)) * MiB);
    for (const [key, value] of Object.entries(baseEnv)) argv.push('--setenv', key, value);
    // Hard rlimits cannot be raised by descendants after capabilities are dropped.
    argv.push('--chdir', cwd, '--', this.config.prlimit, '--fsize=268435456:268435456', '--nofile=1024:1024', '--core=0:0', '--', bin, ...args);
    return { bin: this.config.systemdRun, args: ['--user', '--scope', '--quiet', '--no-ask-password', '--expand-environment=no',
      `--unit=${unit}`, '--slice=dialogue-workers.slice',
      `--property=BindsTo=${this.config.parentUnit}`, `--property=After=${this.config.parentUnit}`,
      `--property=MemoryMax=${profile.memory}M`, '--property=MemorySwapMax=0', `--property=TasksMax=${profile.tasks}`,
      `--property=CPUQuota=${profile.cpu}%`, `--property=RuntimeMaxSec=${profile.seconds}s`, '--property=TimeoutStopSec=3s', '--property=OOMPolicy=kill',
      '--', this.config.bwrap, ...argv] };
  }
  async prepare(policy, options) {
    if (['install', 'preview'].includes(policy.kind)) {
      policy.cacheDir = path.join(this.dataRoot, 'workers', 'cache', createHash('sha256').update(options.cwd).digest('hex'));
      await fsp.mkdir(policy.cacheDir, { recursive: true, mode: 0o700 });
    }
    if (policy.activityFile) {
      const file = path.resolve(policy.activityFile);
      if (![path.join(this.dataRoot, 'activity'), path.join(this.dataRoot, 'requests', '.activity')].some(root => within(file, root))) throw new WorkerError('Invalid worker activity file.', 500);
      await fsp.mkdir(path.dirname(policy.activityFile), { recursive: true, mode: 0o700 });
      this.canonical(path.dirname(policy.activityFile));
      const handle = await fsp.open(policy.activityFile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600); await handle.close();
    }
  }
  async spawn(bin, args, options, policy = {}) {
    if (this.stopping || (this.isolated && !this.ready)) throw new WorkerError('The isolated worker runtime is not ready.');
    const kind = policy.kind || 'agent';
    const closingPreview = this.isolated && kind === 'preview' && [...this.children].some(c => c.workerKind === 'preview' && c.workerClosing);
    const release = await this.budget.acquire(kind, { signal: policy.signal, wait: closingPreview || !['preview', 'terminal'].includes(kind) });
    let child, filterFd, filterPath;
    try {
      if (this.stopping || policy.signal?.aborted) throw new WorkerError('The worker request was cancelled.');
      policy = { ...policy };
      if (this.isolated) { await this.diskReady(); await this.prepare(policy, options); }
      if (this.stopping || policy.signal?.aborted) throw new WorkerError('The worker request was cancelled.');
      const unit = `dialogue-worker-${randomUUID()}.scope`;
      const recordDir = path.join(this.dataRoot, 'workers', 'records'); await fsp.mkdir(recordDir, { recursive:true, mode:0o700 });
      const planned = this.isolated ? this.plan(bin, args, options, policy, unit) : { bin, args };
      if (this.isolated && kind === 'agent') {
        const folder = await this.directory('filter'); filterPath = path.join(folder, 'no-listen.bpf');
        await fsp.writeFile(filterPath, noListenFilter(), { mode: 0o400 }); filterFd = fs.openSync(filterPath, 'r');
      }
      child = this.spawnProcess(planned.bin, planned.args, { ...options, ...(filterFd !== undefined ? { stdio: [...(Array.isArray(options.stdio) ? options.stdio.slice(0,3) : Array(3).fill(options.stdio || 'pipe')), filterFd] } : {}), detached: true, ...(this.isolated ? { env: this.supervisorEnv() } : {}) });
      if (filterFd !== undefined) { fs.closeSync(filterFd); filterFd = undefined; fsp.rm(path.dirname(filterPath), { recursive: true, force: true }).catch(() => {}); }
      this.children.add(child);
      child.workerKind = kind;
      const record = { id: unit, kind, pid: child.pid, startedAt: new Date().toISOString(), memoryMiB: this.config.profiles[kind].memory, budgetMiB: this.config.budget, sliceMiB: this.config.sliceMiB, workspace: policy.workspaceRoot || options.cwd, attribution: Object.fromEntries(Object.entries(policy.attribution || {}).filter(([k,v]) => ['project','request','workspace','phase'].includes(k) && typeof v === 'string').map(([k,v]) => [k,v.slice(0,256)])), concurrent: [...this.children].map(c => c.workerKind), measured: false };
      child.workerRecord = record;
      const recordFile = path.join(recordDir, unit + '.json');
      const save = () => fsp.writeFile(recordFile, JSON.stringify(record) + '\n', { mode: 0o600 });
      const initialSave = save(); initialSave.catch(() => {});
      let groupRoot, sampling;
      const sample = () => sampling ||= (async () => {
        if (!this.isolated) return;
        try {
          if (!groupRoot) {
            const { stdout } = await this.execute(this.config.systemctl, ['--user','show',unit,'-p','ControlGroup'], { env: this.supervisorEnv(), timeout: 1000 });
            const group = stdout.trim().replace(/^ControlGroup=/,'');
            if (!group.startsWith('/') || !group.includes('/dialogue-workers.slice/') || group.includes('..')) return;
            groupRoot = '/sys/fs/cgroup' + group; record.cgroup = group;
          }
          const measurement = await sampleCgroup(groupRoot);
          record.peakBytes = Math.max(record.peakBytes || 0, measurement.peakBytes);
          Object.assign(record, { ...measurement, peakBytes: record.peakBytes, measured: true, sampledAt: new Date().toISOString() });
          const slice = await sampleCgroup(path.dirname(groupRoot));
          record.slicePeakBytes = Math.max(record.slicePeakBytes || 0, slice.peakBytes);
          record.sliceCurrentBytes = slice.currentBytes;
          const meminfo = await fsp.readFile('/proc/meminfo','utf8');
          record.maxSliceCurrentBytes = Math.max(record.maxSliceCurrentBytes || 0, slice.currentBytes);
          record.hostAvailableBytes = Number(/^MemAvailable:\s+(\d+)/m.exec(meminfo)?.[1] || 0) * 1024;
          record.minHostAvailableBytes = Math.min(record.minHostAvailableBytes ?? Infinity,record.hostAvailableBytes);
          const pids = (await fsp.readFile(path.join(groupRoot,'cgroup.procs'),'utf8')).trim().split(/\s+/).filter(Boolean).slice(0,384);
          record.processes = await Promise.all(pids.map(async pid => ({pid:Number(pid),name:await fsp.readFile(`/proc/${pid}/comm`,'utf8').then(s=>s.trim(),()=>'?')})));
          await save();
        } catch {}
      })().finally(() => { sampling = null; });
      const observer = setInterval(() => sample(), 100); observer.unref(); sample();
      let finishCleanup, failCleanup;
      child.workerFinished = new Promise((resolve, reject) => { finishCleanup = resolve; failCleanup = reject; });
      child.workerFinished.catch(() => {});
      let cleaned = false;
      const cleanup = async () => {
        if (cleaned) return; cleaned = true;
        child.workerClosing = true; clearInterval(observer);
        await sample();
        try {
          const { stdout } = this.isolated ? await this.execute(this.config.systemctl, ['--user','show',unit,'-p','Result'], { env:this.supervisorEnv(), timeout:1000 }) : {stdout:''};
          record.result = stdout.trim().replace(/^Result=/,'');
        } catch {}
        Object.assign(record, { code:child.exitCode, signal:child.signalCode, finishedAt:new Date().toISOString(), outcome:outcome({code:child.exitCode,signal:child.signalCode,reason:child.workerReason,oomKill:record.oomKill,result:record.result}) });
        await initialSave.catch(() => {});
        await save().catch(error => console.error('Worker evidence could not be saved:', error.message));
        if (this.isolated) {
          try { await this.execute(this.config.systemctl, ['--user', 'stop', unit], { env: this.supervisorEnv(), timeout: 5000 }); }
          catch (error) {
            if (!/not loaded|not found|could not be found/i.test(String(error.stderr || ''))) {
              this.ready = false; this.budget.close();
              console.error('Worker cleanup could not be verified; new worker admission is stopped.');
              failCleanup(new WorkerError('Worker cleanup could not be verified. Contact the workspace owner.')); return;
            }
          }
        }
        if (this.isolated) await this.execute(this.config.systemctl, ['--user','reset-failed',unit], {env:this.supervisorEnv(),timeout:1000}).catch(() => {});
        release(); this.children.delete(child); finishCleanup();
      };
      child.once('close', cleanup); child.once('error', cleanup);
      if (this.isolated) {
        const stop = signal => {
          child.workerClosing = true;
          // Cancellation can arrive before systemd-run registers its scope.
          // Stop the launcher too, so a missing unit cannot turn into a late job.
          killProcessGroup(child, signal);
          return this.execute(this.config.systemctl, signal === 'SIGTERM' ? ['--user', 'stop', unit] : ['--user', 'kill', '--kill-whom=all', `--signal=${signal}`, unit], { env: this.supervisorEnv(), timeout: 5000 }).catch(() => {});
        };
        child.workerStop = stop;
        child.workerUnit = unit;
      }
      const abort = () => { child.workerReason ||= 'cancelled'; killWorker(child, 'SIGKILL'); }; policy.signal?.addEventListener('abort', abort, { once: true });
      child.once('close', () => policy.signal?.removeEventListener('abort', abort));
      return child;
    } catch (error) { if (filterFd !== undefined) fs.closeSync(filterFd); if (filterPath) await fsp.rm(path.dirname(filterPath), { recursive: true, force:true }); release(); throw error; }
  }
  supervisorEnv() {
    const env = {};
    for (const key of ['PATH', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG']) if (process.env[key]) env[key] = process.env[key];
    return env;
  }
  async assertReady() {
    if (!this.isolated) return;
    if (!process.getuid || process.getuid() === 0) throw new WorkerError('Run Dialogue as an unprivileged service account.', 500);
    this.dataRoot = await fsp.realpath(this.dataRoot); this.appRoot = await fsp.realpath(this.appRoot);
    if (fs.existsSync(path.join(this.appRoot, '.env'))) throw new WorkerError('Production releases must not contain an .env file; use the private service environment.', 500);
    const controllers = await fsp.readFile('/sys/fs/cgroup/cgroup.controllers', 'utf8');
    if (!['memory', 'pids', 'cpu'].every(name => controllers.split(/\s+/).includes(name))) throw new WorkerError('Workers require cgroup v2 CPU, memory and process controllers.', 500);
    for (const bin of [this.config.bwrap, this.config.systemdRun, this.config.systemctl, this.config.prlimit]) await fsp.access(bin, fs.constants.X_OK);
    const { stdout: parentOutput } = await this.execute(this.config.systemctl, ['--user', 'show', this.config.parentUnit, '-p', 'MainPID', '-p', 'MemoryMax'], { env: this.supervisorEnv(), timeout: 5000 });
    const parentValues = Object.fromEntries(parentOutput.trim().split('\n').map(line => line.split('=')));
    if (!(Number(parentValues.MemoryMax) > 0 && Number(parentValues.MemoryMax) <= 512 * MiB)) throw new WorkerError('The app service requires an installed memory ceiling of at most 512 MiB.',500);
    if (Number(parentValues.MainPID) !== process.pid) throw new WorkerError('Start the Node application directly in its configured user service.', 500);
    const { stdout } = await this.execute(this.config.systemctl, ['--user', 'show', 'dialogue-workers.slice', '-p', 'LoadState', '-p', 'MemoryHigh', '-p', 'MemoryMax', '-p', 'MemorySwapMax', '-p', 'TasksMax', '-p', 'CPUQuotaPerSecUSec'], { env: this.supervisorEnv(), timeout: 5000 });
    const values = Object.fromEntries(stdout.trim().split('\n').map(line => line.split('=')));
    if (values.LoadState !== 'loaded' || !(Number(values.MemoryHigh) >= this.config.budget * MiB || values.MemoryHigh === 'infinity') || !(Number(values.MemoryMax) >= this.config.budget * MiB && Number(values.MemoryMax) === this.config.sliceMiB * MiB) ||
      !(Number(values.MemorySwapMax) <= 256 * MiB) || !(Number(values.TasksMax) > 0 && Number(values.TasksMax) <= 384) ||
      !/^1\.500000s$|^1s 500ms$|^1500000$|^1500ms$/.test(values.CPUQuotaPerSecUSec || '')) throw new WorkerError('Configure the bounded dialogue-workers.slice before starting Dialogue (see docs/WORKERS.md).', 500);
    if (this.config.sliceMiB * MiB + 1536 * MiB > os.totalmem()) throw new WorkerError('The worker slice leaves insufficient headroom for the app and OS (1536 MiB required).', 500);
    // Real namespace self-test; not an environment flag asserting "sandboxed".
    const cwd = await this.directory('probe');
    const canary = path.join(this.dataRoot, `.worker-canary-${randomUUID()}`); await fsp.writeFile(canary, 'private', { mode: 0o600 });
    this.ready = true;
    let child;
    try {
      const parentPidNamespace = await fsp.readlink('/proc/self/ns/pid');
      const code = `(${isolationProbe.toString()})(${JSON.stringify(canary)},${JSON.stringify(parentPidNamespace)});`;
      child = await this.spawn(process.execPath, ['-e', code], { cwd, env: {}, stdio: ['pipe', 'pipe', 'pipe'] }, { kind: 'control' });
      await new Promise((resolve, reject) => {
        let stderr = '';
        child.stderr.on('data', data => { stderr = (stderr + data).slice(-2048); });
        const timer = setTimeout(() => reject(new Error('Namespace probe did not start.')), 10000);
        child.stdout.once('data', data => { clearTimeout(timer); if (String(data).trim() === 'isolated') resolve(); else reject(new Error('Unexpected namespace probe result.')); });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', (code, signal) => { clearTimeout(timer); reject(new Error(`Namespace probe exited early (${signal || code})${stderr.trim() ? ': ' + stderr.trim() : '.'}`)); });
      });
      const { stdout: groupOutput } = await this.execute(this.config.systemctl, ['--user', 'show', child.workerUnit, '-p', 'ControlGroup'], { env: this.supervisorEnv(), timeout: 5000 });
      const group = groupOutput.trim().replace(/^ControlGroup=/, '');
      if (!group.startsWith('/') || !group.includes('/dialogue-workers.slice/') || group.includes('..')) throw new Error('Worker is outside its resource slice.');
      const groupRoot = '/sys/fs/cgroup' + group;
      for (let ancestor = path.dirname(groupRoot); ancestor.startsWith('/sys/fs/cgroup'); ancestor = path.dirname(ancestor)) {
        const ceiling = (await fsp.readFile(path.join(ancestor,'memory.max'),'utf8').catch(error=>{if(ancestor==='/sys/fs/cgroup' && error.code==='ENOENT')return 'max';throw error;})).trim();
        if (ceiling !== 'max' && Number(ceiling) < this.config.sliceMiB * MiB) throw new Error('An installed ancestor memory limit is below the declared worker slice.');
        if (ancestor === '/sys/fs/cgroup') break;
      }
      const [memory, tasks, swap, cpu] = await Promise.all(['memory.max', 'pids.max', 'memory.swap.max', 'cpu.max'].map(file => fsp.readFile(path.join(groupRoot, file), 'utf8')));
      const [quota, period] = cpu.trim().split(' ').map(Number);
      if (Number(memory) !== this.config.profiles.control.memory * MiB || Number(tasks) !== PROFILES.control.tasks || Number(swap) !== 0 || !(quota > 0 && quota / period <= .5)) throw new Error('Kernel worker limits are not enforced.');
      child.stdin.end();
      this.monitor = setInterval(() => this.diskReady().catch(() => {
        this.budget.close(); for (const child of this.children) killWorker(child, 'SIGKILL');
        console.error('Dialogue workers stopped: disk reserve exhausted. Restart after recovering disk space.');
      }), 2000); this.monitor.unref();
    } catch (error) { this.ready = false; throw new WorkerError(`Worker isolation self-test failed: ${error.message}`, 500); }
    finally {
      if (child) await killWorker(child, 'SIGTERM');
      await fsp.rm(canary, { force: true }); await fsp.rm(cwd, { recursive: true, force: true });
    }
  }
  async run(bin, args, options, policy) {
    const { timeout: requestedTimeout, ...spawnOptions } = options;
    const child = await this.spawn(bin, args, { ...spawnOptions, stdio: ['ignore', 'pipe', 'pipe'] }, policy);
    return new Promise((resolve, reject) => {
      let stdout = '', stderr = '';
      child.stdout.on('data', data => { stdout = (stdout + data).slice(-65536); });
      child.stderr.on('data', data => { stderr = (stderr + data).slice(-65536); });
      let timedOut = false;
      const timeout = requestedTimeout || 30000;
      const timer = setTimeout(() => { timedOut = true; child.workerReason = 'timeout'; killWorker(child, 'SIGKILL'); }, timeout);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', async (code, signal) => {
        clearTimeout(timer);
        try {
          await child.workerFinished;
          if (code !== 0 || timedOut) {
            const kind = policy?.kind || 'agent';
            const detail = timedOut ? `timed out after ${timeout} ms` : signal ? `terminated on ${signal}` : `exited with code ${code}`;
            const error = new WorkerError(child.workerRecord?.outcome === 'memory-limit' ? workerMessage(child.workerRecord) : `Worker ${detail} (${kind}, ${PROFILES[kind].memory} MiB limit)${stderr.trim() ? ': ' + stderr.trim().slice(-1000) : '.'}`);
            Object.assign(error, { code, signal, timedOut, kind, memoryMiB: PROFILES[kind].memory });
            reject(error);
          }
          else resolve({ stdout, stderr });
        } catch (error) { reject(error); }
      });
    });
  }
  async shutdown() {
    this.stopping = true; clearInterval(this.monitor); this.budget.close();
    await Promise.all([...this.children].map(async child => {
      const ended = new Promise(resolve => { child.once('close', resolve); child.once('error', resolve); });
      await killWorker(child, 'SIGKILL'); await Promise.race([ended, new Promise(resolve => setTimeout(resolve, 5000))]); await child.workerFinished;
    }));
  }
}
module.exports = { Workers, WorkerBudget, WorkerError, workerConfig, spawnWorker, killWorker, isolationProbe, PROFILES, MiB };
