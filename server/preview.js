// Prototype preview screenshots, one PNG per (project, commit). Rendered on
// demand with headless Chromium from a `git archive` export of the prototype
// directory, cached under previews/<slug>/<sha>.png. Node builtins only.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const WIDTH = 370;
const HEIGHT = 722;
const RENDER_TIMEOUT_MS = 20000;

class PreviewError extends Error {}

function findChromium() {
  const candidates = [process.env.DIALOGUE_CHROMIUM, process.env.PUPPETEER_EXECUTABLE_PATH].filter(Boolean);
  for (const candidate of candidates) return candidate;
  const names = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome'];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const name of names) {
      const full = path.join(dir, name);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {
        // keep looking
      }
    }
  }
  for (const mac of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']) {
    try {
      fs.accessSync(mac, fs.constants.X_OK);
      return mac;
    } catch {
      // not installed
    }
  }
  return null;
}

class PreviewRenderer {
  constructor(root) {
    this.root = root;
    this.chromium = findChromium();
    this.failed = new Set(); // "<slug>/<sha>" that failed this process lifetime
    this.pending = new Map(); // key → promise, dedupes concurrent requests
    this.queue = Promise.resolve(); // one Chromium at a time
  }

  get available() {
    return Boolean(this.chromium);
  }

  file(slug, sha) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug) || !/^[0-9a-f]{40}$/.test(sha)) throw new PreviewError('Invalid preview key.');
    return path.join(this.root, slug, `${sha}.png`);
  }

  // Resolves to the PNG path, or null when no preview can be made.
  async get(repo, sha, prototypePath) {
    const target = this.file(repo.slug, sha);
    if (await fsp.access(target).then(() => true, () => false)) return target;
    const key = `${repo.slug}/${sha}`;
    if (!this.chromium || this.failed.has(key)) return null;
    if (!this.pending.has(key)) {
      const job = this.queue
        .then(() => this.render(repo, sha, prototypePath, target))
        .then(() => target, (error) => {
          console.error(`Preview ${key} failed: ${error.message}`);
          this.failed.add(key);
          return null;
        })
        .finally(() => this.pending.delete(key));
      this.queue = job.catch(() => {});
      this.pending.set(key, job);
    }
    return this.pending.get(key);
  }

  async render(repo, sha, prototypePath, target) {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dialogue-preview-'));
    try {
      const treeish = prototypePath ? `${sha}:${prototypePath}` : sha;
      // git archive → tar; avoids a worktree for a one-off read.
      const archive = spawn(process.env.DIALOGUE_GIT || 'git', ['-C', repo.bareDir, 'archive', '--format=tar', treeish], { stdio: ['ignore', 'pipe', 'pipe'] });
      const untar = spawn('tar', ['-x', '-C', tmp], { stdio: ['pipe', 'ignore', 'pipe'] });
      archive.stdout.pipe(untar.stdin);
      let archiveErr = '';
      archive.stderr.on('data', (d) => { archiveErr += d; });
      await Promise.all([
        new Promise((resolve, reject) => archive.on('exit', (code) => (code === 0 ? resolve() : reject(new PreviewError(archiveErr.trim() || `git archive exited ${code}`))))),
        new Promise((resolve, reject) => untar.on('exit', (code) => (code === 0 ? resolve() : reject(new PreviewError(`tar exited ${code}`)))))
      ]);
      const entry = path.join(tmp, 'index.html');
      if (!(await fsp.stat(entry).then((s) => s.isFile(), () => false))) throw new PreviewError('No index.html in the prototype directory.');
      const out = path.join(tmp, 'shot.png');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const profile = path.join(tmp, 'profile');
      await execFileAsync(this.chromium, [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
        `--user-data-dir=${profile}`, `--window-size=${WIDTH},${HEIGHT}`, `--screenshot=${out}`,
        '--virtual-time-budget=3000', `file://${entry}`
      ], { timeout: RENDER_TIMEOUT_MS, env: { ...process.env, HOME: tmp } });
      // copy, not rename: tmp and the data dir may be different filesystems
      await fsp.copyFile(out, target);
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  }

  // Drop cached previews for commits no longer referenced.
  async prune(slug, liveShas) {
    const dir = path.join(this.root, slug);
    let entries = [];
    try {
      entries = await fsp.readdir(dir);
    } catch {
      return;
    }
    const keep = new Set(liveShas);
    await Promise.all(entries.map((name) => {
      const sha = name.replace(/\.png$/, '');
      return keep.has(sha) ? null : fsp.rm(path.join(dir, name), { force: true });
    }));
  }

  async remove(slug) {
    await fsp.rm(path.join(this.root, slug), { recursive: true, force: true });
  }
}

module.exports = { PreviewRenderer, PreviewError, findChromium, WIDTH, HEIGHT };
