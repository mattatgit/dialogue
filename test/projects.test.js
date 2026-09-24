const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const projects = require('../server/projects.js');
const { pickPrototypePath } = require('../server/git.js');

test('projectFromUrl derives a stable owner-repo slug from any URL form', () => {
  assert.equal(projects.projectFromUrl('https://github.com/MattAtGit/Landline.git').slug, 'mattatgit-landline');
  assert.equal(projects.projectFromUrl('git@github.com:mattatgit/landline.git').slug, 'mattatgit-landline');
  assert.equal(projects.projectFromUrl('ssh://git@gitlab.com/group/sub/app').slug, 'group-sub-app');
  assert.equal(projects.projectFromUrl('https://github.com/o/my.dotted_repo').slug, 'o-my-dotted-repo');
  assert.throws(() => projects.projectFromUrl('hello world'), /repository address/);
});

test('withNames prefixes the owner only when repo names clash', () => {
  const named = projects.withNames([
    projects.projectFromUrl('https://github.com/alice/app'),
    projects.projectFromUrl('https://github.com/bob/app'),
    projects.projectFromUrl('https://github.com/bob/other')
  ]);
  assert.deepEqual(named.map((p) => p.name), ['alice/app', 'bob/app', 'other']);
  assert.equal(named[0].webUrl, 'https://github.com/alice/app');
});

test('migrate upgrades a schema-2 db without losing projects', () => {
  const v2 = {
    schemaVersion: 2,
    projects: [{ id: 'project-landline', slug: 'landline', name: 'Landline', createdAt: '2026-09-23T04:42:22.077Z', repo: { url: 'https://github.com/mattatgit/landline', prototypePath: 'prototypes/app' } }]
  };
  const v3 = projects.migrate(v2);
  assert.equal(v3.schemaVersion, projects.SCHEMA_VERSION);
  assert.equal(v3.projects.length, 1);
  assert.equal(v3.projects[0].slug, 'mattatgit-landline');
  assert.equal(v3.projects[0].repo.prototypePath, 'prototypes/app');
  assert.equal(v3.projects[0].createdAt, '2026-09-23T04:42:22.077Z');
  assert.deepEqual(projects.migrate(null), { schemaVersion: projects.SCHEMA_VERSION, projects: [] });
});

test('pickPrototypePath prefers prototypes/app, then the shallowest index.html', () => {
  assert.equal(pickPrototypePath(['README.md', 'docs/index.html', 'prototypes/app/index.html']), 'prototypes/app');
  assert.equal(pickPrototypePath(['src/b/index.html', 'src/a/index.html', 'deep/er/x/index.html']), 'src/a');
  assert.equal(pickPrototypePath(['index.html', 'app/index.html']), '');
  assert.equal(pickPrototypePath(['README.md']), null);
});

test('ProjectStore adds, rejects duplicates, seeds idempotently and removes', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dialogue-projects-'));
  const store = new projects.ProjectStore(path.join(dir, 'db.json'));
  await store.add('https://github.com/alice/app');
  await assert.rejects(store.add('git@github.com:alice/app.git'), (e) => e.status === 409);
  await store.seed([{ url: 'https://github.com/alice/app' }, { url: 'https://github.com/bob/app', prototypePath: 'web' }, { url: 'nope' }]);
  await store.seed([{ url: 'https://github.com/bob/app' }]);
  const list = await store.list();
  assert.deepEqual(list.map((p) => p.name), ['alice/app', 'bob/app']);
  assert.equal(list[1].repo.prototypePath, 'web');
  await store.update('alice-app', { prototypePath: 'site' });
  assert.equal((await store.find('alice-app')).repo.prototypePath, 'site');
  await store.remove('alice-app');
  assert.deepEqual((await store.list()).map((p) => p.name), ['app']);
  await fsp.rm(dir, { recursive: true, force: true });
});
