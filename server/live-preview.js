// Live previews of open workspaces: one Runner per workspace (started when
// someone views it, stopped when idle), exposed on its own preview origin by
// PreviewProxy, reported to the workspace page as `runner` events, and
// screenshotted so branch tiles show what the branch really looks like.
// Node builtins only.
const path = require('node:path');

const { parseRecipe } = require('./recipe.js');
const { Runner, RunnerPool } = require('./runner.js');

const FIRST_SHOT_DELAY_MS = 5000;
const SHOT_DEBOUNCE_MS = 30000;

const MESSAGES = {
  installing: 'Installing the project’s dependencies…',
  starting: 'Starting the preview…',
  stopped: 'The preview is stopped.',
  'no-recipe': 'This project has no preview set up yet. Dialogue sets it up after a project is added; see the Projects page.'
};

class LivePreviews {
  constructor({ proxy, previews, stampsRoot, internalPort, idleMs, createRunner = (options) => new Runner(options) }) {
    Object.assign(this, { proxy, previews, stampsRoot, internalPort, createRunner });
    this.pool = new RunnerPool({ idleMs });
    this.entries = new Map(); // workspace id -> entry
  }

  // A viewer opened the workspace. `context`: { slug, ref, dir, repo, isDefault }.
  // `listener(payload)` receives every runner update. Returns a release fn.
  async open(id, context, listener) {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { id, ...context, listeners: new Set(), runner: null, recipeText: null, recipe: null, problem: null, shotTimer: null };
      this.entries.set(id, entry);
      this.proxy.register(id, () => this.resolve(entry));
    }
    entry.listeners.add(listener);
    const stale = !entry.runner || entry.runner !== this.pool.get(id) || entry.runner.state === 'stopped';
    if (stale) await this.load(entry);
    this.pool.acquire(id);
    listener(this.payload(entry));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.listeners.delete(listener);
      this.pool.release(id);
    };
  }

  // Current runner payload for a workspace, without starting anything.
  state(id) {
    const entry = this.entries.get(id);
    return entry ? this.payload(entry) : { state: 'starting', message: MESSAGES.starting };
  }

  // Preview origin for the browser. `headers`: the request's (Host, and
  // X-Forwarded-Proto behind a TLS proxy).
  url(id, headers) {
    this.ensureToken(id);
    return this.proxy.urlFor(id, { headers });
  }

  ensureToken(id) {
    if (this.proxy.tokenFor(id)) return;
    // Registered before the first viewer so the URL is stable from the start.
    const entry = this.entries.get(id);
    this.proxy.register(id, () => (entry ? this.resolve(entry) : { kind: 'pending', title: 'Starting', message: MESSAGES.starting }));
  }

  // Load (or reload) the recipe and (re)start the runner.
  async load(entry, { restarted = false } = {}) {
    const found = await entry.repo.readRecipe(entry.dir).catch(() => null);
    entry.recipeText = found?.text ?? null;
    entry.problem = null;
    entry.restarted = restarted;
    if (!found) {
      entry.recipe = null;
      entry.problem = { state: 'no-recipe', message: MESSAGES['no-recipe'] };
      await this.pool.stop(entry.id);
      entry.runner = null;
      this.broadcast(entry);
      return;
    }
    const parsed = parseRecipe(found.text);
    if (!parsed.ok) {
      entry.recipe = null;
      entry.problem = { state: 'crashed', message: `The preview recipe (.dialogue/preview.json) is invalid: ${parsed.error}` };
      await this.pool.stop(entry.id);
      entry.runner = null;
      this.broadcast(entry);
      return;
    }
    entry.recipe = parsed.recipe;
    const runner = this.createRunner({
      dir: entry.dir,
      recipe: parsed.recipe,
      stampDir: path.join(this.stampsRoot, entry.slug, encodeURIComponent(entry.ref))
    });
    entry.runner = runner;
    this.pool.set(entry.id, runner);
    runner.on('state', (state) => {
      if (entry.runner !== runner) return;
      this.broadcast(entry);
      if (state === 'ready') this.scheduleShot(entry, FIRST_SHOT_DELAY_MS);
    });
    runner.start().catch(() => {}); // failure arrives as a 'crashed' state
  }

  resolve(entry) {
    const runner = entry.runner;
    if (entry.problem) return { kind: 'failed', title: 'No preview', message: entry.problem.message, log: '' };
    if (!runner || runner.state === 'stopped') return { kind: 'pending', title: 'Preview stopped', message: 'Open the workspace in Dialogue to start it again.' };
    if (runner.state === 'ready' && runner.target) return runner.target;
    if (runner.state === 'crashed') return { kind: 'failed', title: 'The preview stopped', message: 'The preview server exited.', log: runner.logTail() };
    return { kind: 'pending', title: 'Starting', message: MESSAGES[runner.state] || MESSAGES.starting };
  }

  payload(entry) {
    const reload = entry.recipe?.reload || 'dialogue';
    if (entry.problem) return { ...entry.problem, reload };
    const runner = entry.runner;
    const state = runner?.state || 'starting';
    const payload = { state, reload, message: MESSAGES[state] || '' };
    if (state === 'crashed') {
      payload.message = 'The preview server stopped. The agent can help: ask it in the terminal, or restart the preview.';
      payload.log = runner.logTail(40);
    }
    if (state === 'ready' && entry.restarted) payload.restarted = true;
    return payload;
  }

  broadcast(entry) {
    const payload = this.payload(entry);
    for (const listener of entry.listeners) listener(payload);
  }

  // Preview setup committed a recipe for a project: workspaces that were
  // opened without one (or follow the default branch's) pick it up.
  async projectRecipeChanged(slug) {
    const ids = [...this.entries.values()].filter((entry) => entry.slug === slug).map((entry) => entry.id);
    await Promise.all(ids.map((id) => this.filesChanged(id)));
  }

  // Files changed in the worktree: a new recipe restarts the preview;
  // anything else refreshes the branch screenshot (debounced).
  async filesChanged(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    const found = await entry.repo.readRecipe(entry.dir).catch(() => null);
    if ((found?.text ?? null) !== entry.recipeText) {
      await this.load(entry, { restarted: true });
      return;
    }
    if (entry.runner?.state === 'ready') this.scheduleShot(entry, SHOT_DEBOUNCE_MS);
  }

  async restart(id) {
    const entry = this.entries.get(id);
    if (entry) await this.load(entry, { restarted: true });
  }

  scheduleShot(entry, delayMs) {
    if (!this.previews.available) return;
    clearTimeout(entry.shotTimer);
    entry.shotTimer = setTimeout(() => {
      entry.shotTimer = null;
      this.shoot(entry).catch((error) => console.error(`Screenshot of ${entry.id} failed: ${error.message}`));
    }, delayMs);
    entry.shotTimer.unref?.();
  }

  // Screenshot through the preview origin on the server's own port, stored
  // under the worktree's HEAD (and as the main image for the default branch).
  async shoot(entry) {
    if (entry.runner?.state !== 'ready') return;
    const sha = await entry.head();
    if (!sha) return;
    const token = this.proxy.tokenFor(entry.id);
    const url = `http://${token}.preview.localhost:${this.internalPort}${entry.recipe.entry}`;
    const files = [this.previews.file(entry.slug, sha)];
    if (entry.isDefault) files.push(this.previews.mainFile(entry.slug));
    await this.previews.capture(url, files);
  }

  async close(id) {
    const entry = this.entries.get(id);
    if (entry) clearTimeout(entry.shotTimer);
    this.entries.delete(id);
    this.proxy.unregister(id);
    await this.pool.stop(id);
  }

  async shutdown() {
    for (const entry of this.entries.values()) clearTimeout(entry.shotTimer);
    await this.pool.stopAll();
  }
}

module.exports = { LivePreviews };
