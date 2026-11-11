const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { AsyncLocalStorage } = require('node:async_hooks');
const { EventEmitter } = require('node:events');
const { Workers, WorkerBudget, workerConfig, killWorker, isolationProbe, PROFILES } = require('../server/workers.js');
const { readProjectFile } = require('../server/project-files.js');
const { Runner } = require('../server/runner.js');
const { Accounts, accountConfig } = require('../server/accounts.js');
const { AccountAgents } = require('../server/agent-accounts.js');
const { AgentAuth } = require('../server/agent-auth.js');

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dialogue-worker-test-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const data = path.join(root, 'data'); const dir = path.join(data, 'workspaces', 'o-app', 'main');
  const home = path.join(data, 'users', 'matt', 'home'); const other = path.join(data, 'users', 'saori', 'home');
  const common = path.join(data, 'repos', 'o-app.git'); const gitdir = path.join(common, 'worktrees', 'main');
  for (const folder of [dir, home, other, gitdir]) await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(dir, '.git'), `gitdir: ${gitdir}\n`); await fs.writeFile(path.join(gitdir, 'commondir'), '../..\n');
  await fs.writeFile(path.join(data, 'accounts.sqlite'), 'private app canary'); await fs.writeFile(path.join(other, 'credential'), 'private member canary');
  const app = path.resolve(__dirname, '..');
  const config = workerConfig({ DIALOGUE_MODE: 'production' }, 'linux');
  const runtime = new Workers({ dataRoot: data, appRoot: app, config });
  return { root, data, dir, home, other, common, runtime, config };
}
function mounts(plan) {
  const entries = [];
  for (let i = 0; i < plan.args.length; i++) if (['--bind', '--ro-bind'].includes(plan.args[i])) entries.push({ mode: plan.args[i], source: plan.args[i + 1], target: plan.args[i + 2] });
  return entries;
}

// Execute the same serialized function used by assertReady, against procfs
// fixtures. These are regression tests, not claims of actual Linux isolation.
function probeFixture({ own = 'pid:[200]', init = own, visible = [], noNewPrivs = 1 } = {}) {
  const source = `(${isolationProbe.toString()})('/private/canary', 'pid:[100]');`;
  const reads = [], output = [];
  const procfs = {
    existsSync: file => visible.includes(file),
    readFileSync(file) {
      reads.push(file);
      if (file === '/proc/self/status') return `NoNewPrivs:\t${noNewPrivs}\n`;
      if (file === '/proc/1/cmdline') return `bwrap\0--\0node\0-e\0${source}`;
      throw new Error(`Unexpected procfs read: ${file}`);
    },
    readlinkSync(file) {
      reads.push(file);
      if (file === '/proc/self/ns/pid') return own;
      if (file === '/proc/1/ns/pid') return init;
      throw new Error(`Unexpected namespace read: ${file}`);
    }
  };
  const context = {
    require: name => { assert.equal(name, 'node:fs'); return procfs; },
    process: { exit: code => { throw Object.assign(new Error('probe exit'), { code }); }, stdin: { resume() {}, on() {} } },
    console: { log: value => output.push(value) }
  };
  return { source, procfs, reads, output, run: () => vm.runInNewContext(source, context, { timeout: 1000 }) };
}

test('namespace probe accepts isolated bwrap PID 1 even when its argv contains the probe source', () => {
  const fixture = probeFixture();
  assert.ok(fixture.procfs.readFileSync('/proc/1/cmdline').includes('systemd'));
  fixture.reads.length = 0;
  fixture.run();
  assert.deepEqual(fixture.output, ['isolated']);
  assert.ok(!fixture.reads.includes('/proc/1/cmdline'));
  assert.ok(fixture.reads.includes('/proc/self/ns/pid'));
  assert.ok(fixture.reads.includes('/proc/1/ns/pid'));
});

test('namespace probe refuses a worker that still shares the parent PID namespace', () => {
  const fixture = probeFixture({ own: 'pid:[100]' });
  assert.throws(fixture.run, { code: 13 });
  assert.deepEqual(fixture.output, []);
});

test('namespace probe refuses procfs whose PID 1 belongs to another namespace', () => {
  const fixture = probeFixture({ init: 'pid:[100]' });
  assert.throws(fixture.run, { code: 13 });
  assert.deepEqual(fixture.output, []);
});

