const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { makeProject, sh } = require('./helpers/git-fixture.js');
const { WorkspaceRequests } = require('../server/requests.js');

async function fixture() {
  const ctx = await makeProject({ 'index.html': 'original', '.gitignore': '.env\nsecret.txt\n' });
  ctx.repo.pushUrl = ctx.origin;
  sh(ctx.origin, 'config', 'receive.denyCurrentBranch', 'ignore');
  const workspace = await ctx.repo.ensureWorkspace('main');
  const bin = path.join(ctx.root, 'fake-omp');
  await fsp.writeFile(bin, `#!/usr/bin/env node
const fs = require('node:fs');
if (process.env.FAKE_CONTENT !== 'noop') fs.writeFileSync('index.html', process.env.FAKE_CONTENT);
fs.writeFileSync('.env', 'never publish me');
fs.writeFileSync('secret.txt', 'never publish me either');
`, { mode: 0o755 });
  const options = { root: path.join(ctx.root, 'requests'), workspacesRoot: path.join(ctx.root, 'workspaces'),
    agent: { model: 'fake', async check() { return { ready: true }; }, ompEnv() { return {}; } },
    ompBin: bin, configPath: path.join(ctx.root, 'config'), env: { FAKE_CONTENT: 'first' } };
  const requests = new WorkspaceRequests(options);
  await requests.load();
  return { ...ctx, workspace, requests, options };
}

async function comment(ctx, feedback) {
  await ctx.requests.start(ctx.workspace, ctx.repo, { feedback });
  await ctx.requests.active.get(ctx.workspace.id).done;
  return ctx.requests.list(ctx.workspace.id).at(-1);
}

test('Edited snapshots stay immutable, private, reopenable, and preserve staging', async () => {
  const ctx = await fixture();
  try {
    await fsp.writeFile(path.join(ctx.workspace.dir, 'staged.txt'), 'staged');
    sh(ctx.workspace.dir, 'add', 'staged.txt');
    const indexBefore = sh(ctx.workspace.dir, 'ls-files', '--stage');
    const first = await comment(ctx, 'first comment');
    assert.match(first.snapshotSha, /^[a-f0-9]{40}$/);
    assert.equal(sh(ctx.workspace.dir, 'ls-files', '--stage'), indexBefore);
    assert.equal(sh(ctx.repo.bareDir, 'show', `${first.snapshotSha}:index.html`), 'first');
    assert.equal(sh(ctx.repo.bareDir, 'show', `${first.snapshotSha}:staged.txt`), 'staged');
    assert.equal(sh(ctx.repo.bareDir, 'ls-tree', '-r', '--name-only', first.snapshotSha).includes('.env'), false);
    ctx.options.env.FAKE_CONTENT = 'second';
    const second = await comment(ctx, 'second comment');
    assert.notEqual(second.snapshotSha, first.snapshotSha);
    assert.equal(sh(ctx.repo.bareDir, 'show', `${first.snapshotSha}:index.html`), 'first');
    assert.equal(sh(ctx.repo.bareDir, 'show', `${second.snapshotSha}:index.html`), 'second');
    const reopened = await ctx.repo.ensureWorkspace(first.snapshotSha);
    assert.equal(reopened.kind, 'commit');
    assert.equal(await fsp.readFile(path.join(reopened.dir, 'index.html'), 'utf8'), 'first');
    const reloaded = new WorkspaceRequests(ctx.options);
    await reloaded.load();
    assert.deepEqual(reloaded.edits(ctx.workspace.id).map((edit) => edit.sha), [second.snapshotSha, first.snapshotSha]);
    assert.equal(reloaded.edits(ctx.workspace.id)[0].feedback, 'second comment');
    assert.equal((await ctx.repo.versionState(ctx.workspace)).versions.length, 0);
    await ctx.repo.removeWorkspace('main');
    assert.equal(sh(ctx.repo.bareDir, 'for-each-ref', '--format=%(refname)', 'refs/dialogue/edits/main'), '');
  } finally {
    await ctx.requests.shutdown();
    await ctx.cleanup();
  }
});

test('failed atomic push retains pending draft without a Version; retry publishes numbered commits only', async () => {
  const ctx = await fixture();
  try {
    await comment(ctx, 'change');
    const hook = path.join(ctx.origin, '.git', 'hooks', 'pre-receive');
    await fsp.writeFile(hook, '#!/bin/sh\necho rejected >&2\nexit 1\n', { mode: 0o755 });
    await assert.rejects(ctx.requests.saveVersion(ctx.workspace, ctx.repo), /rejected/);
    let state = await ctx.repo.versionState(ctx.workspace);
    assert.equal(state.versions.length, 0);
    assert.equal(state.draft.canSave, true);
    assert.match(state.draft.pending, /^[a-f0-9]{40}$/);
    assert.equal(sh(ctx.origin, 'tag', '--list'), '');
    await fsp.rm(hook);
    const restarted = new WorkspaceRequests(ctx.options);
    await restarted.load();
    const first = await restarted.saveVersion(ctx.workspace, ctx.repo);
    assert.equal(first.label, 'V1');
    assert.equal(first.sha, state.draft.pending);
    assert.equal(sh(ctx.origin, 'rev-parse', 'refs/tags/dialogue/main/V1'), first.sha);
    assert.deepEqual((await ctx.repo.refs()).tags, [], 'published Version tags stay out of project tag tiles');
    assert.equal(sh(ctx.origin, 'rev-parse', 'refs/heads/main'), first.sha);
    assert.equal(sh(ctx.origin, 'for-each-ref', '--format=%(refname)', 'refs/dialogue/edits'), '');
    assert.equal((await ctx.repo.versionState(ctx.workspace)).draft.canSave, false);
    await assert.rejects(ctx.requests.saveVersion(ctx.workspace, ctx.repo), /Nothing new/);
    ctx.options.env.FAKE_CONTENT = 'second';
    await comment(ctx, 'another change');
    const second = await ctx.requests.saveVersion(ctx.workspace, ctx.repo);
    assert.equal(second.label, 'V2');
    assert.equal((await ctx.repo.versionState(ctx.workspace)).versions.length, 2);
  } finally {
    await ctx.requests.shutdown();
    await ctx.cleanup();
  }
});

