const test = require('node:test');
const assert = require('node:assert/strict');

const dk = require('../server/deploy-key.js');

test('pushUrl turns hosting URLs into the SSH form', () => {
  assert.equal(dk.pushUrl('https://github.com/mattatgit/landline'), 'git@github.com:mattatgit/landline.git');
  assert.equal(dk.pushUrl('https://github.com/mattatgit/landline.git'), 'git@github.com:mattatgit/landline.git');
  assert.equal(dk.pushUrl('https://github.com/mattatgit/landline/'), 'git@github.com:mattatgit/landline.git');
  assert.equal(dk.pushUrl('https://gitlab.com/group/sub/project'), 'git@gitlab.com:group/sub/project.git');
  assert.equal(dk.pushUrl('https://git.example.com:8443/team/repo'), 'ssh://git@git.example.com:8443/team/repo.git');
  assert.equal(dk.pushUrl('git@github.com:a/b.git'), 'git@github.com:a/b.git');
  assert.equal(dk.pushUrl('not a url'), null);
});

test('hostingSetup points at the deploy-key page per host', () => {
  assert.equal(dk.hostingSetup('https://github.com/a/b').settingsUrl, 'https://github.com/a/b/settings/keys/new');
  assert.equal(dk.hostingSetup('https://gitlab.com/a/b').kind, 'gitlab');
  assert.equal(dk.hostingSetup('https://codeberg.org/a/b').kind, 'gitea');
  assert.equal(dk.hostingSetup('https://git.example.com/a/b').kind, 'generic');
});

test('sshCommand is safe for paths with spaces and quotes', () => {
  const cmd = dk.sshCommand("/data/it's here/key", '/data/known_hosts');
  assert.match(cmd, /-i '\/data\/it'\\''s here\/key'/);
  assert.match(cmd, /IdentitiesOnly=yes/);
  assert.match(cmd, /BatchMode=yes/);
});

test('classifyPushError separates missing key from other failures', () => {
  assert.equal(dk.classifyPushError('git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.'), 'key');
  assert.equal(dk.classifyPushError('ERROR: Repository not found.'), 'repo');
  assert.equal(dk.classifyPushError('ssh: Could not resolve hostname github.com'), 'network');
  assert.equal(dk.classifyPushError('something else'), 'unknown');
});