test('namespace probe still refuses exposed private files and missing no-new-privileges', () => {
  for (const file of ['/private/canary', '/etc/dialogue/mail.env', '/run/systemd', '/sys/fs/cgroup']) {
    const fixture = probeFixture({ visible: [file] });
    assert.throws(fixture.run, { code: 11 });
    assert.deepEqual(fixture.output, []);
  }
  assert.throws(probeFixture({ noNewPrivs: 0 }).run, { code: 12 });
});

test('production cannot disable isolation, run on unsupported hosts, or silently misconfigure limits', () => {
  assert.equal(workerConfig({ DIALOGUE_MODE: 'production' }, 'linux').isolated, true);
  assert.throws(() => workerConfig({ DIALOGUE_MODE: 'production', DIALOGUE_WORKER_MODE: 'direct' }, 'linux'), /requires isolated/);
  assert.throws(() => workerConfig({ DIALOGUE_MODE: 'development', NODE_ENV: 'production', DIALOGUE_WORKER_MODE: 'direct' }, 'linux'), /requires isolated/);
  assert.throws(() => workerConfig({ DIALOGUE_MODE: 'production' }, 'darwin'), /require Linux/);
  assert.throws(() => workerConfig({ DIALOGUE_MODE: 'test', DIALOGUE_WORKER_BUDGET_MB: '-1' }), /budget/);
  assert.throws(() => workerConfig({ DIALOGUE_WORKER_BUDGET_MB: '768' }), /budget/);
  assert.throws(() => workerConfig({ DIALOGUE_WORKER_PARENT_UNIT: 'unrelated.service' }), /parent/);
  assert.equal(workerConfig({ DIALOGUE_MODE: 'development' }).isolated, false);
});

test('bounded FIFO reservations serialize expensive work, cancel queued jobs and enforce total memory', async () => {
  const config = workerConfig({ DIALOGUE_MODE: 'test', DIALOGUE_WORKER_WAIT_MS: '100' });
  const budget = new WorkerBudget(config);
  const first = await budget.acquire('agent'); let started = false;
  const second = budget.acquire('install').then(release => { started = true; return release; });
  await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(started, false);
  first(); const release = await second; assert.equal(started, true); release(); release();
  assert.equal(budget.active.size, 0);
  const a = await budget.acquire('agent'); const abort = new AbortController();
  const cancelled = assert.rejects(budget.acquire('install', { signal: abort.signal }), /cancelled/); abort.abort(); await cancelled;
  await assert.rejects(budget.acquire('agent'), /still busy/); a();
  const leases = [];
  for (const kind of ['agent', 'preview', 'preview', 'browser']) leases.push(await budget.acquire(kind));
  assert.equal([...budget.active.values()].reduce((n, k) => n + PROFILES[k].memory, 0), 2048);
  await assert.rejects(budget.acquire('control', { wait: false }), /busy/);
  leases.forEach(done => done()); budget.close(); await assert.rejects(budget.acquire('control'), /cancelled/);
});

test('queue capacity is bounded and shutdown releases pending callers', async () => {
  const config = workerConfig({ DIALOGUE_MODE: 'test', DIALOGUE_WORKER_QUEUE: '1' }); const budget = new WorkerBudget(config);
  const release = await budget.acquire('agent');
  const pending = assert.rejects(budget.acquire('install'), /stopping/);
  await assert.rejects(budget.acquire('install'), /busy/); budget.close(); await pending; release();
});

test('native Bun GC settings are fixed per worker ceiling and cannot inherit project overrides', async t => {
  const f = await fixture(t);
  for (const kind of ['agent', 'provider', 'control', 'terminal', 'preview', 'install']) {
    const plan = f.runtime.plan('/usr/bin/omp', [], { cwd: f.dir, env: { BUN_OPTIONS: '--eval=private', BUN_JSC_forceRAMSize: '99999999999' } }, { kind, home: f.home }, 'dialogue-test.scope');
    const values = new Map();
    for (let i = 0; i < plan.args.length; i++) if (plan.args[i] === '--setenv') values.set(plan.args[i + 1], plan.args[i + 2]);
    assert.equal(values.get('BUN_OPTIONS'), '--smol');
    assert.equal(values.get('BUN_JSC_forceRAMSize'), String(Math.max(64, Math.floor(PROFILES[kind].memory / 2)) * 1024 * 1024));
    assert.ok(!plan.args.includes('--eval=private'));
    assert.ok(plan.args.includes(`--property=MemoryMax=${PROFILES[kind].memory}M`));
  }
});

