const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { commit, makeProject, sh } = require('./helpers/git-fixture.js');

const RECIPE = '{"version":1,"kind":"static"}\n';
test('the clone-time local default branch does not count as local work, and opening it catches up with origin', async () => {
  const { origin, repo, cleanup } = await makeProject();
  try {
    assert.equal(await repo.localDefault(), null);
    const newer = await commit(origin, { 'index.html': 'v2' });
    await repo.fetch();
    assert.equal(await repo.localDefault(), null);
    const main = await repo.ensureWorkspace('main');
    assert.equal(main.head.sha, newer);
    assert.equal(main.ahead, 0);
  } finally {
    await cleanup();
  }
});

test('readRecipe prefers the worktree file, then the local default branch, then origin', async () => {
  const { origin, repo, root, cleanup } = await makeProject();
  try {
    assert.equal(await repo.readRecipe(), null);

    await commit(origin, { '.dialogue/preview.json': RECIPE }, 'recipe');
    await repo.fetch();
    assert.deepEqual(await repo.readRecipe(), { text: RECIPE, source: 'default' });

    // A local default branch ahead of origin wins over origin.
    const tree = path.join(root, 'setup');
    await repo.checkoutSetupTree(tree, 'refs/remotes/origin/main');
    await fsp.writeFile(path.join(tree, '.dialogue/preview.json'), '{"version":1,"kind":"static","root":"x"}\n');
    const sha = await repo.commitRecipe(tree, 'Update recipe');
    await repo.advanceDefault(sha, null);
    assert.match((await repo.readRecipe()).text, /"root":"x"/);

    // A workspace's own file (even uncommitted) wins over the default branch.
    const feature = await repo.ensureWorkspace('main');
    await fsp.writeFile(path.join(feature.dir, '.dialogue/preview.json'), '{"version":1,"kind":"static","root":"mine"}');
    assert.deepEqual(await repo.readRecipe(feature.dir), { text: '{"version":1,"kind":"static","root":"mine"}', source: 'workspace' });
  } finally {
    await cleanup();
  }
});

test('workspace without its own recipe falls back to the default branch', async () => {
  const { origin, repo, cleanup } = await makeProject();
  try {
    sh(origin, 'checkout', '-q', '-b', 'feature');
    await commit(origin, { 'a.txt': 'a' });
    sh(origin, 'checkout', '-q', 'main');
    await commit(origin, { '.dialogue/preview.json': RECIPE }, 'recipe');
    await repo.fetch();
    const feature = await repo.ensureWorkspace('feature');
    assert.deepEqual(await repo.readRecipe(feature.dir), { text: RECIPE, source: 'default' });
  } finally {
    await cleanup();
  }
});

test('commitRecipe commits only the recipe and returns null when unchanged', async () => {
  const { repo, root, cleanup } = await makeProject();
  try {
    const tree = path.join(root, 'setup');
    await repo.checkoutSetupTree(tree, 'refs/remotes/origin/main');
    await fsp.mkdir(path.join(tree, '.dialogue'));
    await fsp.writeFile(path.join(tree, '.dialogue/preview.json'), RECIPE);
    await fsp.writeFile(path.join(tree, 'stray.txt'), 'agent scratch');
    const sha = await repo.commitRecipe(tree, 'Add Dialogue preview recipe');
    assert.match(sha, /^[0-9a-f]{40}$/);
    assert.equal(sh(tree, 'show', '--name-only', '--format=%s', sha), 'Add Dialogue preview recipe\n\n.dialogue/preview.json');
    assert.equal(await repo.commitRecipe(tree, 'again'), null);
  } finally {
    await cleanup();
  }
});

test('advanceDefault creates or fast-moves the local default branch with an upstream, refusing a moved branch', async () => {
  const { repo, root, cleanup } = await makeProject();
  try {
    const tree = path.join(root, 'setup');
    await repo.checkoutSetupTree(tree, 'refs/remotes/origin/main');
    await fsp.mkdir(path.join(tree, '.dialogue'));
    await fsp.writeFile(path.join(tree, '.dialogue/preview.json'), RECIPE);
    const first = await repo.commitRecipe(tree, 'one');
    await repo.advanceDefault(first, null);
    assert.equal(await repo.localDefault(), first);
    assert.equal(sh(repo.bareDir, 'config', 'branch.main.merge'), 'refs/heads/main');

    await fsp.writeFile(path.join(tree, '.dialogue/preview.json'), '{"version":1,"kind":"static","root":"b"}');
    const second = await repo.commitRecipe(tree, 'two');
    await assert.rejects(repo.advanceDefault(second, null));
    await repo.advanceDefault(second, first);
    assert.equal(await repo.localDefault(), second);

    // The opened default-branch workspace then shows it as one to push.
    const main = await repo.ensureWorkspace('main');
    assert.equal(main.ahead, 2);
  } finally {
    await cleanup();
  }
});

test('checkoutSetupTree reuses the tree and keeps ignored files across checkouts', async () => {
  const { origin, repo, root, cleanup } = await makeProject({ 'index.html': 'v1', '.gitignore': 'node_modules/\n' });
  try {
    const tree = path.join(root, 'setup');
    await repo.checkoutSetupTree(tree, 'refs/remotes/origin/main');
    await fsp.mkdir(path.join(tree, 'node_modules'));
    await fsp.writeFile(path.join(tree, 'node_modules/dep.js'), 'kept');
    await fsp.writeFile(path.join(tree, 'untracked.txt'), 'gone');
    await commit(origin, { 'index.html': 'v2' });
    await repo.fetch();
    await repo.checkoutSetupTree(tree, 'refs/remotes/origin/main');
    assert.equal(await fsp.readFile(path.join(tree, 'index.html'), 'utf8'), 'v2');
    assert.equal(await fsp.readFile(path.join(tree, 'node_modules/dep.js'), 'utf8'), 'kept');
    await assert.rejects(fsp.access(path.join(tree, 'untracked.txt')));
    assert.deepEqual(await repo.openWorkspaces(), [], 'setup tree is not a workspace');
  } finally {
    await cleanup();
  }
});

test('watchRoots skips ignored and dot directories so node_modules is never watched', async () => {
  const { repo, cleanup } = await makeProject({ 'index.html': 'x', 'src/app.js': 'x', '.gitignore': 'node_modules/\ndist/\n' });
  try {
    const workspace = await repo.ensureWorkspace('main');
    await fsp.mkdir(path.join(workspace.dir, 'node_modules/pkg'), { recursive: true });
    await fsp.mkdir(path.join(workspace.dir, 'dist'));
    await fsp.mkdir(path.join(workspace.dir, '.dialogue'));
    const roots = await repo.watchRoots(workspace);
    const files = roots.filter((root) => root.files).map((root) => [path.relative(workspace.dir, root.path), root.recursive]);
    assert.deepEqual(files.sort(), [['', false], ['.dialogue', true], ['src', true]]);
    assert.ok(roots.some((root) => !root.files && root.path.endsWith(path.join('refs', 'remotes'))));
  } finally {
    await cleanup();
  }
});
