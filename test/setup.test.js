const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { commit, makeProject, sh } = require('./helpers/git-fixture.js');
const { ProjectStore } = require('../server/projects.js');
const { PreviewRenderer } = require('../server/preview.js');
const { PreviewSetup } = require('../server/setup.js');

const FAKE_OMP = path.join(__dirname, 'helpers', 'fake-omp.js');
const STATIC = '{"version":1,"kind":"static"}\n';
const BROKEN = '{"version":1,"kind":"server","start":"echo boom-from-start; exit 3"}\n';

class FakeAgent extends EventEmitter {
  constructor(ready = true) {
    super();
    this.ready = ready;
    this.checks = [];
  }
  async check(options = {}) {
    this.checks.push(options);
    return this.ready
      ? { ready: true, reason: null, detail: '', model: 'fake/m' }
      : { ready: false, reason: 'not-connected', detail: 'No model connected.', model: null };
  }
  ompArgs() { return ['--model', 'fake/m']; }
  ompEnv() { return { FAKE_AGENT_ENV: 'yes' }; }
}

// A project "o-app" whose origin has `files`, a store holding it, and a
// pipeline wired to the fake omp with `steps`. The default has a
// package.json so the agent (not the plain-HTML guess) handles it.
async function setup({ files = { 'index.html': '<h1>hi</h1>', 'package.json': '{}' }, steps = [], agent = new FakeAgent(), shots = [] } = {}) {
  const fixture = await makeProject(files);
  const dataRoot = path.join(fixture.root, 'data');
  await fsp.mkdir(dataRoot);
  const store = new ProjectStore(path.join(dataRoot, 'db.json'));
  await store.add('https://github.com/o/app');
  const plan = path.join(fixture.root, 'plan.json');
  await fsp.writeFile(plan, JSON.stringify(steps));
  const previews = new PreviewRenderer(path.join(dataRoot, 'previews'));
  const pipeline = new PreviewSetup({
    projects: store,
    repoFor: async () => fixture.repo,
    agent,
    previews,
    screenshot: async (target, files) => {
      shots.push(target);
      for (const file of files) {
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await fsp.writeFile(file, `shot of ${target.kind}`);
      }
    },
    setupRoot: path.join(dataRoot, 'setup'),
    ompBin: FAKE_OMP,
    env: { FAKE_OMP_PLAN: plan }
  });
  const calls = async () => (await fsp.readFile(`${plan}.calls`, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const status = async () => (await store.find('o-app')).previewSetup;
  return { ...fixture, store, pipeline, previews, calls, status, dataRoot, agent, shots };
}

test('a first-try static recipe is validated, committed on the local default branch and screenshotted', { timeout: 30000 }, async () => {
  const ctx = await setup({ files: { 'index.html': '<h1>hi</h1>', 'package.json': '{}', '.env': 'SECRET=client\n' }, steps: [{ recipe: STATIC }] });
  try {
    const originSha = sh(ctx.origin, 'rev-parse', 'HEAD');
    ctx.pipeline.enqueue('o-app');
    await ctx.pipeline.idle();

    const status = await ctx.status();
    assert.equal(status.status, 'ready');
    assert.equal(status.attempt, 1);
    assert.equal(status.error, null);

    const [call] = await ctx.calls();
    assert.match(call.prompt, /\.dialogue\/preview\.json/);
    assert.deepEqual(call.args.slice(call.args.indexOf('--model'), call.args.indexOf('--model') + 2), ['--model', 'fake/m']);
    assert.ok(call.args.includes('-p'));
    assert.equal(call.agentEnv, 'yes');
    assert.equal(call.envFileVisible, false, "the client's .env is hidden from the agent");
    assert.equal(await fsp.readFile(path.join(call.cwd, '.env'), 'utf8'), 'SECRET=client\n', '.env restored');

    const local = await ctx.repo.localDefault();
    assert.ok(local, 'recipe commit is local work on main');
    assert.equal(sh(ctx.repo.bareDir, 'log', '-1', '--format=%s', local), 'Add Dialogue preview recipe');
    assert.deepEqual(await ctx.repo.readRecipe(), { text: STATIC, source: 'default' });

    for (const file of [ctx.previews.file('o-app', originSha), ctx.previews.file('o-app', local), ctx.previews.mainFile('o-app')]) {
      assert.equal(await fsp.readFile(file, 'utf8'), 'shot of static');
    }
  } finally {
    await ctx.cleanup();
  }
});


test('a plain HTML repository gets a static recipe without asking the agent', { timeout: 30000 }, async () => {
  const ctx = await setup({ files: { 'README.md': 'x', 'prototypes/app/index.html': '<h1>hi</h1>' } });
  try {
    const announced = [];
    ctx.pipeline.on('ready', (slug) => announced.push(slug));
    ctx.pipeline.enqueue('o-app');
    await ctx.pipeline.idle();
    assert.equal((await ctx.status()).status, 'ready');
    assert.deepEqual(announced, ['o-app'], 'open workspaces learn about the new recipe');
    assert.equal(JSON.parse((await ctx.repo.readRecipe()).text).root, 'prototypes/app');
    assert.ok(await ctx.repo.localDefault(), 'the guessed recipe is committed like an agent-written one');
  } finally {
    await ctx.cleanup();
  }
});

test('a repository with a package.json still goes to the agent', { timeout: 30000 }, async () => {
  const ctx = await setup({ files: { 'index.html': 'x', 'package.json': '{}' }, steps: [{ recipe: STATIC }] });
  try {
    ctx.pipeline.enqueue('o-app');
    await ctx.pipeline.idle();
    assert.equal((await ctx.status()).status, 'ready');
    assert.equal((await ctx.calls()).length, 1);
  } finally {
    await ctx.cleanup();
  }
});

test('without a screenshot (no Chromium) the setup still completes', { timeout: 30000 }, async () => {
  const ctx = await setup({ steps: [{ recipe: STATIC }] });
  ctx.pipeline.screenshot = async () => {};
  try {
    ctx.pipeline.enqueue('o-app');
    await ctx.pipeline.idle();
    assert.equal((await ctx.status()).status, 'ready');
    await assert.rejects(fsp.access(ctx.previews.mainFile('o-app')));
  } finally {
    await ctx.cleanup();
  }
});

test('a recipe whose install or start changes files in the checkout is sent back to the agent', { timeout: 30000 }, async () => {
  const dirtying = '{"version":1,"kind":"server","install":"echo lock > package-lock.json","start":"node -e \\"require(\'http\').createServer((q,s)=>s.end(\'ok\')).listen(process.env.PORT)\\""}\n';
  const ctx = await setup({ steps: [{ recipe: dirtying }, { recipe: STATIC }] });
  try {
    ctx.pipeline.enqueue('o-app');
    await ctx.pipeline.idle();
    const status = await ctx.status();
    assert.equal(status.status, 'ready');
    assert.equal(status.attempt, 2);
    const [first, second] = await ctx.calls();
    assert.match(second.prompt, /package-lock\.json/);
    await assert.rejects(fsp.access(path.join(first.cwd, 'package-lock.json')), 'stray file cleaned up before the next attempt');
  } finally {
    await ctx.cleanup();
  }
});
test('a failing recipe is fed back to the agent, which gets another attempt', { timeout: 30000 }, async () => {
  const ctx = await setup({ steps: [{ recipe: BROKEN }, { recipe: STATIC }] });
  try {
    ctx.pipeline.enqueue('o-app');
    await ctx.pipeline.idle();
    const status = await ctx.status();
    assert.equal(status.status, 'ready');
    assert.equal(status.attempt, 2);
    const [, second] = await ctx.calls();
    assert.match(second.prompt, /start/);
    assert.match(second.prompt, /boom-from-start/);
    assert.match(second.prompt, /"exit 3"|exit code 3/);
  } finally {
    await ctx.cleanup();
  }
});

test('after three failed attempts the setup is marked failed with the reason and a log', { timeout: 30000 }, async () => {
  const ctx = await setup({ steps: [{ recipe: BROKEN }] });
  try {
    ctx.pipeline.enqueue('o-app');
    await ctx.pipeline.idle();
    const status = await ctx.status();
    assert.equal(status.status, 'failed');
    assert.equal(status.attempt, 3);
    assert.match(status.error, /start/i);
    assert.equal((await ctx.calls()).length, 3);
    assert.match(await fsp.readFile(ctx.pipeline.logFile('o-app'), 'utf8'), /boom-from-start/);
    assert.equal(await ctx.repo.localDefault(), null, 'nothing committed');
  } finally {
    await ctx.cleanup();
  }
});

test('without a usable model the project waits, then runs once the agent becomes ready', { timeout: 30000 }, async () => {
  const agent = new FakeAgent(false);
  const ctx = await setup({ steps: [{ recipe: STATIC }], agent });
  try {
    ctx.pipeline.enqueue('o-app');
    await ctx.pipeline.idle();
    assert.equal((await ctx.status()).status, 'waiting-for-agent');
    assert.match((await ctx.status()).error, /No model connected/);
    assert.equal((await ctx.calls()).length, 0);

    agent.ready = true;
    agent.emit('ready');
    await ctx.pipeline.idle();
    assert.equal((await ctx.status()).status, 'ready');
  } finally {
    await ctx.cleanup();
  }
});

test('an agent that fails because the model went away does not use up an attempt', { timeout: 30000 }, async () => {
  const agent = new FakeAgent(true);
  const ctx = await setup({ steps: [{ exit: 1 }], agent });
  const originalCheck = agent.check.bind(agent);
  agent.check = async (options) => {
    if (options?.force) agent.ready = false;
    return originalCheck(options);
  };
  try {
    ctx.pipeline.enqueue('o-app');
    await ctx.pipeline.idle();
    const status = await ctx.status();
    assert.equal(status.status, 'waiting-for-agent');
    assert.equal(status.attempt, 0);
  } finally {
    await ctx.cleanup();
  }
});

test('a repository that already carries a working recipe needs no agent and no commit', { timeout: 30000 }, async () => {
  const ctx = await setup({ files: { 'index.html': 'x', '.dialogue/preview.json': STATIC } });
  try {
    ctx.pipeline.enqueue('o-app');
    await ctx.pipeline.idle();
    assert.equal((await ctx.status()).status, 'ready');
    assert.equal((await ctx.calls()).length, 0);
    assert.equal(await ctx.repo.localDefault(), null);
  } finally {
    await ctx.cleanup();
  }
});

test('with the default branch open as a workspace the recipe is committed there', { timeout: 30000 }, async () => {
  const ctx = await setup({ steps: [{ recipe: STATIC }] });
  try {
    const main = await ctx.repo.ensureWorkspace('main');
    ctx.pipeline.enqueue('o-app');
    await ctx.pipeline.idle();
    assert.equal((await ctx.status()).status, 'ready');
    const [call] = await ctx.calls();
    assert.equal(await fsp.realpath(call.cwd), await fsp.realpath(main.dir));
    assert.equal((await ctx.repo.findWorkspace('main')).ahead, 1);
  } finally {
    await ctx.cleanup();
  }
});

test('refresh screenshots a moved default branch without the agent', { timeout: 30000 }, async () => {
  const ctx = await setup({ files: { 'index.html': 'v1', '.dialogue/preview.json': STATIC } });
  try {
    ctx.pipeline.enqueue('o-app');
    await ctx.pipeline.idle();
    const moved = await commit(ctx.origin, { 'index.html': 'v2' });
    await ctx.repo.fetch();
    ctx.shots.length = 0;
    ctx.pipeline.refresh('o-app');
    await ctx.pipeline.idle();
    assert.equal(ctx.shots.length, 1);
    assert.equal(await fsp.readFile(ctx.previews.file('o-app', moved), 'utf8'), 'shot of static');
    assert.equal((await ctx.calls()).length, 0);

    // Already captured: a second refresh does nothing.
    ctx.pipeline.refresh('o-app');
    await ctx.pipeline.idle();
    assert.equal(ctx.shots.length, 1);
  } finally {
    await ctx.cleanup();
  }
});