test('preview Node and Go hints share the existing scope without inheriting project runtime options', async t => {
  const f = await fixture(t);
  for (const [memory,nodeHeap,goHeap] of [[256,85,42],[768,256,128]]) {
    f.config.profiles.preview.memory=memory;
    const plan=f.runtime.plan(process.execPath,[],{cwd:f.dir,env:{NODE_OPTIONS:'--require=/private',GOMEMLIMIT:'16GiB',GOGC:'off',GOMAXPROCS:'99'}},{kind:'preview'},'dialogue-preview-test.scope');
    const env=new Map();for(let i=0;i<plan.args.length;i++)if(plan.args[i]==='--setenv')env.set(plan.args[i+1],plan.args[i+2]);
    assert.equal(env.get('NODE_OPTIONS'),`--max-old-space-size=${nodeHeap} --max-semi-space-size=4`);
    assert.equal(env.get('GOMEMLIMIT'),`${goHeap}MiB`);assert.equal(env.get('GOGC'),'50');assert.equal(env.get('GOMAXPROCS'),'1');
    assert.ok(plan.args.includes(`--property=MemoryMax=${memory}M`));assert.ok(plan.args.includes('--property=CPUQuota=50%'));assert.ok(plan.args.includes('--property=MemorySwapMax=0'));
    assert.ok(!plan.args.includes('--require=/private'));assert.ok(!plan.args.includes('16GiB'));
    const {stdout}=await require('node:util').promisify(require('node:child_process').execFile)(process.execPath,['-e',"console.log(require('node:v8').getHeapStatistics().heap_size_limit)"],{env:{NODE_OPTIONS:env.get('NODE_OPTIONS')}});
    assert.ok(Number(stdout)<=(nodeHeap+16)*1024*1024,'real Node accepts the old/young-generation bounds');
  }
  assert.equal(f.config.budget,2048);assert.equal(f.config.sliceMiB,2304);
  for(const kind of ['agent','provider','install','browser','control']) {
    const plan=f.runtime.plan(process.execPath,[],{cwd:f.dir,env:{GOMEMLIMIT:'16GiB',GOGC:'off',GOMAXPROCS:'99'}},{kind,home:f.home},'dialogue-other-test.scope');
    const env=new Map();for(let i=0;i<plan.args.length;i++)if(plan.args[i]==='--setenv')env.set(plan.args[i+1],plan.args[i+2]);
    assert.equal(env.get('NODE_OPTIONS'),`--max-old-space-size=${Math.max(64,Math.floor(f.config.profiles[kind].memory*.6))}`);
    for(const key of ['GOMEMLIMIT','GOGC','GOMAXPROCS'])assert.equal(env.has(key),false,'preview hints do not change other worker classes');
  }
});

test('worker failures distinguish signals, timeouts and exit codes without losing cleanup', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dialogue-worker-errors-'));
  const runtime = new Workers({ dataRoot: dir, appRoot: dir, config: workerConfig({ DIALOGUE_MODE: 'test' }) });
  t.after(async () => { await runtime.shutdown(); await fs.rm(dir, { recursive: true, force: true }); });
  const run = (source, timeout = 5000) => runtime.run(process.execPath, ['-e', source], { cwd: dir, timeout }, { kind: 'control' });
  await assert.rejects(run("process.kill(process.pid,'SIGTERM')"), e => e.signal === 'SIGTERM' && !e.timedOut && /terminated on SIGTERM/.test(e.message));
  await assert.rejects(run('setInterval(()=>{},1000)', 30), e => e.signal === 'SIGKILL' && e.timedOut && /timed out after 30 ms/.test(e.message));
  await assert.rejects(run("process.stderr.write('x'.repeat(2000));process.exit(7)"), e => e.code === 7 && !e.timedOut && e.message.length < 1200);
  assert.equal(runtime.budget.active.size, 0);
});

