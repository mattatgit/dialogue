const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const projects = require('../server/projects.js');

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
  const migrated = projects.migrate(v2);
  assert.equal(migrated.schemaVersion, projects.SCHEMA_VERSION);
  assert.equal(migrated.projects.length, 1);
  assert.equal(migrated.projects[0].slug, 'mattatgit-landline');
  assert.equal(migrated.projects[0].createdAt, '2026-09-23T04:42:22.077Z');
  assert.deepEqual(projects.migrate(null), { schemaVersion: projects.SCHEMA_VERSION, projects: [] });
});

test('migrate from schema 3 drops prototypePath and queues preview setup', () => {
  const v3 = {
    schemaVersion: 3,
    projects: [{ slug: 'alice-app', createdAt: '2026-09-23T04:42:22.077Z', repo: { url: 'https://github.com/alice/app', host: 'github.com', owner: 'alice', repo: 'app', prototypePath: 'web' } }]
  };
  const [project] = projects.migrate(v3).projects;
  assert.equal('prototypePath' in project.repo, false);
  assert.equal(project.createdAt, '2026-09-23T04:42:22.077Z');
  assert.deepEqual(project.previewSetup, { status: 'queued', attempt: 0, error: null, finishedAt: null });
});

test('ProjectStore adds, rejects duplicates, seeds idempotently and removes', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dialogue-projects-'));
  const store = new projects.ProjectStore(path.join(dir, 'db.json'));
  const added = await store.add('https://github.com/alice/app');
  assert.equal(added.previewSetup.status, 'queued');
  await assert.rejects(store.add('git@github.com:alice/app.git'), (e) => e.status === 409);
  await store.seed([{ url: 'https://github.com/alice/app' }, { url: 'https://github.com/bob/app' }, { url: 'nope' }]);
  await store.seed([{ url: 'https://github.com/bob/app' }]);
  assert.deepEqual((await store.list()).map((p) => p.name), ['alice/app', 'bob/app']);
  await store.remove('alice-app');
  assert.deepEqual((await store.list()).map((p) => p.name), ['app']);
  await fsp.rm(dir, { recursive: true, force: true });
});

test('setPreviewSetup merges into the stored status and survives reload', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dialogue-projects-'));
  const dbPath = path.join(dir, 'db.json');
  const store = new projects.ProjectStore(dbPath);
  await store.add('https://github.com/alice/app');
  await store.setPreviewSetup('alice-app', { status: 'running', attempt: 1 });
  const reloaded = await new projects.ProjectStore(dbPath).find('alice-app');
  assert.deepEqual(reloaded.previewSetup, { status: 'running', attempt: 1, error: null, finishedAt: null });
  await assert.rejects(store.setPreviewSetup('nobody', { status: 'ready' }), (e) => e.status === 404);
  await fsp.rm(dir, { recursive: true, force: true });
});
