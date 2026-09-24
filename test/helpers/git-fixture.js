// Throwaway origin repositories for tests: a real non-bare repo with commits,
// plus a ProjectRepo mirroring it into temp dirs.
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { ProjectRepo } = require('../../server/git.js');

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' };

function sh(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { env: ENV, encoding: 'utf8' }).trim();
}

// files: { 'path/in/repo': 'content' }. Returns the new commit sha.
async function commit(dir, files, message = 'change') {
  for (const [name, content] of Object.entries(files)) {
    await fsp.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fsp.writeFile(path.join(dir, name), content);
  }
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', message);
  return sh(dir, 'rev-parse', 'HEAD');
}

async function makeProject(files = { 'index.html': '<h1>hi</h1>' }) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dialogue-git-'));
  const origin = path.join(root, 'origin');
  await fsp.mkdir(origin);
  sh(origin, 'init', '-q', '-b', 'main');
  await commit(origin, files, 'initial');
  const repo = new ProjectRepo({ slug: 'o-app', url: origin, reposRoot: path.join(root, 'repos'), workspacesRoot: path.join(root, 'workspaces') });
  await repo.ensure();
  return { root, origin, repo, cleanup: () => fsp.rm(root, { recursive: true, force: true }) };
}

module.exports = { ENV, commit, makeProject, sh };