test('provider probes and RPC reserve the native profile and retain the selected member home', async t => {
  const f = await fixture(t), calls = [];
  const runtime = { spawn: async (_bin, args, options, policy) => {
    calls.push(policy);
    const source = args.includes('rpc') ? 'console.log(JSON.stringify({type:"ready"}));process.stdin.resume()' : 'console.log("OK")';
    return spawn(process.execPath, ['-e', source], { ...options, detached: true });
  } };
  const auth = new AgentAuth({ dataRoot: f.data, appRoot: path.resolve(__dirname, '..'), env: { HOME: f.home }, runtime });
  t.after(() => auth.shutdown());
  assert.equal((await auth.runOmp(['-p', 'probe'], { cwd: f.dir, timeoutMs: 5000 })).code, 0);
  const rpc = await auth.rpcChild(f.dir); await rpc.ready; rpc.close(); await rpc.exited;
  assert.equal(calls.length, 2);
  assert.ok(calls.every(policy => policy.kind === 'provider' && policy.home === f.home));
  assert.equal(PROFILES.provider.pool, PROFILES.agent.pool);
  const plan = f.runtime.plan('/usr/bin/omp', [], { cwd: f.dir, env: {} }, { kind: 'provider', home: f.home }, 'dialogue-test.scope');
  assert.ok(mounts(plan).some(m => m.source === f.home && m.mode === '--bind'));
});

test('agent policy exposes only its selected checkout, own home and read-only Git metadata', async t => {
  const f = await fixture(t);
  const snapshot = path.join(f.data, 'requests', '.figma-snapshots', 'one.json'); await fs.mkdir(path.dirname(snapshot), { recursive: true }); await fs.writeFile(snapshot, '{}');
  const activity = path.join(f.data, 'requests', '.activity', 'one.json'); await fs.mkdir(path.dirname(activity), { recursive: true }); await fs.writeFile(activity, '{}');
  const plan = f.runtime.plan('/usr/bin/omp', ['-p', 'a literal $HOME and $(echo nope)'], { cwd: f.dir, env: {
    DIALOGUE_SMTP_URL: 'smtp-private', FIGMA_ACCESS_TOKEN: 'figma-private', OPENAI_API_KEY: 'owner-private', SSH_AUTH_SOCK: '/run/private.sock', NODE_OPTIONS: '--require=/private', PORT: '4500'
  } }, { kind: 'agent', home: f.home, activityFile: activity, readOnlyFiles: [snapshot] }, 'dialogue-worker-test.scope');
  const entries = mounts(plan);
  assert.ok(entries.some(m => m.source === f.dir && m.mode === '--bind'));
  assert.ok(entries.some(m => m.source === f.home && m.mode === '--bind'));
  assert.ok(entries.some(m => m.source === f.common && m.mode === '--ro-bind'));
  assert.ok(entries.some(m => m.source === snapshot && m.mode === '--ro-bind'));
  assert.ok(entries.some(m => m.source === activity && m.mode === '--bind'));
  assert.ok(!entries.some(m => [f.data, f.other, '/', '/etc', path.dirname(activity)].includes(m.source)));
  for (const secret of ['smtp-private', 'figma-private', 'owner-private', '/run/private.sock', '--require=/private']) assert.ok(!plan.args.includes(secret));
  assert.ok(plan.args.includes('--unshare-pid')); assert.ok(plan.args.includes('--disable-userns')); assert.ok(plan.args.includes('--clearenv'));
  assert.ok(plan.args.includes('--expand-environment=no'));
  assert.ok(plan.args.includes('--property=BindsTo=dialogue.service'));
  assert.ok(plan.args.includes('--property=MemoryMax=1280M'));
  assert.ok(plan.args.includes('--property=TasksMax=96'));
  assert.ok(plan.args.includes('a literal $HOME and $(echo nope)'));
});

test('install/preview workers never receive provider homes and subdirectory recipes retain their checkout boundary', async t => {
  const f = await fixture(t); const subdir = path.join(f.dir, 'app'); await fs.mkdir(subdir);
  for (const kind of ['install', 'preview']) {
    const policy = { kind, home: f.home, workspaceRoot: f.dir }; await f.runtime.prepare(policy, { cwd: subdir });
    const plan = f.runtime.plan('/bin/sh', ['-c', 'echo hi'], { cwd: subdir, env: { HOME: f.home, API_KEY: 'private' } }, policy, 'dialogue-worker-test.scope');
    assert.ok(!mounts(plan).some(m => m.source === f.home));
    assert.ok(mounts(plan).some(m => m.source === f.dir));
    assert.ok(mounts(plan).some(m => m.target === '/home/worker' && m.source.startsWith(path.join(f.data, 'workers', 'cache'))));
    assert.ok(!plan.args.includes('private'));
  }
});

