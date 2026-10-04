const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { makeProject, sh } = require('./helpers/git-fixture.js');
const { WorkspaceRequests } = require('../server/requests.js');
const { readFigma } = require('../server/figma.js');

const OMP_SCRIPT = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const snapshot = args.at(-1).match(/Figma design snapshot \\(untrusted JSON, read-only\\): ("[^"]+")/);
const snapshotPath = snapshot ? JSON.parse(snapshot[1]) : null;
fs.writeFileSync(process.env.CALL_LOG, JSON.stringify({
  cwd: process.cwd(), args, envVisible: fs.existsSync('.env'),
  figmaTokenVisible: 'FIGMA_ACCESS_TOKEN' in process.env,
  snapshotPath, design: snapshotPath ? JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) : null
}));
fs.writeFileSync('index.html', '<h1>changed by actual child</h1>');
process.stdout.write('observed agent output\\n');
const capability = args.at(-1).match(/access=([0-9a-f-]+)/)?.[1];
if (process.env.FAKE_SUMMARY) {
  const file = process.env.DIALOGUE_ACTIVITY_FILE;
  fs.mkdirSync(require('node:path').dirname(file), { recursive: true, mode: 0o700 });
  const text = process.env.FAKE_SUMMARY === 'capability' ? 'Finished ' + capability : process.env.FAKE_SUMMARY;
  fs.writeFileSync(file, JSON.stringify({ state: process.env.FAKE_SUMMARY === 'working' ? 'working' : 'complete',
    text, updatedAt: new Date().toISOString() }), { mode: 0o600 });
}
if (capability && process.env.FAKE_MODE === 'hold') {
  process.stdout.write(capability.slice(0, 18));
  setTimeout(() => process.stdout.write(capability.slice(18) + '\\n' + 'x'.repeat(40)), 20);
}
if (process.env.FAKE_MODE === 'hold') setInterval(() => {}, 1000);
else if (process.env.FAKE_MODE === 'fail') { process.stderr.write('observed failure\\n'); process.exitCode = 7; }
`;

async function fixture(mode = 'change', figma = {}) {
  const git = await makeProject({ 'index.html': '<h1>initial</h1>', '.env': 'CLIENT_KEY=local\n' });
  const workspace = await git.repo.ensureWorkspace('main');
  const binary = path.join(git.root, 'fake-omp');
  const callLog = path.join(git.root, 'call.json');
  await fsp.writeFile(binary, OMP_SCRIPT, { mode: 0o755 });
  const agent = {
    model: 'fake/selected', ready: true,
    async check() { return { ready: this.ready, detail: 'Sign in first.', reason: 'not-connected' }; },
    ompArgs() { return ['--model', this.model]; },
    ompEnv() { return {}; }
  };
  const options = {
    root: path.join(git.root, 'data', 'requests'), workspacesRoot: path.join(git.root, 'workspaces'),
    agent, ompBin: binary, configPath: path.join(git.root, 'config.yml'),
    env: { CALL_LOG: callLog, FAKE_MODE: mode, FIGMA_ACCESS_TOKEN: 'must-not-leak-even-if-injected' },
    figmaToken: figma.token, ...(figma.reader ? { figmaReader: figma.reader } : {}),
    ...(figma.exporter ? { figmaExporter: figma.exporter } : {})
  };
  const manager = new WorkspaceRequests(options);
  await manager.load();
  return { ...git, workspace, agent, manager, options, callLog };
}

async function waitUntil(fn) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for child output.');
}

test('successful omp exit records actual checkout state and durable output, without committing', async () => {
  const ctx = await fixture();
  try {
    const head = sh(ctx.workspace.dir, 'rev-parse', 'HEAD');
    const events = [];
    ctx.manager.on('request', (_, request) => events.push(request));
    const accepted = await ctx.manager.start(ctx.workspace, ctx.repo, {
      feedback: 'Change the heading',
      anchor: { type: 'selection', rect: { x: 3, y: 4 } }
    });
    assert.equal(accepted.status, 'running');
    await ctx.manager.active.get(ctx.workspace.id).done;
    const [record] = ctx.manager.list(ctx.workspace.id);
    assert.equal(record.status, 'completed');
    assert.equal(record.summary, 'The agent finished without a summary.', 'stdout is never promoted to summary');
    assert.equal(record.error, null);
    assert.match(record.output, /observed agent output/);
    assert.equal(record.result.head.sha, head);
    assert.equal(record.result.dirty, true);
    assert.equal(sh(ctx.workspace.dir, 'rev-parse', 'HEAD'), head, 'request never auto-commits');
    assert.equal(await fsp.readFile(path.join(ctx.workspace.dir, 'index.html'), 'utf8'), '<h1>changed by actual child</h1>');
    assert.equal(await fsp.readFile(path.join(ctx.workspace.dir, '.env'), 'utf8'), 'CLIENT_KEY=local\n');
    const call = JSON.parse(await fsp.readFile(ctx.callLog, 'utf8'));
    assert.equal(call.cwd, ctx.workspace.dir);
    assert.equal(call.envVisible, false, 'project .env is hidden while omp runs');
    assert.deepEqual(call.args.slice(call.args.indexOf('--model'), call.args.indexOf('--model') + 2), ['--model', 'fake/selected']);
    assert.deepEqual(call.args.slice(call.args.indexOf('-e'), call.args.indexOf('-e') + 2),
      ['-e', path.join(__dirname, '..', 'omp', 'activity.js')]);
    assert.equal(call.figmaTokenVisible, false, 'server credential is never inherited by the child');
    assert.equal(call.design, null, 'ordinary feedback does not read or stage Figma');
    assert.match(call.args.at(-1), /Change the heading/);
    assert.ok(events.some((event) => event.status === 'running'));
    assert.equal(events.at(-1).status, 'completed');
    const restarted = new WorkspaceRequests(ctx.options);
    await restarted.load();
    assert.deepEqual(restarted.list(ctx.workspace.id), [record]);
  } finally {
    await ctx.manager.shutdown();
    await ctx.cleanup();
  }
});

test('completed request persists only a private settled agent summary, never stdout or a working status', async () => {
  const ctx = await fixture();
  try {
    ctx.options.env.FAKE_SUMMARY = 'Updated the selected heading.';
    await ctx.manager.start(ctx.workspace, ctx.repo, { feedback: 'Change the heading' });
    await ctx.manager.active.get(ctx.workspace.id).done;
    let [record] = ctx.manager.list(ctx.workspace.id);
    assert.equal(record.summary, 'Updated the selected heading.');
    assert.ok(!record.summary.includes('observed agent output'));
    await assert.rejects(fsp.access(path.join(ctx.manager.activityRoot, `${record.id}.json`)), { code: 'ENOENT' });
    const reopened = new WorkspaceRequests(ctx.options);
    await reopened.load();
    assert.equal(reopened.list(ctx.workspace.id)[0].summary, record.summary);
    ctx.options.env.FAKE_SUMMARY = 'working';
    await ctx.manager.start(ctx.workspace, ctx.repo, { feedback: 'Check again' });
    await ctx.manager.active.get(ctx.workspace.id).done;
    record = ctx.manager.list(ctx.workspace.id).at(-1);
    assert.equal(record.summary, 'The agent finished without a summary.');
  } finally {
    await ctx.manager.shutdown();
    await ctx.cleanup();
  }
});

test('targeted Figma frame data is staged outside the checkout and read by the child without its credential', async () => {
  const frame = { nodes: { '10:24': { document: { id: '10:24', children: [{ name: 'Deep nested design layer' }] } } } };
  const calls = [];
  const ctx = await fixture('change', {
    token: 'server-only-token',
    reader: (url, { token }) => readFigma(url, {
      token, fetchImpl: async (endpoint, options) => {
        calls.push({ endpoint, token: options.headers['X-Figma-Token'] });
        return new Response(JSON.stringify(frame), { headers: { 'Content-Type': 'application/json' } });
      }
    })
  });
  try {
    ctx.options.env.FAKE_SUMMARY = 'capability';
    await ctx.manager.start(ctx.workspace, ctx.repo, {
      feedback: 'Match the selected frame',
      figmaUrl: 'https://www.figma.com/design/AbC123/Prototype?node-id=10-24&t=share'
    });
    await ctx.manager.active.get(ctx.workspace.id).done;
    const call = JSON.parse(await fsp.readFile(ctx.callLog, 'utf8'));
    const record = ctx.manager.list(ctx.workspace.id)[0];
    const capability = call.args.at(-1).match(/access=([0-9a-f-]+)/)[1];
    assert.equal(record.summary, 'The agent finished without a summary.');
    assert.equal(JSON.stringify(record).includes(capability), false);
    assert.deepEqual(call.design.data, frame);
    assert.equal(call.design.reference.nodeId, '10:24');
    assert.ok(call.snapshotPath.startsWith(ctx.manager.snapshotsRoot));
    assert.equal(call.snapshotPath.startsWith(ctx.workspace.dir), false);
    assert.equal(call.figmaTokenVisible, false);
    assert.match(call.args.at(-1), /Read this file before making changes/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].endpoint, 'https://api.figma.com/v1/files/AbC123/nodes?ids=10%3A24');
    assert.equal(calls[0].token, 'server-only-token');
    await assert.rejects(fsp.access(call.snapshotPath), { code: 'ENOENT' });
  } finally {
    await ctx.manager.shutdown();
    await ctx.cleanup();
  }
});

test('shallow Figma file outline can inspect full selected frames only while the request is active', async () => {
  const outline = { name: 'Website', document: { id: '0:0', children: [
    { id: '0:1', name: 'Page', children: [{ id: '10:24', name: 'Card frame' }] }
  ] } };
  const frame = { nodes: { '10:24': { document: { id: '10:24', children: [{ name: 'Inspect me' }] } } } };
  const calls = [];
  const ctx = await fixture('hold', {
    token: 'server-only-token',
    reader: (url, { token }) => readFigma(url, {
      token, fetchImpl: async (endpoint) => {
        calls.push(endpoint);
        return new Response(JSON.stringify(endpoint.includes('/nodes?') ? frame : outline));
      }
    })
  });
  try {
    const events = [];
    ctx.manager.on('request', (_, record) => events.push(record));
    const accepted = await ctx.manager.start(ctx.workspace, ctx.repo, {
      feedback: 'Use the selected frame', figmaUrl: 'https://www.figma.com/file/AbC123/Site'
    });
    await waitUntil(async () => Boolean((await fsp.readFile(ctx.callLog, 'utf8').catch(() => null))));
    const call = JSON.parse(await fsp.readFile(ctx.callLog, 'utf8'));
    assert.deepEqual(call.design.data, outline);
    assert.equal((await fsp.stat(call.snapshotPath)).mode & 0o777, 0o400);
    assert.match(call.args.at(-1), /shallow file\/page\/frame outline/);
    assert.match(call.args.at(-1), /curl -G --data-urlencode/);
    await waitUntil(() => ctx.manager.list(ctx.workspace.id)[0]?.output.includes('[redacted]'));
    const { accessKey } = ctx.manager.active.get(ctx.workspace.id).figma;
    const inspected = await ctx.manager.inspectFigma(ctx.workspace.id, accepted.id, accessKey, '10:24');
    assert.deepEqual(inspected.data, frame);
    assert.equal(calls[0], 'https://api.figma.com/v1/files/AbC123?depth=2');
    assert.equal(calls[1], 'https://api.figma.com/v1/files/AbC123/nodes?ids=10%3A24');
    await assert.rejects(ctx.manager.inspectFigma(ctx.workspace.id, accepted.id, 'wrong', '10:24'), { status: 404 });
    await assert.rejects(ctx.manager.inspectFigma(ctx.workspace.id, accepted.id, accessKey, 'bad'), { status: 400 });
    await ctx.manager.shutdown();
    await assert.rejects(fsp.access(call.snapshotPath), { code: 'ENOENT' });
    assert.equal(JSON.stringify(ctx.manager.list(ctx.workspace.id)).includes(accessKey), false);
    assert.equal(JSON.stringify(events).includes(accessKey), false);
    await assert.rejects(ctx.manager.inspectFigma(ctx.workspace.id, accepted.id, accessKey, '10:24'), { status: 404 });
  } finally {
    await ctx.manager.shutdown();
    await ctx.cleanup();
  }
});

test('invalid, missing-credential and denied Figma links reject before accepting or launching an agent', async () => {
  const ctx = await fixture();
  try {
    await assert.rejects(ctx.manager.start(ctx.workspace, ctx.repo, {
      feedback: 'Fix design', figmaUrl: 'https://figma.com/proto/AbC123'
    }), { status: 400 });
    await assert.rejects(ctx.manager.start(ctx.workspace, ctx.repo, {
      feedback: 'Fix design', figmaUrl: 'https://figma.com/design/AbC123'
    }), (error) => error.status === 503 && /FIGMA_ACCESS_TOKEN/.test(error.message));
    ctx.manager.figmaToken = 'private-token';
    ctx.manager.figmaReader = (url, { token }) => readFigma(url, {
      token, fetchImpl: async () => new Response('raw secret not reflected', { status: 403 })
    });
    await assert.rejects(ctx.manager.start(ctx.workspace, ctx.repo, {
      feedback: 'Fix design', figmaUrl: 'https://figma.com/design/AbC123'
    }), (error) => error.status === 403 && !error.message.includes('raw secret'));
    assert.deepEqual(ctx.manager.list(ctx.workspace.id), []);
    await assert.rejects(fsp.access(ctx.callLog), { code: 'ENOENT' });
  } finally {
    await ctx.manager.shutdown();
    await ctx.cleanup();
  }
});

test('selected Figma node exports configured SVG and sized PNG only during its agent run', async () => {
  const frame = { nodes: { '10:24': { document: {
    id: '10:24', name: 'Selection', children: [
      { id: '10:25', name: 'Brand / mark', exportSettings: [{ format: 'SVG', suffix: '-icon', constraint: { type: 'SCALE', value: 1 } }] },
      { id: 'I10:24;20:30', name: 'Photo', absoluteBoundingBox: { width: 100, height: 50 },
        exportSettings: [{ format: 'PNG', suffix: '@2x', constraint: { type: 'WIDTH', value: 200 } }] },
      { id: '10:26', name: 'Private layer' }
    ]
  } } } };
  const exports = [];
  const ctx = await fixture('hold', {
    token: 'server-only-token',
    reader: (url, { token }) => readFigma(url, { token, fetchImpl: async () => new Response(JSON.stringify(frame)) }),
    exporter: async (...args) => { exports.push(args); return { bytes: Buffer.from('exported'), contentType: 'image/svg+xml' }; }
  });
  try {
    const accepted = await ctx.manager.start(ctx.workspace, ctx.repo, {
      feedback: 'Use the icon and photo', figmaUrl: 'https://figma.com/design/AbC123?node-id=10-24'
    });
    await waitUntil(async () => Boolean(await fsp.readFile(ctx.callLog, 'utf8').catch(() => null)));
    const run = ctx.manager.active.get(ctx.workspace.id);
    const key = run.figma.accessKey;
    const id = ctx.workspace.id;
    const svg = await ctx.manager.exportFigma(id, accepted.id, key, '10:25', '0');
    assert.equal(svg.filename, 'Brand-mark-icon.svg');
    assert.deepEqual(svg.bytes, Buffer.from('exported'));
    assert.deepEqual(exports[0].slice(0, 4), ['AbC123', '10:25', 'svg', 1]);
    const png = await ctx.manager.exportFigma(id, accepted.id, key, 'I10:24;20:30', '0');
    assert.equal(png.filename, 'Photo-2x.png');
    assert.deepEqual(exports[1].slice(0, 4), ['AbC123', 'I10:24;20:30', 'png', 2]);
    assert.equal(exports[1][4].token, 'server-only-token');
    await assert.rejects(ctx.manager.exportFigma(id, accepted.id, key, '10:26', '0'), { status: 404 });
    await assert.rejects(ctx.manager.exportFigma(id, accepted.id, key, '99:99', '0'), { status: 404 });
    await assert.rejects(ctx.manager.exportFigma(id, accepted.id, 'wrong-key', '10:25', '0'), { status: 404 });
    await assert.rejects(ctx.manager.exportFigma(id, accepted.id, key, '10:25', '1'), { status: 404 });
    assert.equal(exports.length, 2);
    assert.equal(JSON.stringify(ctx.manager.list(id)).includes(key), false);
    await ctx.manager.shutdown();
    await assert.rejects(ctx.manager.exportFigma(id, accepted.id, key, '10:25', '0'), { status: 404 });
  } finally {
    await ctx.manager.shutdown();
    await ctx.cleanup();
  }
});

test('file-level Figma attachments export only nodes previously inspected from that file', async () => {
  const outline = { document: { id: '0:0', children: [{ id: '0:1', name: 'Page', children: [{ id: '10:24', name: 'Frame' }] }] } };
  const frame = { nodes: { '10:24': { document: { id: '10:24', children: [{
    id: '10:25', name: 'Raster', absoluteBoundingBox: { width: 80, height: 40 },
    exportSettings: [{ format: 'PNG', suffix: '', constraint: { type: 'HEIGHT', value: 80 } }]
  }] } } } };
  const calls = [];
  const ctx = await fixture('hold', {
    token: 'server-only-token',
    reader: (url, { token }) => readFigma(url, {
      token, fetchImpl: async (endpoint) => new Response(JSON.stringify(endpoint.includes('/nodes?') ? frame : outline))
    }),
    exporter: async (...args) => { calls.push(args); return { bytes: Buffer.from('png'), contentType: 'image/png' }; }
  });
  try {
    const accepted = await ctx.manager.start(ctx.workspace, ctx.repo, {
      feedback: 'Use exported raster', figmaUrl: 'https://figma.com/file/AbC123'
    });
    await waitUntil(async () => Boolean(await fsp.readFile(ctx.callLog, 'utf8').catch(() => null)));
    const id = ctx.workspace.id;
    const key = ctx.manager.active.get(id).figma.accessKey;
    await assert.rejects(ctx.manager.exportFigma(id, accepted.id, key, '10:25', '0'), { status: 404 });
    await ctx.manager.inspectFigma(id, accepted.id, key, '10:24');
    const asset = await ctx.manager.exportFigma(id, accepted.id, key, '10:25', '0');
    assert.equal(asset.filename, 'Raster.png');
    assert.equal(calls[0][3], 2);
    assert.equal(calls.length, 1);
  } finally {
    await ctx.manager.shutdown();
    await ctx.cleanup();
  }
});
test('changes made before a nonzero exit remain failed, not a completed request', async () => {
  const ctx = await fixture('fail');
  try {
    await ctx.manager.start(ctx.workspace, ctx.repo, { feedback: 'Change the heading' });
    await ctx.manager.active.get(ctx.workspace.id).done;
    const [request] = ctx.manager.list(ctx.workspace.id);
    assert.equal(request.status, 'failed');
    assert.equal(request.summary, null, 'failed runs must not claim success from a sidecar');
    assert.match(request.error, /code 7/);
    assert.match(request.output, /observed failure/);
    assert.equal(request.result, null);
    assert.equal((await ctx.repo.findWorkspace('main')).dirty, true);
  } finally {
    await ctx.manager.shutdown();
    await ctx.cleanup();
  }
});

test('only one active request per workspace; shutdown stops the child and records interruption', async () => {
  const ctx = await fixture('hold');
  try {
    await ctx.manager.start(ctx.workspace, ctx.repo, { feedback: 'Change the heading' });
    await waitUntil(async () => Boolean((await fsp.readFile(ctx.callLog, 'utf8').catch(() => null))));
    assert.equal(ctx.manager.list(ctx.workspace.id)[0].status, 'running', 'file changes do not imply completion');
    await assert.rejects(ctx.manager.start(ctx.workspace, ctx.repo, { feedback: 'Another change' }), { status: 409 });
    await ctx.manager.shutdown();
    const [request] = ctx.manager.list(ctx.workspace.id);
    assert.equal(request.status, 'failed');
    assert.match(request.error, /server shutdown/);
    assert.equal(request.result, null);
    const restarted = new WorkspaceRequests(ctx.options);
    await restarted.load();
    assert.deepEqual(restarted.list(ctx.workspace.id), [request]);
  } finally {
    await ctx.manager.shutdown();
    await ctx.cleanup();
  }
});

test('time limit terminates a running agent without promoting its changed files to success', async () => {
  const ctx = await fixture('hold');
  ctx.manager.timeoutMs = 300;
  try {
    await ctx.manager.start(ctx.workspace, ctx.repo, { feedback: 'Change the heading' });
    await ctx.manager.active.get(ctx.workspace.id).done;
    const [request] = ctx.manager.list(ctx.workspace.id);
    assert.equal(request.status, 'failed');
    assert.match(request.error, /time limit/);
    assert.equal(request.result, null);
    assert.equal(await fsp.readFile(path.join(ctx.workspace.dir, '.env'), 'utf8'), 'CLIENT_KEY=local\n');
  } finally {
    await ctx.manager.shutdown();
    await ctx.cleanup();
  }
});

test('workspace removal stops active work and removes its persisted record', async () => {
  const ctx = await fixture('hold');
  try {
    await ctx.manager.start(ctx.workspace, ctx.repo, { feedback: 'Change the heading' });
    await waitUntil(async () => Boolean((await fsp.readFile(ctx.callLog, 'utf8').catch(() => null))));
    await ctx.manager.remove(ctx.workspace.id);
    assert.deepEqual(ctx.manager.list(ctx.workspace.id), []);
    await assert.rejects(fsp.access(ctx.manager.file(ctx.workspace.id)));
    await assert.rejects(ctx.manager.start(ctx.workspace, ctx.repo, { feedback: 'Again' }), { status: 409 });
  } finally {
    await ctx.manager.shutdown();
    await ctx.cleanup();
  }
});

test('readiness, branch kind and bounded input reject without launching an agent', async () => {
  const ctx = await fixture();
  try {
    ctx.agent.ready = false;
    await assert.rejects(ctx.manager.start(ctx.workspace, ctx.repo, { feedback: 'Change it' }), { status: 409 });
    ctx.agent.ready = true;
    await assert.rejects(ctx.manager.start({ ...ctx.workspace, kind: 'tag' }, ctx.repo, { feedback: 'Change it' }), { status: 409 });
    for (const body of [
      { feedback: ' ' }, { feedback: 'a'.repeat(4001) },
      { feedback: 'Change it', figmaUrl: 'https://figma.com.evil.test/file/x' },
      { feedback: 'Change it', figmaUrl: 'javascript:alert(1)' },
      { feedback: 'Change it', anchor: Array(10).fill(1) },
      { feedback: 'Change it', anchor: { data: 'x'.repeat(4096) } }
    ]) await assert.rejects(ctx.manager.start(ctx.workspace, ctx.repo, body), { status: 400 });
    assert.deepEqual(ctx.manager.list(ctx.workspace.id), []);
    await assert.rejects(fsp.access(ctx.callLog));
  } finally {
    await ctx.cleanup();
  }
});

test('restart marks in-flight work failed and restores a hidden project .env', async () => {
  const ctx = await fixture();
  try {
    ctx.manager.records.set(ctx.workspace.id, [{
      id: 'pending', workspaceId: ctx.workspace.id, status: 'running', error: null,
      result: null, createdAt: new Date().toISOString(), finishedAt: null
    }]);
    await ctx.manager.persist(ctx.workspace.id);
    await fsp.rename(path.join(ctx.workspace.dir, '.env'), path.join(ctx.workspace.dir, '.env.dialogue-request-hidden'));
    const restarted = new WorkspaceRequests(ctx.options);
    await restarted.load();
    const [request] = restarted.list(ctx.workspace.id);
    assert.equal(request.status, 'failed');
    assert.match(request.error, /interrupted by server restart/);
    assert.ok(request.finishedAt);
    assert.equal(await fsp.readFile(path.join(ctx.workspace.dir, '.env'), 'utf8'), 'CLIENT_KEY=local\n');
    const another = new WorkspaceRequests(ctx.options);
    await another.load();
    assert.deepEqual(another.list(ctx.workspace.id), [request]);
  } finally {
    await ctx.cleanup();
  }
});
