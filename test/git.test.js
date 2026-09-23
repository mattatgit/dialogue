const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const git = require('../server/git.js');

test('parseRefs splits branches and tags, skips HEAD symref', () => {
  const out = [
    'refs/heads/main|d68f55dee00f2cf67f5511985ca5c68d332fdeb0|Initial|2026-09-01T10:00:00+00:00',
    'refs/heads/feature/macos-add-user|1485941132ccacbadee5de46e00ad0c3e513f141|Add user|2026-09-02T10:00:00+00:00',
    'refs/tags/v1.0|3756e1ef863592ac7cf6064f9c723aca507e844a|Release|2026-09-03T10:00:00+00:00',
    'refs/remotes/origin/HEAD|d68f55dee00f2cf67f5511985ca5c68d332fdeb0|Initial|2026-09-01T10:00:00+00:00'
  ].join('\n');
  const refs = git.parseRefs(out);
  assert.deepEqual(refs.branches.map((b) => b.name), ['main', 'feature/macos-add-user']);
  assert.deepEqual(refs.tags.map((t) => t.name), ['v1.0']);
  assert.equal(refs.branches[1].sha, '1485941132ccacbadee5de46e00ad0c3e513f141');
  assert.equal(refs.branches[1].subject, 'Add user');
  assert.equal(refs.tags[0].committedAt, '2026-09-03T10:00:00+00:00');
});

test('parseRefs tolerates subjects containing the separator', () => {
  const refs = git.parseRefs('refs/heads/x|abc|a | b | c|2026-01-01T00:00:00+00:00');
  assert.equal(refs.branches[0].subject, 'a | b | c');
});

test('workspace ids round-trip slashes in ref names', () => {
  const id = git.workspaceId('landline', 'feature/macos-add-user');
  assert.equal(id, 'landline/feature%2Fmacos-add-user');
  assert.deepEqual(git.parseWorkspaceId(id), { slug: 'landline', ref: 'feature/macos-add-user' });
});

test('parseWorkspaceId rejects traversal and malformed ids', () => {
  for (const bad of ['landline', 'landline/..', 'landline/%2E%2E', '../x/main', 'a/b/c', 'landline/', '/main']) {
    assert.equal(git.parseWorkspaceId(bad), null, bad);
  }
});

test('workspaceDir stays inside the workspaces root', () => {
  const root = path.resolve('/data');
  const dir = git.workspaceDir(root, 'landline', 'feature/x');
  assert.equal(dir, path.join(root, 'landline', 'feature%2Fx'));
  assert.throws(() => git.workspaceDir(root, 'landline', '../../etc'));
  assert.throws(() => git.workspaceDir(root, '..', 'main'));
});

test('isValidRefName follows git-check-ref-format basics', () => {
  assert.ok(git.isValidRefName('main'));
  assert.ok(git.isValidRefName('feature/macos-add-user'));
  assert.ok(git.isValidRefName('v1.0'));
  for (const bad of ['', '-x', 'a..b', 'a/', '/a', 'a.lock', 'a b', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', 'a//b', '@', 'a@{b']) {
    assert.equal(git.isValidRefName(bad), false, JSON.stringify(bad));
  }
});