test('worker policy rejects filesystem aliases, private-root grants and snapshots outside their scope', async t => {
  const f = await fixture(t);
  const options = { cwd: f.dir, env: {} };
  await fs.symlink(f.other, path.join(f.dir, 'outside'));
  assert.throws(() => f.runtime.plan('/bin/sh', [], { ...options, cwd: path.join(f.dir, 'outside') }, { kind: 'preview' }, 'unit.scope'), /symbolic links/);
  assert.throws(() => f.runtime.plan('/bin/sh', [], options, { kind: 'agent', home: f.data }, 'unit.scope'), /credential directory/);
  assert.throws(() => f.runtime.plan('/bin/sh', [], options, { kind: 'agent', readOnlyFiles: [path.join(f.data, 'accounts.sqlite')] }, 'unit.scope'), /design snapshot/);
  f.runtime.config.toolRoots = ['/home']; assert.throws(() => f.runtime.plan('/bin/sh', [], options, { kind: 'agent' }, 'unit.scope'), /tool roots/);
});

test('isolated runtime refuses all work before readiness and does not fall back to a native spawn', async t => {
  const f = await fixture(t); let forks = 0; f.runtime.spawnProcess = () => { forks++; };
  await assert.rejects(f.runtime.spawn('/bin/sh', ['-c', 'true'], { cwd: f.dir }, { kind: 'agent' }), /not ready/);
  assert.equal(forks, 0);
  await assert.rejects(f.runtime.assertReady()); assert.equal(forks, 0);
});

test('development runtime queues real processes and cancellation/shutdown remove queued work', async t => {
  const f = await fixture(t);
  const runtime = new Workers({ dataRoot: f.data, appRoot: path.resolve(__dirname, '..'), config: workerConfig({ DIALOGUE_MODE: 'test' }) });
  t.after(() => runtime.shutdown());
  const child = await runtime.spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: f.dir, stdio: 'ignore' }, { kind: 'agent' });
  const abort = new AbortController(); const waiting = assert.rejects(runtime.spawn(process.execPath, ['-e', 'process.exit(99)'], { cwd: f.dir }, { kind: 'install', signal: abort.signal }), /cancelled/);
  abort.abort(); await waiting;
  const closed = once(child, 'close'); killWorker(child, 'SIGKILL'); await closed; await child.workerFinished;
  assert.equal(runtime.budget.active.size, 0);
  await runtime.shutdown(); await assert.rejects(runtime.spawn('/bin/sh', [], { cwd: f.dir }), /not ready/);
});

test('scope capacity stays reserved until cleanup succeeds; failed cleanup stops new admission', async t => {
  const f = await fixture(t);
  const child = new EventEmitter(); child.exitCode = 0;
  f.runtime.ready = true; f.runtime.diskReady = async () => {}; f.runtime.prepare = async () => {};
  f.runtime.plan = () => ({ bin: 'mock-launcher', args: [] }); f.runtime.spawnProcess = () => child;
  let finishCleanup;
  f.runtime.execute = async (_bin,args) => args.includes('stop') ? new Promise(resolve => { finishCleanup = resolve; }) : {stdout:''};
  await f.runtime.spawn('mock-worker', [], { cwd: f.dir }, { kind: 'agent' });
  child.emit('close', 0);
  assert.equal(f.runtime.budget.active.size, 1);
  while (!finishCleanup) await new Promise(resolve => setTimeout(resolve,1));
  finishCleanup({}); await child.workerFinished;
  assert.equal(f.runtime.budget.active.size, 0);
  const messages = []; t.mock.method(console, 'error', text => messages.push(text));
  f.runtime.execute = async () => { throw new Error('service manager unavailable'); };
  await f.runtime.spawn('mock-worker', [], { cwd: f.dir }, { kind: 'agent' });
  child.emit('close', 0); await assert.rejects(child.workerFinished, /cleanup/);
  assert.equal(f.runtime.budget.active.size, 1);
  assert.equal(f.runtime.ready, false);
  assert.equal(f.runtime.budget.closed, true);
  assert.match(messages[0], /cleanup could not be verified/);
  await assert.rejects(f.runtime.spawn('mock-worker', [], { cwd: f.dir }), /not ready/);
});

