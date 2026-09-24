// Prototype preview screenshots. Each image is a headless-Chromium capture of
// a running preview URL, stored per (project, commit) under
// previews/<slug>/<sha>.png, plus main.png: the latest default-branch image
// shown for branches that have no image of their own yet. Node builtins only.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const WIDTH = 370;
const HEIGHT = 722;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
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
    this.queue = Promise.resolve(); // one Chromium at a time
  }

  get available() {
    return Boolean(this.chromium);
  }

  file(slug, sha) {
    if (!SLUG.test(slug) || !/^[0-9a-f]{40}$/.test(sha)) throw new PreviewError('Invalid preview key.');
    return path.join(this.root, slug, `${sha}.png`);
  }

  mainFile(slug) {
    if (!SLUG.test(slug)) throw new PreviewError('Invalid preview key.');
    return path.join(this.root, slug, 'main.png');
  }

  // The image for a commit, falling back to the latest main image.
  async lookup(slug, sha) {
    for (const [file, exact] of [[this.file(slug, sha), true], [this.mainFile(slug), false]]) {
      if (await fsp.access(file).then(() => true, () => false)) return { file, exact };
    }
    return null;
  }

  // Screenshot `url` once and store it at every path in `files`. Queued so
  // only one Chromium runs at a time.
  capture(url, files) {
    if (!this.chromium) return Promise.reject(new PreviewError('No Chromium available for screenshots.'));
    const job = this.queue.then(() => this.render(url, files));
    this.queue = job.catch(() => {});
    return job;
  }

  async render(url, files) {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dialogue-preview-'));
    try {
      const out = path.join(tmp, 'shot.png');
      await execFileAsync(this.chromium, [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
        `--user-data-dir=${path.join(tmp, 'profile')}`, `--window-size=${WIDTH},${HEIGHT}`, `--screenshot=${out}`,
        '--virtual-time-budget=5000', url
      ], { timeout: RENDER_TIMEOUT_MS, env: { ...process.env, HOME: tmp } });
      for (const file of files) {
        await fsp.mkdir(path.dirname(file), { recursive: true });
        // copy to a sibling then rename: readers never see a half-written file,
        // and tmp may be on another filesystem.
        await fsp.copyFile(out, `${file}.tmp`);
        await fsp.rename(`${file}.tmp`, file);
      }
    } catch (error) {
      throw error instanceof PreviewError ? error : new PreviewError(`Screenshot failed: ${error.message}`);
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
      const match = /^([0-9a-f]{40})\.png$/.exec(name);
      return match && !keep.has(match[1]) ? fsp.rm(path.join(dir, name), { force: true }) : null;
    }));
  }

  async remove(slug) {
    await fsp.rm(path.join(this.root, slug), { recursive: true, force: true });
  }
}

module.exports = { PreviewRenderer, PreviewError, findChromium, WIDTH, HEIGHT };