test('retry after a failed push publishes the current Draft, not stale pending bytes', async () => {
  const ctx = await fixture();
  try {
    await comment(ctx, 'first change');
    const hook = path.join(ctx.origin, '.git', 'hooks', 'pre-receive');
    await fsp.writeFile(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    await assert.rejects(ctx.requests.saveVersion(ctx.workspace, ctx.repo));
    const pending = (await ctx.repo.versionState(ctx.workspace)).draft.pending;
    await fsp.writeFile(path.join(ctx.workspace.dir, 'index.html'), 'newest');
    await fsp.rm(hook);
    const version = await ctx.requests.saveVersion(ctx.workspace, ctx.repo);
    assert.notEqual(version.sha, pending);
    assert.equal(sh(ctx.origin, 'show', 'refs/heads/main:index.html'), 'newest');
    assert.equal(sh(ctx.origin, 'rev-parse', 'refs/tags/dialogue/main/V1'), version.sha);
  } finally {
    await ctx.requests.shutdown();
    await ctx.cleanup();
  }
});

test('successful no-change comment is an execution record, never an Edited snapshot', async () => {
  const ctx = await fixture();
  try {
    ctx.options.env.FAKE_CONTENT = 'noop';
    const request = await comment(ctx, 'inspect only');
    assert.equal(request.status, 'completed');
    assert.equal(request.snapshotSha, undefined);
    assert.deepEqual(ctx.requests.edits(ctx.workspace.id), []);
    assert.equal((await ctx.repo.versionState(ctx.workspace)).draft.canSave, false);
  } finally {
    await ctx.requests.shutdown();
    await ctx.cleanup();
  }
});

test('branch-scoped Version numbering and edit cleanup leave other branches alone', async () => {
  const ctx = await fixture();
  try {
    sh(ctx.origin, 'branch', 'feature/one', 'main');
    await ctx.repo.fetch();
    const child = await ctx.repo.ensureWorkspace('feature/one');
    const first = await comment(ctx, 'main edit');
    ctx.options.env.FAKE_CONTENT = 'child edit';
    await ctx.requests.start(child, ctx.repo, { feedback: 'child edit' });
    await ctx.requests.active.get(child.id).done;
    const childEdit = ctx.requests.edits(child.id)[0];
    assert.match(childEdit.sha, /^[0-9a-f]{40}$/);
    assert.equal((await ctx.requests.saveVersion(ctx.workspace, ctx.repo)).label, 'V1');
    assert.equal((await ctx.requests.saveVersion(child, ctx.repo)).label, 'V1');
    assert.notEqual(sh(ctx.origin, 'rev-parse', 'refs/tags/dialogue/main/V1'), sh(ctx.origin, 'rev-parse', 'refs/tags/dialogue/feature/one/V1'));
    await ctx.repo.removeWorkspace('main');
    assert.equal(sh(ctx.repo.bareDir, 'for-each-ref', '--format=%(refname)', `refs/dialogue/edits/main/${first.id}`), '');
    assert.equal(sh(ctx.repo.bareDir, 'rev-parse', `refs/dialogue/edits/feature/one/${childEdit.requestId}`), childEdit.sha);
  } finally {
    await ctx.requests.shutdown();
    await ctx.cleanup();
  }
});

test('tracked environment files retain their published content, never current secrets', async () => {
  const ctx = await makeProject({ 'index.html': 'initial', '.env': 'published old value' });
  try {
    await fsp.writeFile(path.join(ctx.origin, '.gitignore'), '.env\n');
    sh(ctx.origin, 'add', '.gitignore');
    sh(ctx.origin, 'commit', '-qm', 'Ignore future environment files');
    await ctx.repo.fetch();
    const workspace = await ctx.repo.ensureWorkspace('main');
    await fsp.writeFile(path.join(workspace.dir, '.env'), 'new secret');
    await fsp.writeFile(path.join(workspace.dir, 'index.html'), 'new page');
    const beforeIndex = sh(workspace.dir, 'ls-files', '--stage');
    const tree = await ctx.repo.draftTree(workspace);
    assert.equal(sh(ctx.repo.bareDir, 'show', `${tree}:.env`), 'published old value');
    assert.equal(sh(ctx.repo.bareDir, 'show', `${tree}:index.html`), 'new page');
    assert.equal(sh(workspace.dir, 'ls-files', '--stage'), beforeIndex);
  } finally {
    await ctx.cleanup();
  }
});