test('cancellation before scope registration also terminates the pending launcher', async t => {
  const f = await fixture(t); const signals = [];
  const child = new EventEmitter(); child.exitCode = null; child.kill = signal => signals.push(signal);
  f.runtime.ready = true; f.runtime.diskReady = async () => {}; f.runtime.prepare = async () => {};
  f.runtime.plan = () => ({ bin: 'mock-launcher', args: [] }); f.runtime.spawnProcess = () => child;
  f.runtime.execute = async () => { throw Object.assign(new Error('not registered'), { stderr: 'Unit not loaded' }); };
  const abort = new AbortController();
  await f.runtime.spawn('mock-worker', [], { cwd: f.dir }, { kind: 'agent', signal: abort.signal });
  abort.abort(); assert.deepEqual(signals, ['SIGKILL']);
  child.exitCode = 1; child.emit('close', 1); await child.workerFinished;
  assert.equal(f.runtime.budget.active.size, 0);
  await assert.rejects(Workers.prototype.prepare.call(f.runtime, { activityFile: path.join(f.root, 'outside', 'file') }, { cwd: f.dir }), /activity file/);
  await assert.rejects(fs.stat(path.join(f.root, 'outside')), { code: 'ENOENT' });
});

test('oversized unterminated provider RPC output is rejected without unbounded parent buffering', async t => {
  const f = await fixture(t);
  const runtime = { spawn: async () => spawn(process.execPath, ['-e', "process.stdout.write('x'.repeat(2*1024*1024));setInterval(()=>{},1000)"], { cwd: f.dir, detached: true, stdio: ['pipe', 'pipe', 'pipe'] }) };
  const auth = new AgentAuth({ dataRoot: f.data, appRoot: path.resolve(__dirname, '..'), runtime });
  const rpc = await auth.rpcChild(f.dir);
  t.after(() => { rpc.kill(); auth.shutdown(); });
  await assert.rejects(rpc.ready, /oversized response/);
  assert.notEqual(await rpc.exited, 0);
});

test('production identities including the owner use separate credential homes instead of the app home', async t => {
  const f = await fixture(t); const accounts = new Accounts({ dataRoot: path.join(f.root, 'identities'), config: accountConfig({ DIALOGUE_MODE: 'test', DIALOGUE_INITIAL_MEMBERS: 'editor@example.test' }), sendMail: async () => {} });
  t.after(() => accounts.close());
  const router = new AccountAgents({ accounts, context: new AsyncLocalStorage(), dataRoot: f.data, appRoot: path.resolve(__dirname, '..'), runtime: { isolated: true } });
  const owner = router.forUser(accounts.ownerId); const editor = router.forUser(accounts.members().find(m => m.role === 'editor').id);
  assert.ok(owner.ompEnv().HOME.startsWith(path.join(f.data, 'users')));
  assert.notEqual(owner.ompEnv().HOME, editor.ompEnv().HOME);
  assert.notEqual(owner.settingsPath, path.join(f.data, 'agent.json'));
  router.shutdown();
});

test('project reads reject secret symlinks and bound memory even for files changed by workers', async t => {
  const f = await fixture(t); const safe = path.join(f.dir, 'safe.txt'); await fs.writeFile(safe, 'hello');
  assert.equal((await readProjectFile(f.dir, safe)).toString(), 'hello');
  const link = path.join(f.dir, 'secret-link'); await fs.symlink(path.join(f.data, 'accounts.sqlite'), link);
  await assert.rejects(readProjectFile(f.dir, link), /leaves its working copy/);
  await fs.writeFile(safe, 'a'.repeat(1025)); await assert.rejects(readProjectFile(f.dir, safe, 1024), /too large/);
  const manifest = path.join(f.dir, 'package.json'); await fs.symlink(path.join(f.data, 'accounts.sqlite'), manifest);
  const runner = new Runner({ dir: f.dir, recipe: { kind: 'static', root: 'outside' }, stampDir: path.join(f.root, 'stamps') });
  await fs.symlink(f.other, path.join(f.dir, 'outside')); await assert.rejects(runner.start(), /leaves its working copy/);
});

