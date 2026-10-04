// Git-backed project storage: one bare mirror per project, one worktree per
// opened ref. Node builtins only; shells out to `git`.
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { classifyPushError } = require('./deploy-key.js');
const { RECIPE_PATH } = require('./recipe.js');

const execFileAsync = promisify(execFile);
const GIT_BIN = process.env.DIALOGUE_GIT || 'git';
const SEP = '|';
const REF_FORMAT = `%(refname)${SEP}%(objectname)${SEP}%(subject)${SEP}%(creatordate:iso-strict)`;
const PUSH_CHECK_TTL_MS = 60 * 1000;

class GitError extends Error {
  constructor(message, stderr = '') {
    super(message);
    this.stderr = stderr;
  }
}

async function run(args, options = {}) {
  try {
    const { env, ...rest } = options;
    const { stdout } = await execFileAsync(GIT_BIN, args, {
      maxBuffer: 16 * 1024 * 1024,
      // Never prompt: no terminal, no askpass helper (a private repository
      // over anonymous HTTPS must fail fast so the UI can suggest SSH).
      ...rest,
      env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true', SSH_ASKPASS: '', SSH_ASKPASS_REQUIRE: 'never', LC_ALL: 'C' }
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
  constructor({ slug, url, pushUrl = null, sshCommand = null, reposRoot, workspacesRoot }) {
    this.slug = slug;
    this.url = url;
    this.pushUrl = pushUrl;
    this.sshCommand = sshCommand;
    this.bareDir = path.join(reposRoot, `${slug}.git`);
    this.workspacesRoot = workspacesRoot;
    this.fetchedAt = 0;
    this.pushCheckedAt = 0;
  }

  git(args, options) {
    return run(['-C', this.bareDir, ...args], options);
  }

  async ensure() {
    // git reports worktree paths with symlinks resolved (e.g. systemd's
    // /var/lib/x -> private/x); compare against the same canonical form.
    await fsp.mkdir(this.workspacesRoot, { recursive: true });
    this.workspacesRoot = await fsp.realpath(this.workspacesRoot);
    const cloned = await fsp.access(path.join(this.bareDir, 'HEAD')).then(() => true, () => false);
    if (!cloned) {
      await fsp.mkdir(path.dirname(this.bareDir), { recursive: true });
      // An SSH clone URL needs the deploy key from the very first contact.
      const sshConfig = this.sshCommand ? ['-c', `core.sshCommand=${this.sshCommand}`] : [];
      await run([...sshConfig, 'clone', '--bare', '--quiet', this.url, this.bareDir], { timeout: 120000 });
      // Bare clones do not create a remote-tracking layout by default; make
      // origin/<branch> exist so worktrees can track it.
      await this.git(['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
      if (this.sshCommand) await this.git(['config', 'core.sshCommand', this.sshCommand]);
      await this.git(['fetch', '--quiet', '--prune', 'origin']);
    }
    // Fetch over HTTPS, push over SSH with the project's deploy key. Set on
    // every start so existing mirrors pick the settings up; worktrees share
    // the bare repo's config.
    if (this.pushUrl) await this.git(['config', 'remote.origin.pushurl', this.pushUrl]);
    else await this.git(['config', '--unset-all', 'remote.origin.pushurl']).catch(() => {});
    if (this.sshCommand) await this.git(['config', 'core.sshCommand', this.sshCommand]);
    else await this.git(['config', '--unset-all', 'core.sshCommand']).catch(() => {});
    // Commits made by the agent need an identity; on a fresh VM home there
    // is no global one. Only fill the gap at repo level.
    const hasIdentity = await this.git(['config', '--get', 'user.email']).then(() => true, () => false);
    if (!hasIdentity) {
      await this.git(['config', 'user.name', 'Dialogue']);
      await this.git(['config', 'user.email', `dialogue-${this.slug}@localhost`]);
    }
  }

  // The preview recipe for a workspace: its own file (committed or not)
  // wins; otherwise the default branch's, local first because the setup
  // pipeline commits there before anything is pushed.
  async readRecipe(dir = null) {
    if (dir) {
      const text = await fsp.readFile(path.join(dir, RECIPE_PATH), 'utf8').catch(() => null);
      if (text !== null) return { text, source: 'workspace' };
    }
    const name = await this.defaultBranchName();
    const local = await this.localDefault();
    for (const ref of [local, `refs/remotes/origin/${name}`].filter(Boolean)) {
      const text = await this.git(['show', `${ref}:${RECIPE_PATH}`]).catch(() => null);
      if (text !== null) return { text, source: 'default' };
    }
    return null;
  }

  async defaultBranchName() {
    const ref = (await this.git(['symbolic-ref', '--quiet', 'HEAD']).catch(() => '')).trim();
    return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : 'main';
  }

  // Sha of the local default branch when it carries commits origin lacks
  // (e.g. the unpushed recipe commit). A bare clone leaves a clone-time
  // copy of every branch in refs/heads; that stale copy is not local work.
  async localDefault() {
    const name = await this.defaultBranchName();
    const sha = await this.localBranchSha(name);
    if (!sha) return null;
    const unique = await this.git(['rev-list', '--count', `refs/remotes/origin/${name}..${sha}`]).then((s) => Number(s.trim()), () => 1);
    return unique > 0 ? sha : null;
  }

  async localBranchSha(name) {
    return (await this.git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}^{commit}`]).catch(() => '')).trim() || null;
  }

  // A detached worktree outside the workspaces root, kept between runs so
  // ignored files (node_modules) survive and repeat installs are cheap.
  async checkoutSetupTree(dir, rev) {
    // git lists worktrees by real path (macOS: /tmp is /private/tmp).
    const real = await fsp.realpath(dir).catch(() => dir);
    const known = (await this.worktrees()).some((tree) => tree.dir === real);
    if (!known) {
      await fsp.rm(dir, { recursive: true, force: true });
      await this.git(['worktree', 'prune']);
      await fsp.mkdir(path.dirname(dir), { recursive: true });
      await this.git(['worktree', 'add', '--quiet', '--force', '--detach', dir, rev]);
      return;
    }
    await run(['-C', dir, 'checkout', '--quiet', '--force', '--detach', rev]);
    await run(['-C', dir, 'clean', '-fdq']);
  }

  // Commit just the recipe file in `dir`. Returns the new sha, or null when
  // the file matches HEAD.
  async commitRecipe(dir, message) {
    await run(['-C', dir, 'add', '--', RECIPE_PATH]);
    const unchanged = await run(['-C', dir, 'diff', '--cached', '--quiet', 'HEAD', '--', RECIPE_PATH]).then(() => true, () => false);
    if (unchanged) return null;
    await run(['-C', dir, 'commit', '--quiet', '--no-verify', '-m', message, '--', RECIPE_PATH]);
    return (await run(['-C', dir, 'rev-parse', 'HEAD'])).trim();
  }

  // Point the local default branch at `sha`, only if it is still at
  // `expected` (null: no local work yet), and track origin so the next
  // COMMIT pushes it.
  async advanceDefault(sha, expected) {
    const name = await this.defaultBranchName();
    let old = expected;
    if (!old) {
      if (await this.localDefault()) throw new GitError(`The local ${name} branch has moved; not overwriting it.`);
      old = (await this.localBranchSha(name)) || '0'.repeat(40);
    }
    await this.git(['update-ref', `refs/heads/${name}`, sha, old]);
    await this.git(['config', `branch.${name}.remote`, 'origin']);
    await this.git(['config', `branch.${name}.merge`, `refs/heads/${name}`]);
  }

  // Name and current remote sha of the default branch (bare HEAD symref).
  async defaultBranch() {
    const name = await this.defaultBranchName();
    const sha = (await this.git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${name}^{commit}`]).catch(() => '')).trim();
    return sha ? { name, sha } : null;
  }

  // Remove every worktree and the mirror itself.
  async destroy() {
    for (const tree of await this.openWorkspaces()) {
      await this.git(['worktree', 'remove', '--force', tree.dir]).catch(() => {});
    }
    await fsp.rm(path.join(this.workspacesRoot, this.slug), { recursive: true, force: true });
    await fsp.rm(this.bareDir, { recursive: true, force: true });
  }

  async fetch() {
    await this.git(['fetch', '--quiet', '--prune', '--prune-tags', 'origin']);
    this.fetchedAt = Date.now();
  }

  // Can this repo push? Talks to the push URL with the deploy key. A success
  // is cached for a minute; failures are always re-checked.
  async checkPush() {
    if (!this.pushUrl) return { ok: false, reason: 'unknown', message: 'No push URL configured.' };
    if (Date.now() - this.pushCheckedAt < PUSH_CHECK_TTL_MS) return { ok: true };
    try {
      await this.git(['ls-remote', this.pushUrl, 'HEAD'], { timeout: 20000 });
    } catch (error) {
      return { ok: false, reason: classifyPushError(error.stderr || error.message), message: error.message };
    }
    this.pushCheckedAt = Date.now();
    return { ok: true };
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
    parsed.tags = parsed.tags.filter((tag) => !tag.name.startsWith('dialogue/'));
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
      const local = await this.localBranchSha(ref);
      if (local) {
        // A local branch with nothing origin lacks (clone-time copy, or
        // already pushed) is fast-forwarded so the workspace starts current.
        const unique = await this.git(['rev-list', '--count', `origin/${ref}..${local}`]).then((s) => Number(s.trim()), () => 1);
        if (!unique) await this.git(['update-ref', `refs/heads/${ref}`, target.sha, local]);
        await this.git(['worktree', 'add', '--quiet', dir, ref]);
        // A local branch left by an earlier workspace may lack its upstream;
        // `ahead` and the agent's push both rely on it.
        await run(['-C', dir, 'branch', '--quiet', `--set-upstream-to=origin/${ref}`]).catch(() => {});
      }
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
    await this.removeEdits(ref);
  }

  async describeWorkspace(ref, tree) {
    if (!tree) throw new GitError(`Workspace not found: ${ref}`);
    const [subject, status, ahead] = await Promise.all([
      run(['-C', tree.dir, 'log', '-1', '--format=%s']).then((s) => s.trim(), () => ''),
      run(['-C', tree.dir, 'status', '--porcelain', '--untracked-files=normal']).then((s) => s.trim(), () => ''),
      // Commits not yet on the tracked remote branch; 0 without an upstream.
      tree.branch
        ? run(['-C', tree.dir, 'rev-list', '--count', '@{upstream}..HEAD']).then((s) => Number(s.trim()) || 0, () => 0)
        : Promise.resolve(0)
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
      dirty: status.length > 0,
      ahead
    };
  }

  // Build a complete checkout tree using a disposable index. Never stage into
  // the user's index, and never copy ignored files or project .env secrets.
  async draftTree(workspace) {
    const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dialogue-index-'));
    try {
      const env = { GIT_INDEX_FILE: path.join(temp, 'index') };
      const git = (args) => run(['-C', workspace.dir, ...args], { env });
      await git(['read-tree', 'HEAD']);
      // Keep any already-published tracked .env at its HEAD content, but do
      // not stage its current contents (or any new .env anywhere).
      await git(['add', '-A', '--', '.', ':(exclude,glob)**/.env*']);
      return (await git(['write-tree'])).trim();
    } finally {
      await fsp.rm(temp, { recursive: true, force: true });
    }
  }

  editRef(branch, requestId) {
    return `refs/dialogue/edits/${branch}/${requestId}`;
  }

  async snapshotEdit(workspace, requestId, beforeTree) {
    const tree = await this.draftTree(workspace);
    if (tree === beforeTree) return null;
    const head = (await run(['-C', workspace.dir, 'rev-parse', 'HEAD'])).trim();
    const sha = (await this.git(['commit-tree', tree, '-p', head, '-m', `Dialogue edit ${requestId}`])).trim();
    await this.git(['update-ref', this.editRef(workspace.ref, requestId), sha, '0'.repeat(40)]);
    return sha;
  }

  async removeEdits(branch) {
    const prefix = `refs/dialogue/edits/${branch}/`;
    const refs = (await this.git(['for-each-ref', '--format=%(refname)', prefix])).trim().split('\n')
      .filter((ref) => /^[0-9a-f-]{36}$/.test(ref.slice(prefix.length)));
    for (const ref of refs) await this.git(['update-ref', '-d', ref]);
    await this.git(['update-ref', '-d', `refs/dialogue/pending/${branch}`]).catch(() => {});
  }

  async versionState(workspace) {
    const branch = workspace.ref;
    const tagPrefix = `refs/tags/dialogue/${branch}/`;
    const out = await this.git(['for-each-ref', '--format=%(refname)|%(objectname)|%(creatordate:iso-strict)', tagPrefix]);
    const versions = out.trim().split('\n').flatMap((line) => {
      const [ref, sha, createdAt] = line.split('|');
      const match = new RegExp(`^${tagPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}V([1-9]\\d*)$`).exec(ref);
      return match ? [{ label: `V${match[1]}`, sha, createdAt }] : [];
    }).sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1)));
    const pending = (await this.git(['rev-parse', '--verify', '--quiet', `refs/dialogue/pending/${branch}^{commit}`]).catch(() => '')).trim() || null;
    const head = (await run(['-C', workspace.dir, 'rev-parse', 'HEAD'])).trim();
    const tree = await this.draftTree(workspace);
    const headTree = (await this.git(['rev-parse', `${head}^{tree}`])).trim();
    const remote = (await this.git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}^{commit}`]).catch(() => '')).trim();
    const ahead = Number((await this.git(['rev-list', '--count', `${remote || head}..${head}`])).trim());
    return { draft: { head, dirty: tree !== headTree, ahead, canSave: Boolean(pending || tree !== headTree || ahead), ...(pending ? { pending } : {}) }, versions };
  }

  // A private pending ref is the durable retry record. Only publish the local
  // numbered tag after an atomic remote push of *explicit* commit/tag refspecs.
  async publishVersion(workspace) {
    const branch = workspace.ref;
    const pendingRef = `refs/dialogue/pending/${branch}`;
    const state = await this.versionState(workspace);
    if (!state.draft.canSave) throw new GitError('Nothing new in the Draft to save.');
    const number = state.versions.length ? Math.max(...state.versions.map((v) => Number(v.label.slice(1)))) + 1 : 1;
    const label = `V${number}`;
    const tagRef = `refs/tags/dialogue/${branch}/${label}`;
    const head = state.draft.head;
    let sha = state.draft.pending;
    if (!sha) {
      const tree = await this.draftTree(workspace);
      sha = tree === (await this.git(['rev-parse', `${head}^{tree}`])).trim()
        ? head
        : (await this.git(['commit-tree', tree, '-p', head, '-m', `Dialogue ${label}`])).trim();
      await this.git(['update-ref', pendingRef, sha, '0'.repeat(40)]);
    }
    const destination = this.pushUrl || this.url;
    // Query the real destination on retry: a lost response may follow a
    // successful push. Never emit a false version from a local pending ref.
    const remoteRefs = await this.git(['ls-remote', destination, `refs/heads/${branch}`, tagRef], { timeout: 20000 });
    const remote = new Map(remoteRefs.trim().split('\n').filter(Boolean).map((line) => line.split(/\s+/).reverse()));
    const remoteHead = remote.get(`refs/heads/${branch}`);
    const remoteTag = remote.get(tagRef);
    if (remoteTag && (remoteTag !== sha || remoteHead !== sha)) throw new GitError(`Remote ${label} conflicts with the pending Draft.`);
    // A failed push can be retried after more local edits. If the remote did
    // not receive the tag, replace the pending commit with today's Draft.
    // A verified remote tag, by contrast, must finish its original save.
    if (state.draft.pending && !remoteTag) {
      const tree = await this.draftTree(workspace);
      const pendingTree = (await this.git(['rev-parse', `${sha}^{tree}`])).trim();
      if (tree !== pendingTree) {
        if (remoteHead && remoteHead !== head) throw new GitError('The remote branch moved; the Draft was not overwritten.');
        sha = tree === (await this.git(['rev-parse', `${head}^{tree}`])).trim()
          ? head
          : (await this.git(['commit-tree', tree, '-p', head, '-m', `Dialogue ${label}`])).trim();
        await this.git(['update-ref', pendingRef, sha, state.draft.pending]);
      }
    }
    if (remoteHead !== sha || remoteTag !== sha) {
      if (remoteHead && remoteHead !== head) throw new GitError('The remote branch moved; the Draft was not overwritten.');
      await this.git(['push', '--atomic', `--force-with-lease=refs/heads/${branch}:${remoteHead || ''}`, destination,
        `${sha}:refs/heads/${branch}`, `${sha}:${tagRef}`], { timeout: 120000 });
    }
    // A successful atomic push (or a verified earlier success) is the only
    // point at which a Version becomes visible locally.
    await this.git(['update-ref', tagRef, sha, '0'.repeat(40)]);
    await this.git(['update-ref', `refs/remotes/origin/${branch}`, sha]);
    if (sha !== head) {
      await this.git(['update-ref', `refs/heads/${branch}`, sha, head]);
      await run(['-C', workspace.dir, 'reset', '--mixed', '-q', sha]);
    }
    await this.git(['update-ref', '-d', pendingRef]);
    return { label, sha, createdAt: (await this.git(['for-each-ref', '--format=%(creatordate:iso-strict)', tagRef])).trim() };
  }

  // What to watch for a workspace. `files` roots are the project's own files
  // (a change may mean the preview reloads); the others only move
  // head/dirty/ahead. Ignored and dot directories are skipped so a
  // recursive watch never walks node_modules or build output; `.dialogue`
  // stays so a rewritten recipe is noticed.
  async watchRoots(workspace) {
    const gitDir = (await run(['-C', workspace.dir, 'rev-parse', '--absolute-git-dir'])).trim();
    const entries = await fsp.readdir(workspace.dir, { withFileTypes: true }).catch(() => []);
    const dirs = entries
      .filter((entry) => entry.isDirectory() && (entry.name === '.dialogue' || !entry.name.startsWith('.')))
      .map((entry) => entry.name);
    let ignored = new Set();
    if (dirs.length) {
      const out = await run(['-C', workspace.dir, 'check-ignore', '--', ...dirs.map((name) => `${name}/`)]).catch((error) => error.stdout || '');
      ignored = new Set(String(out).split('\n').filter(Boolean).map((line) => line.replace(/\/$/, '')));
    }
    return [
      { path: workspace.dir, recursive: false, files: true },
      ...dirs.filter((name) => !ignored.has(name)).map((name) => ({ path: path.join(workspace.dir, name), recursive: true, files: true })),
      { path: gitDir, recursive: true, files: false },
      { path: path.join(this.bareDir, 'refs', 'remotes'), recursive: true, files: false }
    ];
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
