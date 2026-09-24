// Preview setup: after a project is added, the agent (`omp -p`) works out how
// to serve it and writes .dialogue/preview.json; Dialogue then proves the
// recipe by running it and taking a screenshot, feeding failures back to the
// agent. A working recipe is committed on the local default branch and goes
// out with the user's next COMMIT. Jobs run one at a time (installs are
// heavy). Node builtins only.
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { EventEmitter } = require('node:events');

const { RECIPE_PATH, guessStaticRecipe, parseRecipe } = require('./recipe.js');
const { Runner } = require('./runner.js');

const APP_ROOT = path.resolve(__dirname, '..');
const AGENT_TIMEOUT_MS = 10 * 60 * 1000;
const COMMIT_MESSAGE = 'Add Dialogue preview recipe';
const HIDDEN_ENV = '.env.dialogue-hidden';
const LOG_LIMIT = 80;
const GIT_BIN = process.env.DIALOGUE_GIT || 'git';
const execFileAsync = promisify(execFile);

async function trackedFiles(dir) {
  const { stdout } = await execFileAsync(GIT_BIN, ['-C', dir, 'ls-files'], { maxBuffer: 64 * 1024 * 1024 });
  return stdout.split('\n').filter(Boolean);
}

// `git status` entries ("?? path", " M path"), excluding Dialogue's own files.
async function checkoutChanges(dir) {
  const { stdout } = await execFileAsync(GIT_BIN, ['-C', dir, 'status', '--porcelain', '--untracked-files=all'], { maxBuffer: 16 * 1024 * 1024 });
  return new Set(stdout.split('\n').filter((line) => line && !line.slice(3).startsWith('.dialogue/')));
}

// Undo what a run added on top of `before`: new files go, edits revert.
async function revertChanges(dir, entries) {
  for (const entry of entries) {
    const file = entry.slice(3);
    if (entry.startsWith('??')) await fsp.rm(path.join(dir, file), { force: true });
    else await execFileAsync(GIT_BIN, ['-C', dir, 'checkout', '--', file]).catch(() => {});
  }
}

function tail(text, lines = LOG_LIMIT) {
  return String(text || '').trimEnd().split('\n').slice(-lines).join('\n');
}

function describeFailure(failure) {
  const exit = failure.exitCode === null || failure.exitCode === undefined ? '' : ` (exit code ${failure.exitCode})`;
  return `${failure.step} step failed${exit}: ${failure.message}`;
}

// Emits 'ready' (slug) whenever a project's recipe is set up.
class PreviewSetup extends EventEmitter {
  constructor({
    projects, repoFor, agent, previews, screenshot, setupRoot,
    ompBin = process.env.DIALOGUE_OMP || 'omp',
    configPath = path.join(APP_ROOT, 'omp', 'config.yml'),
    promptPath = path.join(APP_ROOT, 'omp', 'preview-setup-prompt.md'),
    env = {},
    maxAttempts = 3,
    createRunner = (options) => new Runner(options)
  }) {
    super();
    Object.assign(this, { projects, repoFor, agent, previews, screenshot, setupRoot, ompBin, configPath, promptPath, env, maxAttempts, createRunner });
    this.queue = Promise.resolve();
    this.pending = new Set(); // "<kind>:<slug>" queued or running
    this.waiting = new Set(); // slugs parked until the agent is ready
    agent.on('ready', () => {
      const slugs = [...this.waiting];
      this.waiting.clear();
      for (const slug of slugs) this.enqueue(slug);
    });
  }

  dir(slug) {
    return path.join(this.setupRoot, slug);
  }

  logFile(slug) {
    return path.join(this.dir(slug), 'log.txt');
  }

  // Resolves once every queued job has finished.
  async idle() {
    let seen;
    do {
      seen = this.queue;
      await seen;
    } while (seen !== this.queue);
  }

  enqueue(slug) {
    this.schedule('setup', slug, () => this.runSetup(slug));
  }

  // Screenshot the default branch's current origin commit if it has no image.
  refresh(slug) {
    this.schedule('refresh', slug, () => this.runRefresh(slug));
  }

  schedule(kind, slug, job) {
    const key = `${kind}:${slug}`;
    if (this.pending.has(key)) return;
    this.pending.add(key);
    this.queue = this.queue
      .then(job)
      .catch((error) => console.error(`Preview ${kind} for ${slug} failed: ${error.stack || error.message}`))
      .finally(() => this.pending.delete(key));
  }

  async log(slug, text) {
    await fsp.appendFile(this.logFile(slug), text.endsWith('\n') ? text : `${text}\n`);
  }