test('production server exits before opening a listener when isolated workers are disabled', async t => {
  const f = await fixture(t);
  const child = spawn(process.execPath, [path.resolve(__dirname, '../server.js')], { env: { ...process.env,
    DIALOGUE_MODE: 'production', NODE_ENV: 'production', DIALOGUE_WORKER_MODE: 'direct',
    DIALOGUE_DATA: path.join(f.root, 'production'), DIALOGUE_ORIGIN: 'https://build.idealogue.studio',
    DIALOGUE_OWNER_EMAIL: 'owner@example.test', DIALOGUE_SMTP_URL: 'smtps://smtp.example.test', DIALOGUE_MAIL_FROM: 'Dialogue <noreply@example.test>'
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  const [code] = await once(child, 'exit'); assert.notEqual(code, 0); assert.match(output, /Production requires isolated workers/); assert.doesNotMatch(output, /server running/);
});

test('conversation workers get only their selected native session, reply and attachment; discussion can mount checkout read-only', async t => {
  const f = await fixture(t);
  const sessionDir = path.join(f.data, 'requests', '.sessions', 'selected'); const other = path.join(f.data, 'requests', '.sessions', 'other');
  const replyFile = path.join(f.data, 'requests', '.replies', 'reply.json'); const attachment = path.join(f.data, 'requests', '.attachments', 'request', 'notes.txt');
  for (const dir of [sessionDir, other, path.dirname(replyFile), path.dirname(attachment)]) await fs.mkdir(dir, {recursive:true});
  await fs.writeFile(replyFile, '{}'); await fs.writeFile(attachment, 'design notes');
  const attachmentDir = path.dirname(attachment);
  const policy = {kind:'agent',home:f.home,sessionDir,attachmentDir,replyFile,readOnlyFiles:[attachment],readOnlyWorkspace:true};
  const plan = f.runtime.plan('/usr/bin/omp', [], {cwd:f.dir,env:{DIALOGUE_REPLY_FILE:replyFile}}, policy, 'test.scope');
  const entries = mounts(plan);
  assert.ok(entries.some(m=>m.source===f.dir && m.mode==='--ro-bind'));
  assert.ok(entries.some(m=>m.source===sessionDir && m.mode==='--bind'));
  assert.ok(entries.some(m=>m.source===replyFile && m.mode==='--bind'));
  assert.ok(entries.some(m=>m.source===attachment && m.mode==='--ro-bind'));
  assert.ok(entries.some(m=>m.source===attachmentDir && m.mode==='--ro-bind'));
  assert.ok(!entries.some(m=>m.source===other || m.source===path.dirname(sessionDir) || m.source===path.dirname(replyFile)));
  assert.throws(()=>f.runtime.plan('/usr/bin/omp',[],{cwd:f.dir},{...policy,sessionDir:f.other},'test.scope'),/session directory/);
  assert.throws(()=>f.runtime.plan('/usr/bin/omp',[],{cwd:f.dir},{...policy,replyFile:path.join(f.data,'accounts.sqlite')},'test.scope'),/reply file/);
  assert.throws(()=>f.runtime.plan('/bin/sh',[],{cwd:f.dir},{...policy,kind:'install'},'test.scope'),/session directory/);
});

test('a replacement preview waits for a closing scope without exceeding the two-preview limit', async t => {
  const f=await fixture(t);f.runtime.ready=true;f.runtime.diskReady=async()=>{};f.runtime.prepare=async()=>{};f.runtime.plan=()=>({bin:'mock-launcher',args:[]});
  const children=[];f.runtime.spawnProcess=()=>{const child=new EventEmitter();child.exitCode=null;children.push(child);return child;};
  let cleaned;f.runtime.execute=async(_bin,args)=>args.includes('stop')?new Promise(resolve=>{cleaned=resolve}):{stdout:''};
  const a=await f.runtime.spawn('preview',[],{cwd:f.dir},{kind:'preview'});await f.runtime.spawn('preview',[],{cwd:f.dir},{kind:'preview'});
  a.exitCode=0;a.emit('close',0);
  const replacement=f.runtime.spawn('preview',[],{cwd:f.dir},{kind:'preview'});
  await new Promise(r=>setImmediate(r));assert.equal(children.length,2);assert.equal(f.runtime.budget.pending.length,1);assert.equal(f.runtime.budget.active.size,2);
  while(!cleaned)await new Promise(r=>setTimeout(r,1));cleaned({});await replacement;assert.equal(children.length,3);assert.equal(f.runtime.budget.active.size,2);
  f.runtime.execute=async()=>({});for(const child of children.slice(1)){child.exitCode=0;child.emit('close',0);await child.workerFinished;}
});
