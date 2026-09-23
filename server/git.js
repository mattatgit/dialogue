// Git-backed project storage: one bare mirror per project, one worktree per
// opened ref. Node builtins only; shells out to `git`.
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const GIT_BIN = process.env.DIALOGUE_GIT || 'git';
const SEP = '|';
const REF_FORMAT = `%(refname)${SEP}%(objectname)${SEP}%(subject)${SEP}%(creatordate:iso-strict)`;

class GitError extends Error {
  constructor(message, stderr = '') {
    super(message);
    this.stderr = stderr;
  }
}

async function run(args, options = {}) {
  try {
    const { stdout } = await execFileAsync(GIT_BIN, args, {
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
      ...options
    });
    return stdout;
  } catch (error) {
    const stderr = String(error.stderr || '').trim();
    throw new GitError(stderr || error.message, stderr);
  }
}

// --- pure helpers ---------------------------------------------------------

function isValidRefName(name) {
  if (typeof name !== 'string' || !name || name === '@') return false;
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return false;
  if (name.endsWith('.lock') || name.includes('..') || name.includes('//') || name.includes('@{')) return false;
  if (/[\s~^:?*[\\\x00-\x1f\x7f]/.test(name)) return false;
  return name.split('/').every((part) => part && !part.startsWith('.') && !part.endsWith('.lock'));
}

function parseRefs(stdout) {
  const branches = [];
  const tags = [];
  for (const line of String(stdout).split('\n')) {
    if (!line) continue;
    const first = line.indexOf(SEP);
    const second = line.indexOf(SEP, first + 1);
    const last = line.lastIndexOf(SEP);
    if (first < 0 || second < 0 || last <= second) continue;
    const refname = line.slice(0, first);
    const sha = line.slice(first + 1, second);
    const subject = line.slice(second + 1, last);
    const committedAt = line.slice(last + 1);
    const entry = { sha, subject, committedAt };
    if (refname.startsWith('refs/heads/')) branches.push({ name: refname.slice('refs/heads/'.length), ...entry });
    else if (refname.startsWith('refs/tags/')) tags.push({ name: refname.slice('refs/tags/'.length), ...entry });
  }
  return { branches, tags };
}

function workspaceId(slug, ref) {
  return `${slug}/${encodeURIComponent(ref)}`;
}

function parseWorkspaceId(id) {
  if (typeof id !== 'string') return null;
  const parts = id.split('/');
  if (parts.length !== 2) return null;
  const [slug, encoded] = parts;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  let ref;
  try {
    ref = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  if (!isValidRefName(ref)) return null;
  return { slug, ref };
}

function workspaceDir(workspacesRoot, slug, ref) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new GitError(`Invalid project slug: ${slug}`);
  if (!isValidRefName(ref)) throw new GitError(`Invalid ref name: ${ref}`);
  const dir = path.resolve(workspacesRoot, slug, encodeURIComponent(ref));
  if (!dir.startsWith(`${path.resolve(workspacesRoot)}${path.sep}`)) throw new GitError('Unsafe workspace path.');
  return dir;
}

// --- repository operations -------------------------------------------------

class ProjectRepo {
  constructor({ slug, url, reposRoot, workspacesRoot }) {
    this.slug = slug;
    this.url = url;
    this.bareDir = path.join(reposRoot, `${slug}.git`);
    this.workspacesRoot = workspacesRoot;
    this.fetchedAt = 0;
  }

  git(args, options) {
    return run(['-C', this.bareDir, ...args], options);
  }

  async ensure() {
    // git reports worktree paths with symlinks resolved (e.g. systemd's
    // /var/lib/x -> private/x); compare against the same canonical form.
    await fsp.mkdir(this.workspacesRoot, { recursive: true });
    this.workspacesRoot = await fsp.realpath(this.workspacesRoot);
    try {
      await fsp.access(path.join(this.bareDir, 'HEAD'));
      return;
    } catch {
      // fall through: clone
    }
    await fsp.mkdir(path.dirname(this.bareDir), { recursive: true });
    await run(['clone', '--bare', '--quiet', this.url, this.bareDir]);
    // Bare clones do not create a remote-tracking layout by default; make
    // origin/<branch> exist so worktrees can track it.
    await this.git(['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
    await this.git(['fetch', '--quiet', '--prune', 'origin']);
  }

  async fetch() {
    await this.git(['fetch', '--quiet', '--prune', '--prune-tags', 'origin']);
    this.fetchedAt = Date.now();
  }

  async refs() {
    // Remote branches are authoritative; local heads only exist for opened
    // workspaces and mirror them.
    const out = await this.git([
      'for-each-ref', `--format=${REF_FORMAT}`, '--sort=-creatordate',
      'refs/remotes/origin/', 'refs/tags/'
    ]);
    const parsed = parseRefs(out.replace(/^refs\/remotes\/origin\//gm, 'refs/heads/'));
    parsed.branches = parsed.branches.filter((branch) => branch.name !== 'HEAD');
    return parsed;
  }

  async worktrees() {
    let out;
    try {
      out = await this.git(['worktree', 'list', '--porcelain']);
    } catch {
      return [];
    }
    const result = [];
    let current = null;
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ')) {
        current = { dir: line.slice('worktree '.length), head: null, branch: null, detached: false, bare: false };
        result.push(current);
      } else if (!current) continue;
      else if (line.startsWith('HEAD ')) current.head = line.slice(5);
      else if (line.startsWith('branch ')) current.branch = line.slice('branch refs/heads/'.length);
      else if (line === 'detached') current.detached = true;
      else if (line === 'bare') current.bare = true;
    }
    return result.filter((item) => !item.bare);
  }

  async openWorkspaces() {
    const rootPrefix = `${path.join(this.workspacesRoot, this.slug)}${path.sep}`;
    const trees = await this.worktrees();
    return trees
      .filter((tree) => tree.dir.startsWith(rootPrefix))
      .map((tree) => ({ ref: decodeURIComponent(path.basename(tree.dir)), dir: tree.dir, head: tree.head, branch: tree.branch, detached: tree.detached }));
  }

  async resolveRef(ref) {
    const refs = await this.refs();
    const branch = refs.branches.find((item) => item.name === ref);
    if (branch) return { kind: 'branch', sha: branch.sha };
    const tag = refs.tags.find((item) => item.name === ref);
    if (tag) return { kind: 'tag', sha: (await this.git(['rev-parse', `${ref}^{commit}`])).trim() };
    if (/^[0-9a-f]{7,40}$/.test(ref)) {
      try {
        return { kind: 'commit', sha: (await this.git(['rev-parse', '--verify', `${ref}^{commit}`])).trim() };
      } catch {
        return null;
      }
    }
    return null;
  }

  async ensureWorkspace(ref) {
    const dir = workspaceDir(this.workspacesRoot, this.slug, ref);
    const existing = (await this.openWorkspaces()).find((item) => item.dir === dir);
    if (existing) return this.describeWorkspace(ref, existing);

    const target = await this.resolveRef(ref);
    if (!target) throw new GitError(`Unknown ref: ${ref}`);

    await fsp.mkdir(path.dirname(dir), { recursive: true });
    if (target.kind === 'branch') {
      const hasLocal = await this.git(['show-ref', '--verify', '--quiet', `refs/heads/${ref}`]).then(() => true, () => false);
      if (hasLocal) await this.git(['worktree', 'add', '--quiet', dir, ref]);
      else await this.git(['worktree', 'add', '--quiet', '--track', '-b', ref, dir, `origin/${ref}`]);
    } else {
      await this.git(['worktree', 'add', '--quiet', '--detach', dir, target.sha]);
    }
    const tree = (await this.openWorkspaces()).find((item) => item.dir === dir);
    return this.describeWorkspace(ref, tree);
  }

  async removeWorkspace(ref) {
    const dir = workspaceDir(this.workspacesRoot, this.slug, ref);
    await this.git(['worktree', 'remove', '--force', dir]);
    await this.git(['worktree', 'prune']);
  }

  async describeWorkspace(ref, tree) {
    if (!tree) throw new GitError(`Workspace not found: ${ref}`);
    const [subject, status] = await Promise.all([
      run(['-C', tree.dir, 'log', '-1', '--format=%s']).then((s) => s.trim(), () => ''),
      run(['-C', tree.dir, 'status', '--porcelain', '--untracked-files=normal']).then((s) => s.trim(), () => '')
    ]);
    let kind = 'commit';
    if (tree.branch) kind = 'branch';
    else if (await this.git(['show-ref', '--verify', '--quiet', `refs/tags/${ref}`]).then(() => true, () => false)) kind = 'tag';
    return {
      id: workspaceId(this.slug, ref),
      ref,
      kind,
      dir: tree.dir,
      head: { sha: tree.head, subject },
      dirty: status.length > 0
    };
  }

  async findWorkspace(ref) {
    const dir = workspaceDir(this.workspacesRoot, this.slug, ref);
    const tree = (await this.openWorkspaces()).find((item) => item.dir === dir);
    return tree ? this.describeWorkspace(ref, tree) : null;
  }
}

module.exports = {
  GitError,
  ProjectRepo,
  isValidRefName,
  parseRefs,
  parseWorkspaceId,
  workspaceDir,
  workspaceId
};