  async runSetup(slug) {
    await this.projects.find(slug); // gone meanwhile → throws, job ends
    await fsp.mkdir(this.dir(slug), { recursive: true });
    await fsp.writeFile(this.logFile(slug), '');
    const repo = await this.repoFor(slug);
    const place = await this.workplace(repo, slug);
    await this.projects.setPreviewSetup(slug, { status: 'running', attempt: 0, error: null, finishedAt: null });

    // A recipe already in the repository gets checked before any agent run.
    let failure = null;
    const existing = await fsp.readFile(path.join(place.dir, RECIPE_PATH), 'utf8').catch(() => null);
    if (existing !== null) {
      await this.log(slug, `== Checking the recipe already in the repository`);
      failure = await this.validate(slug, place.dir);
      if (!failure) return this.succeed(slug, repo, place, 0);
    } else {
      // Plain HTML needs no agent: seconds instead of a model round trip.
      const guess = guessStaticRecipe(await trackedFiles(place.dir));
      if (guess) {
        await this.log(slug, `== Trying plain static files`);
        await fsp.mkdir(path.join(place.dir, path.dirname(RECIPE_PATH)), { recursive: true });
        await fsp.writeFile(path.join(place.dir, RECIPE_PATH), guess);
        if (!(await this.validate(slug, place.dir))) return this.succeed(slug, repo, place, 0);
        await fsp.rm(path.join(place.dir, RECIPE_PATH), { force: true });
      }
    }

    const agentStatus = await this.agent.check();
    if (!agentStatus.ready) return this.park(slug, agentStatus);

    let recipeText = existing;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      await this.projects.setPreviewSetup(slug, { status: 'running', attempt });
      await this.log(slug, `== Attempt ${attempt}: asking the agent`);
      const agentRun = await this.runAgent(slug, place.dir, this.prompt(await this.basePrompt(), failure, recipeText));
      if (agentRun.exitCode !== 0) {
        const recheck = await this.agent.check({ force: true });
        if (!recheck.ready) {
          await this.projects.setPreviewSetup(slug, { attempt: attempt - 1 });
          return this.park(slug, recheck);
        }
        failure = { step: 'agent', exitCode: agentRun.exitCode, message: 'The agent stopped with an error.', log: tail(agentRun.output) };
        continue;
      }
      recipeText = await fsp.readFile(path.join(place.dir, RECIPE_PATH), 'utf8').catch(() => null);
      failure = await this.validate(slug, place.dir);
      if (!failure) return this.succeed(slug, repo, place, attempt);
    }
    await this.projects.setPreviewSetup(slug, { status: 'failed', error: describeFailure(failure), finishedAt: new Date().toISOString() });
  }

  async park(slug, agentStatus) {
    this.waiting.add(slug);
    await this.projects.setPreviewSetup(slug, { status: 'waiting-for-agent', error: agentStatus.detail || agentStatus.reason || 'No AI model connected.' });
  }

  // Where the agent works: the open default-branch workspace (so its branch
  // is not moved underneath it), else a persistent detached setup tree on
  // the local default branch, or origin's when there is no local work.
  async workplace(repo, slug) {
    const name = await repo.defaultBranchName();
    const open = await repo.findWorkspace(name);
    if (open && open.kind === 'branch') return { dir: open.dir, detached: false };
    const local = await repo.localDefault();
    const dir = path.join(this.dir(slug), 'tree');
    await repo.checkoutSetupTree(dir, local || `refs/remotes/origin/${name}`);
    return { dir, detached: true, base: local };
  }

  async basePrompt() {
    return fsp.readFile(this.promptPath, 'utf8');
  }

  prompt(base, failure, recipeText) {
    if (!failure) return base;
    return [
      base,
      'Your previous attempt did not work. Dialogue tried to run it and got:',
      describeFailure(failure),
      recipeText === null ? `No ${RECIPE_PATH} was written.` : `The recipe was:\n${recipeText.trim()}`,
      failure.log ? `Last output:\n${failure.log}` : '',
      'Fix the recipe (or the project) and write it again.'
    ].filter(Boolean).join('\n\n');
  }

  // Runs `omp -p` in `dir` with the client's .env moved aside: omp loads
  // .env from its working directory and a client key there must not
  // override the connected model.
  async runAgent(slug, dir, prompt) {
    const envFile = path.join(dir, '.env');
    const hidden = path.join(dir, HIDDEN_ENV);
    const moved = await fsp.rename(envFile, hidden).then(() => true, () => false);
    try {
      const args = ['-p', '--approval-mode', 'yolo', '--config', this.configPath, ...this.agent.ompArgs(), prompt];
      return await new Promise((resolve) => {
        const child = spawn(this.ompBin, args, {
          cwd: dir,
          env: { ...process.env, ...this.env, ...this.agent.ompEnv() },
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: AGENT_TIMEOUT_MS,
          killSignal: 'SIGKILL'
        });
        let output = '';
        const collect = (chunk) => {
          output += chunk;
          this.log(slug, String(chunk)).catch(() => {});
        };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        child.on('error', (error) => resolve({ exitCode: -1, output: `${output}\n${error.message}` }));
        child.on('close', (code) => resolve({ exitCode: code ?? -1, output }));
      });
    } finally {
      if (moved) await fsp.rename(hidden, envFile).catch(() => {});
    }
  }

  // Run the recipe like a workspace would, screenshot it, stop it. Returns
  // null on success or a failure { step, exitCode, message, log }.
  async validate(slug, dir, shotFile = this.shotFile(slug)) {
    const text = await fsp.readFile(path.join(dir, RECIPE_PATH), 'utf8').catch(() => null);
    if (text === null) return { step: 'recipe', exitCode: null, message: `${RECIPE_PATH} was not written.`, log: '' };
    const parsed = parseRecipe(text);
    if (!parsed.ok) return { step: 'recipe', exitCode: null, message: parsed.error, log: '' };

    // Previews run in every branch checkout, so they must not leave changes
    // there (a generated lockfile would show up as uncommitted work).
    const before = await checkoutChanges(dir);
    const runner = this.createRunner({ dir, recipe: parsed.recipe, stampDir: path.join(this.dir(slug), 'stamps', path.basename(dir)) });
    runner.on('log', (line) => this.log(slug, line).catch(() => {}));
    try {
      await runner.start();
    } catch (error) {
      await runner.stop().catch(() => {});
      return { step: error.step || 'start', exitCode: error.exitCode ?? null, message: error.message, log: error.logTail || runner.logTail() };
    }
    try {
      const added = [...await checkoutChanges(dir)].filter((entry) => !before.has(entry));
      if (added.length) {
        await revertChanges(dir, added);
        return {
          step: 'install',
          exitCode: null,
          message: `Running the preview changed files in the repository (${added.map((entry) => entry.slice(3)).join(', ')}). Install and start may only write git-ignored files, because the preview runs in every branch checkout; for example use \`npm install --no-package-lock\` when there is no lockfile.`,
          log: runner.logTail()
        };
      }
      await fsp.rm(shotFile, { force: true });
      await this.screenshot(runner.target, [shotFile], parsed.recipe.entry);
      return null;
    } catch (error) {
      return { step: 'screenshot', exitCode: null, message: error.message, log: runner.logTail() };
    } finally {
      await runner.stop().catch(() => {});
    }
  }

  shotFile(slug) {
    return path.join(this.dir(slug), 'shot.png');
  }

  async succeed(slug, repo, place, attempt) {
    const base = place.detached ? place.base : null;
    const sha = await repo.commitRecipe(place.dir, COMMIT_MESSAGE);
    if (sha && place.detached) await repo.advanceDefault(sha, base);
    const head = sha || (await repo.localDefault()) || (await repo.defaultBranch())?.sha;
    const origin = (await repo.defaultBranch())?.sha;
    // The recipe commit renders like its parent, so the origin commit the
    // card shows and the local commit share the image. No image (no
    // Chromium): the preview still works, cards show their placeholder.
    const shot = this.shotFile(slug);
    if (await fsp.access(shot).then(() => true, () => false)) {
      const targets = [...new Set([head, origin].filter(Boolean))].map((s) => this.previews.file(slug, s));
      for (const file of [...targets, this.previews.mainFile(slug)]) {
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await fsp.copyFile(shot, file);
      }
    }
    await this.projects.setPreviewSetup(slug, { status: 'ready', attempt, error: null, finishedAt: new Date().toISOString() });
    this.emit('ready', slug);
  }

  async runRefresh(slug) {
    const project = await this.projects.find(slug);
    if (project.previewSetup?.status !== 'ready') return;
    const repo = await this.repoFor(slug);
    const head = await repo.defaultBranch();
    if (!head) return;
    const target = this.previews.file(slug, head.sha);
    if (await fsp.access(target).then(() => true, () => false)) return;

    const dir = path.join(this.dir(slug), 'tree');
    await repo.checkoutSetupTree(dir, head.sha);
    // origin may not carry the recipe yet (unpushed): use the local one.
    const recipe = await repo.readRecipe(dir);
    if (!recipe) return;
    if (recipe.source !== 'workspace') {
      await fsp.mkdir(path.join(dir, path.dirname(RECIPE_PATH)), { recursive: true });
      await fsp.writeFile(path.join(dir, RECIPE_PATH), recipe.text);
    }
    await fsp.mkdir(this.dir(slug), { recursive: true });
    const failure = await this.validate(slug, dir, target);
    if (failure) {
      console.error(`Preview refresh for ${slug} failed: ${describeFailure(failure)}`);
      return;
    }
    await fsp.copyFile(target, this.previews.mainFile(slug));
  }

  async remove(slug) {
    this.waiting.delete(slug);
    await fsp.rm(this.dir(slug), { recursive: true, force: true });
  }
}

module.exports = { PreviewSetup, describeFailure };
