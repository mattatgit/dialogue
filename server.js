const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { createHash } = require('node:crypto');

const git = require('./server/git.js');
const { DeployKeys, classifyPushError, hostingSetup, pushUrl } = require('./server/deploy-key.js');
const { ProjectError, ProjectStore } = require('./server/projects.js');
const { TerminalManager, TerminalError } = require('./server/terminal.js');
const { WatchRegistry } = require('./server/watch.js');
const { PreviewRenderer } = require('./server/preview.js');
const { PreviewProxy } = require('./server/preview-proxy.js');
const { LivePreviews } = require('./server/live-preview.js');
const { PreviewSetup } = require('./server/setup.js');
const { AgentAuth, AgentAuthError } = require('./server/agent-auth.js');
const { parseRecipe } = require('./server/recipe.js');

const ROOT = __dirname;
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const DATA_ROOT = path.resolve(process.env.DIALOGUE_DATA || path.join(ROOT, '.dialogue-data'));
const DB_PATH = path.join(DATA_ROOT, 'db.json');
const REPOS_ROOT = path.join(DATA_ROOT, 'repos');
const WORKSPACES_ROOT = path.join(DATA_ROOT, 'workspaces');
const KEYS_ROOT = path.join(DATA_ROOT, 'keys');
const PREVIEWS_ROOT = path.join(DATA_ROOT, 'previews');
const SETUP_ROOT = path.join(DATA_ROOT, 'setup');
const STAMPS_ROOT = path.join(DATA_ROOT, 'stamps');
const COMMIT_PROMPT_PATH = path.join(ROOT, 'omp', 'commit-prompt.md');
const FIX_PROMPT_PATH = path.join(ROOT, 'omp', 'preview-fix-prompt.md');
const SETUP_PROMPT_PATH = path.join(ROOT, 'omp', 'preview-setup-prompt.md');
// Preview origins normally use the port the browser reached Dialogue on;
// the dev script sets this because browser-sync rewrites the Host header.
const PREVIEW_PORT = process.env.DIALOGUE_PREVIEW_PORT || null;
const SEED_PATH = process.env.DIALOGUE_SEED ? path.resolve(process.env.DIALOGUE_SEED) : null;
const FETCH_TTL_MS = 10 * 1000;
const MAX_BODY_BYTES = 64 * 1024;

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/plain; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm']
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const agentAuth = new AgentAuth({ dataRoot: DATA_ROOT, appRoot: ROOT });
const terminals = new TerminalManager({ appRoot: ROOT, agentAuth });
// Open terminals keep the model they started with; new connections pick up
// the new one because attach.sh rotates the tmux session on changed args.
agentAuth.on('model', () => terminals.stopAll());
const watchers = new WatchRegistry();
const deployKeys = new DeployKeys(KEYS_ROOT);
const previews = new PreviewRenderer(PREVIEWS_ROOT);
const proxy = new PreviewProxy();
const live = new LivePreviews({ proxy, previews, stampsRoot: STAMPS_ROOT, internalPort: PORT });
const repos = new Map();
const fixFailures = new Map(); // slug -> setup error handed to "Fix with agent"

// --- data -------------------------------------------------------------------

const projects = new ProjectStore(DB_PATH);

// Setup screenshots go through a temporary preview origin so they render
// exactly like the workspace preview will.
async function screenshotTarget(target, files, entry = '/') {
  if (!previews.available) return;
  const id = `setup:${files[0]}`;
  const token = proxy.register(id, () => target);
  try {
    await previews.capture(`http://${token}.preview.localhost:${PORT}${entry}`, files);
  } finally {
    proxy.unregister(id);
  }
}

const setup = new PreviewSetup({
  projects,
  repoFor: async (slug) => repoFor(await findProject(slug)),
  agent: agentAuth,
  previews,
  screenshot: screenshotTarget,
  setupRoot: SETUP_ROOT,
  promptPath: SETUP_PROMPT_PATH
});
setup.on('ready', (slug) => live.projectRecipeChanged(slug).catch((error) => console.error(error)));

async function ensureData() {
  await fsp.mkdir(DATA_ROOT, { recursive: true });
  await fsp.mkdir(REPOS_ROOT, { recursive: true });
  await fsp.mkdir(WORKSPACES_ROOT, { recursive: true });
  await projects.load();
  if (SEED_PATH) {
    let entries = [];
    try {
      entries = JSON.parse(await fsp.readFile(SEED_PATH, 'utf8'));
    } catch (error) {
      console.error(`Could not read DIALOGUE_SEED ${SEED_PATH}: ${error.message}`);
    }
    if (Array.isArray(entries)) await projects.seed(entries);
  }
}

async function findProject(slug) {
  try {
    return await projects.find(slug);
  } catch (error) {
    if (error instanceof ProjectError) throw new HttpError(error.status, error.message);
    throw error;
  }
}

// The connect-panel payload for a project whose deploy key the host rejects.
function setupFor(project, repo, detail) {
  return { slug: project.slug, publicKey: repo.publicKey, repository: `${project.repo.owner}/${project.repo.repo}`, ...hostingSetup(project.repo.url), detail };
}

class CloneError extends HttpError {
  constructor(project, repo, reason, message) {
    super(502, message);
    this.reason = reason;
    this.setup = reason === 'key' && repo.publicKey ? setupFor(project, repo, message) : null;
  }
}

async function repoFor(project) {
  let repo = repos.get(project.slug);
  if (!repo) {
    repo = new git.ProjectRepo({
      slug: project.slug,
      url: project.repo.url,
      pushUrl: pushUrl(project.repo.url),
      reposRoot: REPOS_ROOT,
      workspacesRoot: WORKSPACES_ROOT
    });
    repo.ready = (async () => {
      // Key generation is local and cheap; a failed host-key scan (offline)
      // must not block browsing, so it only disables pushing for now.
      try {
        const key = await deployKeys.ensure(project.slug, project.repo.url);
        repo.sshCommand = key.sshCommand;
        repo.publicKey = key.publicKey;
      } catch (error) {
        console.error(`Deploy key for ${project.slug} unavailable: ${error.message}`);
        repo.pushUrl = null;
      }
      await repo.ensure();
    })();
    repos.set(project.slug, repo);
  }
  try {
    await repo.ready;
  } catch (error) {
    repos.delete(project.slug);
    const stderr = error.stderr || error.message || '';
    throw new CloneError(project, repo, classifyPushError(stderr), stderr.trim() || 'Could not clone the repository.');
  }
  return repo;
}

// Drop the in-memory repo and everything on disk for a project.
async function discardRepo(project) {
  const repo = repos.get(project.slug);
  repos.delete(project.slug);
  const instance = repo || new git.ProjectRepo({ slug: project.slug, url: project.repo.url, reposRoot: REPOS_ROOT, workspacesRoot: WORKSPACES_ROOT });
  for (const workspace of await instance.openWorkspaces().catch(() => [])) {
    const id = git.workspaceId(project.slug, workspace.ref);
    terminals.stop(id);
    watchers.drop(id);
    await live.close(id);
  }
  await instance.destroy();
  await setup.remove(project.slug);
  await deployKeys.remove(project.slug);
  await previews.remove(project.slug);
}

// Screenshot URL for a commit; the route falls back to the latest main image.
function previewUrl(project, sha) {
  if (!previews.available || !sha) return null;
  return `/api/projects/${encodeURIComponent(project.slug)}/preview/${sha}.png`;
}

// Default-branch preview for a project card. Only consults mirrors that
// already exist so listing never triggers a clone. A default branch that
// moved since its last screenshot gets a background refresh.
async function withPreview(project) {
  const cloned = await fsp.access(path.join(REPOS_ROOT, `${project.slug}.git`, 'HEAD')).then(() => true, () => false);
  if (!cloned) return { ...project, previewUrl: null };
  try {
    const repo = await repoFor(project);
    const head = await repo.defaultBranch();
    const shot = head && previews.available ? await previews.lookup(project.slug, head.sha) : null;
    if (head && previews.available && !shot?.exact && project.previewSetup?.status === 'ready') setup.refresh(project.slug);
    return { ...project, defaultBranch: head?.name || null, previewUrl: shot ? previewUrl(project, head.sha) : null };
  } catch {
    return { ...project, previewUrl: null };
  }
}

async function fetchIfStale(repo) {
  if (Date.now() - repo.fetchedAt < FETCH_TTL_MS) return null;
  try {
    await repo.fetch();
    return null;
  } catch (error) {
    return error.message || 'Fetch failed.';
  }
}

// `headers`: the request's, so the preview origin matches how the browser
// reached Dialogue.
async function publicWorkspace(project, repo, workspace, headers) {
  const found = await repo.readRecipe(workspace.dir).catch(() => null);
  const parsed = found ? parseRecipe(found.text) : null;
  const entry = parsed?.ok ? parsed.recipe.entry : '/';
  const origin = live.url(workspace.id, PREVIEW_PORT ? { ...headers, host: `localhost:${PREVIEW_PORT}` } : headers);
  return {
    id: workspace.id,
    project: { slug: project.slug, name: project.name, previewSetup: project.previewSetup },
    ref: workspace.ref,
    kind: workspace.kind,
    head: workspace.head,
    dirty: workspace.dirty,
    ahead: workspace.ahead,
    terminal: workspace.kind === 'branch',
    viewerUrl: `workspace.html?id=${encodeURIComponent(workspace.id)}`,
    previewUrl: `${origin.replace(/\/$/, '')}${entry}`,
    runner: live.state(workspace.id)
  };
}

async function resolveWorkspace(id) {
  const parsed = git.parseWorkspaceId(id);
  if (!parsed) throw new HttpError(404, 'Workspace not found.');
  const project = await findProject(parsed.slug);
  const repo = await repoFor(project);
  const workspace = await repo.findWorkspace(parsed.ref);
  if (!workspace) throw new HttpError(404, 'Workspace not found.');
  return { project, repo, workspace };
}

// --- http helpers -------------------------------------------------------------

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store'
  });
  res.end(text);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON body.');
  }
}

function streamFile(res, absolute, stat, extraHeaders = {}) {
  const contentType = MIME_TYPES.get(path.extname(absolute).toLowerCase()) || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  fs.createReadStream(absolute).pipe(res);
}

// --- file serving ----------------------------------------------------------------

async function serveAppFile(res, pathname) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  } catch {
    throw new HttpError(400, 'Invalid URL.');
  }

  const segments = relativePath.split('/').filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === '..' || segment.startsWith('.'))) {
    throw new HttpError(404, 'Not found.');
  }

  const top = segments[0];
  const isAllowedDirectory = ['assets', 'css', 'js'].includes(top);
  const isAllowedPage = segments.length === 1 && top.endsWith('.html');
  if (!isAllowedDirectory && !isAllowedPage) throw new HttpError(404, 'Not found.');

  const absolute = path.resolve(ROOT, ...segments);
  if (!absolute.startsWith(`${ROOT}${path.sep}`)) throw new HttpError(403, 'Forbidden.');

  const stat = await fsp.stat(absolute).catch(() => null);
  if (!stat?.isFile()) throw new HttpError(404, 'Not found.');
  streamFile(res, absolute, stat, { 'Referrer-Policy': 'same-origin' });
}

// --- api ---------------------------------------------------------------------------

async function serveEvents(req, res, id) {
  const { project, repo, workspace } = await resolveWorkspace(id);
  const roots = await repo.watchRoots(workspace);
  sendEventStream(res);

  watchers.subscribe(id, roots, res, async (watcher, files) => {
    try {
      const fresh = await repo.findWorkspace(workspace.ref);
      if (!fresh) {
        watchers.drop(id);
        return;
      }
      if (files) live.filesChanged(id).catch((error) => console.error(error));
      // `git status` refreshes the index, which the git-dir watch sees; only
      // announce when something observable moved.
      const payload = { head: fresh.head, dirty: fresh.dirty, ahead: fresh.ahead };
      const fingerprint = JSON.stringify(payload);
      if (!files && watcher.last === fingerprint) return;
      watcher.last = fingerprint;
      watcher.broadcast('change', { ...payload, files });
    } catch (error) {
      console.error(error);
    }
  });

  // Viewing a workspace keeps its preview server running.
  const isDefault = workspace.kind === 'branch' && workspace.ref === (await repo.defaultBranchName());
  const release = await live.open(id, {
    slug: project.slug,
    ref: workspace.ref,
    dir: workspace.dir,
    repo,
    isDefault,
    head: async () => (await repo.findWorkspace(workspace.ref))?.head?.sha || null
  }, (payload) => {
    if (!res.writableEnded) res.write(`event: runner\ndata: ${JSON.stringify(payload)}\n\n`);
    // Fixed by hand ("Fix with agent"): the default branch now previews, so
    // the project's setup is done.
    if (isDefault && payload.state === 'ready') markSetupFixed(project.slug).catch((error) => console.error(error));
  });
  if (res.writableEnded || res.destroyed) release();
  else res.on('close', release);
}

async function markSetupFixed(slug) {
  const current = (await projects.find(slug)).previewSetup;
  if (current?.status === 'ready' || current?.status === 'running') return;
  await projects.setPreviewSetup(slug, { status: 'ready', error: null, finishedAt: new Date().toISOString() });
}

function sendEventStream(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(`retry: 2000\n\n`);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
  res.on('close', () => clearInterval(keepAlive));
}

// --- agent sign-in ------------------------------------------------------------------

async function handleAgentApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/agent') {
    sendJson(res, 200, { status: agentAuth.status(), model: agentAuth.model, defaultModel: agentAuth.defaultModel });
    return true;
  }
  if (req.method === 'POST' && pathname === '/api/agent/check') {
    const status = await agentAuth.check({ force: true });
    sendJson(res, 200, { status, model: agentAuth.model, defaultModel: agentAuth.defaultModel });
    return true;
  }
  if (req.method === 'GET' && pathname === '/api/agent/providers') {
    sendJson(res, 200, { providers: await agentAuth.providers() });
    return true;
  }
  if (req.method === 'GET' && pathname === '/api/agent/models') {
    sendJson(res, 200, { models: await agentAuth.models() });
    return true;
  }
  if (req.method === 'PUT' && pathname === '/api/agent/model') {
    const body = await readJsonBody(req);
    const status = await agentAuth.setModel(body.model);
    sendJson(res, 200, { status, model: agentAuth.model, defaultModel: agentAuth.defaultModel });
    return true;
  }
  if (req.method === 'POST' && pathname === '/api/agent/login') {
    const body = await readJsonBody(req);
    const session = await agentAuth.startLogin(body.providerId);
    sendJson(res, 201, { id: session.id });
    return true;
  }
  const match = /^\/api\/agent\/login\/([^/]+)(?:\/(events|input))?$/.exec(pathname);
  if (!match) return false;
  const session = agentAuth.loginSession(match[1]);
  if (req.method === 'GET' && match[2] === 'events') {
    sendEventStream(res);
    session.subscribe(res);
    return true;
  }
  if (req.method === 'POST' && match[2] === 'input') {
    const body = await readJsonBody(req);
    if (typeof body.value !== 'string' || !body.value.trim()) throw new HttpError(400, 'Paste the code or address first.');
    session.answer(body.value.trim());
    sendJson(res, 202, { accepted: true });
    return true;
  }
  if (req.method === 'DELETE' && !match[2]) {
    agentAuth.cancelLogin();
    sendJson(res, 200, { cancelled: session.id });
    return true;
  }
  return false;
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true, mode: 'local-functional-build' });
    return true;
  }

  if (pathname === '/api/agent' || pathname.startsWith('/api/agent/')) {
    try {
      return await handleAgentApi(req, res, pathname);
    } catch (error) {
      if (error instanceof AgentAuthError) throw new HttpError(error.status, error.message);
      throw error;
    }
  }

  if (req.method === 'GET' && pathname === '/api/projects') {
    const list = await projects.list();
    sendJson(res, 200, { projects: await Promise.all(list.map(withPreview)) });
    return true;
  }

  // Add a repository. The mirror is cloned before answering so a wrong or
  // unreachable address fails right in the dialog; on failure the record is
  // kept only when the problem is a missing deploy key (SSH URL to a private
  // repository), because the connect panel needs the project to exist.
  if (req.method === 'POST' && pathname === '/api/projects') {
    const body = await readJsonBody(req);
    let stored;
    try {
      stored = await projects.add(body.url);
    } catch (error) {
      if (error instanceof ProjectError) throw new HttpError(error.status, error.message);
      throw error;
    }
    const project = await findProject(stored.slug);
    let repo;
    try {
      repo = await repoFor(project);
    } catch (error) {
      if (!(error instanceof CloneError && error.reason === 'key')) {
        await discardRepo(project).catch(() => {});
        await projects.remove(project.slug).catch(() => {});
      }
      throw error;
    }
    setup.enqueue(project.slug);
    sendJson(res, 201, { project: await findProject(project.slug) });
    return true;
  }

  let match = /^\/api\/projects\/([^/]+)$/.exec(pathname);
  if (req.method === 'GET' && match) {
    sendJson(res, 200, { project: await findProject(decodeURIComponent(match[1])) });
    return true;
  }
  if (req.method === 'DELETE' && match) {
    const project = await findProject(decodeURIComponent(match[1]));
    await discardRepo(project);
    await projects.remove(project.slug);
    sendJson(res, 200, { removed: project.slug });
    return true;
  }

  match = /^\/api\/projects\/([^/]+)\/refs$/.exec(pathname);
  if (req.method === 'GET' && match) {
    const project = await findProject(decodeURIComponent(match[1]));
    const repo = await repoFor(project);
    const fetchError = await fetchIfStale(repo);
    // A project added by SSH URL whose key was registered after the clone
    // failed: its setup starts once the mirror exists.
    if (project.previewSetup?.status === 'queued') setup.enqueue(project.slug);
    const [refs, open] = await Promise.all([repo.refs(), repo.openWorkspaces()]);
    const openRefs = new Set(open.map((item) => item.ref));
    const decorate = async (ref) => {
      const shot = previews.available ? await previews.lookup(project.slug, ref.sha) : null;
      return {
        ...ref,
        open: openRefs.has(ref.name),
        workspaceId: git.workspaceId(project.slug, ref.name),
        previewUrl: shot ? previewUrl(project, ref.sha) : null,
        previewExact: Boolean(shot?.exact)
      };
    };
    previews.prune(project.slug, [...refs.branches, ...refs.tags].map((ref) => ref.sha)).catch(() => {});
    sendJson(res, 200, {
      project: await withPreview(project),
      branches: await Promise.all(refs.branches.map(decorate)),
      tags: await Promise.all(refs.tags.map(decorate)),
      ...(fetchError ? { fetchError } : {})
    });
    return true;
  }

  // Screenshot of one commit, or the latest main image while that commit
  // has none (such fallbacks must not be cached).
  match = /^\/api\/projects\/([^/]+)\/preview\/([0-9a-f]{40})\.png$/.exec(pathname);
  if (req.method === 'GET' && match) {
    const project = await findProject(decodeURIComponent(match[1]));
    const shot = await previews.lookup(project.slug, match[2]);
    if (!shot) throw new HttpError(404, 'No preview available.');
    const stat = await fsp.stat(shot.file);
    streamFile(res, shot.file, stat, { 'Cache-Control': shot.exact ? 'public, max-age=31536000, immutable' : 'no-cache' });
    return true;
  }

  match = /^\/api\/projects\/([^/]+)\/setup\/(retry|log|fix)$/.exec(pathname);
  if (match) {
    const project = await findProject(decodeURIComponent(match[1]));
    if (req.method === 'POST' && match[2] === 'retry') {
      await projects.setPreviewSetup(project.slug, { status: 'queued', attempt: 0, error: null, finishedAt: null });
      setup.enqueue(project.slug);
      sendJson(res, 202, { previewSetup: (await findProject(project.slug)).previewSetup });
      return true;
    }
    if (req.method === 'GET' && match[2] === 'log') {
      const text = await fsp.readFile(setup.logFile(project.slug), 'utf8').catch(() => '');
      sendText(res, 200, text || 'No setup log yet.');
      return true;
    }
    // "Fix with agent": open the default branch; its page hands the failure
    // to the agent once the terminal is up (POST …/fix-preview).
    if (req.method === 'POST' && match[2] === 'fix') {
      // Opening main may start its preview and clear the error; keep it.
      if (project.previewSetup?.error) fixFailures.set(project.slug, project.previewSetup.error);
      const repo = await repoFor(project);
      const workspace = await repo.ensureWorkspace(await repo.defaultBranchName());
      sendJson(res, 201, { viewerUrl: `workspace.html?id=${encodeURIComponent(workspace.id)}&fix=1` });
      return true;
    }
  }

  match = /^\/api\/projects\/([^/]+)\/workspaces$/.exec(pathname);
  if (req.method === 'POST' && match) {
    const project = await findProject(decodeURIComponent(match[1]));
    const body = await readJsonBody(req);
    const ref = typeof body.ref === 'string' ? body.ref.trim() : '';
    if (!git.isValidRefName(ref)) throw new HttpError(400, 'Choose a valid branch, tag or commit.');
    const repo = await repoFor(project);
    await fetchIfStale(repo);
    let workspace;
    try {
      workspace = await repo.ensureWorkspace(ref);
    } catch (error) {
      if (error instanceof git.GitError && /Unknown ref/.test(error.message)) throw new HttpError(404, `${ref} does not exist in ${project.repo.url}.`);
      throw error;
    }
    sendJson(res, 201, { workspace: await publicWorkspace(project, repo, workspace, req.headers) });
    return true;
  }

  match = /^\/api\/workspaces\/([^/]+\/[^/]+)$/.exec(pathname);
  if (match && req.method === 'GET') {
    const { project, repo, workspace } = await resolveWorkspace(match[1]);
    sendJson(res, 200, { workspace: await publicWorkspace(project, repo, workspace, req.headers) });
    return true;
  }
  if (match && req.method === 'DELETE') {
    const id = match[1];
    const { repo, workspace } = await resolveWorkspace(id);
    terminals.stop(id);
    watchers.drop(id);
    await live.close(id);
    await repo.removeWorkspace(workspace.ref);
    sendJson(res, 200, { removed: id });
    return true;
  }

  match = /^\/api\/workspaces\/([^/]+\/[^/]+)\/preview\/restart$/.exec(pathname);
  if (req.method === 'POST' && match) {
    await resolveWorkspace(match[1]);
    await live.restart(match[1]);
    sendJson(res, 202, { accepted: true });
    return true;
  }

  match = /^\/api\/workspaces\/([^/]+\/[^/]+)\/fix-preview$/.exec(pathname);
  if (req.method === 'POST' && match) {
    const { project, workspace } = await resolveWorkspace(match[1]);
    if (workspace.kind !== 'branch') throw new HttpError(409, 'Only branches have an agent.');
    const failure = fixFailures.get(project.slug) || project.previewSetup?.error || 'The preview did not start.';
    fixFailures.delete(project.slug);
    const prompt = (await fsp.readFile(FIX_PROMPT_PATH, 'utf8'))
      .replaceAll('{{failure}}', failure)
      .replaceAll('{{logPath}}', setup.logFile(project.slug))
      .replaceAll('{{setupPromptPath}}', SETUP_PROMPT_PATH)
      .replace(/\s+/g, ' ')
      .trim();
    await sendPromptWhenReady(workspace, prompt);
    sendJson(res, 202, { accepted: true });
    return true;
  }

  match = /^\/api\/workspaces\/([^/]+\/[^/]+)\/events$/.exec(pathname);
  if (req.method === 'GET' && match) {
    await serveEvents(req, res, match[1]);
    return true;
  }

  // Ask the workspace's agent to commit and push. Refused with the deploy-key
  // setup when the remote does not accept the project's key yet.
  match = /^\/api\/workspaces\/([^/]+\/[^/]+)\/commit$/.exec(pathname);
  if (req.method === 'POST' && match) {
    const { project, repo, workspace } = await resolveWorkspace(match[1]);
    if (workspace.kind !== 'branch') throw new HttpError(409, 'Only branches can be committed.');
    const check = await repo.checkPush();
    if (!check.ok) {
      if (check.reason === 'key' && repo.publicKey) {
        sendJson(res, 409, {
          error: 'Dialogue is not connected to this repository yet.',
          setup: setupFor(project, repo, check.message)
        });
        return true;
      }
      throw new HttpError(502, `Could not reach the repository to push: ${check.message}`);
    }
    // One line: a newline would submit the first line before the rest arrives.
    const prompt = (await fsp.readFile(COMMIT_PROMPT_PATH, 'utf8')).replace(/\s+/g, ' ').trim();
    try {
      await terminals.sendPrompt(workspace, prompt);
    } catch (error) {
      if (error instanceof TerminalError) throw new HttpError(409, error.message);
      throw error;
    }
    sendJson(res, 202, { accepted: true });
    return true;
  }

  return false;
}

// The fix prompt is sent right after the workspace page's terminal connects,
// which is when its tmux session starts; wait for the session to exist and
// omp to come up.
async function sendPromptWhenReady(workspace, prompt) {
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await terminals.sendPrompt(workspace, prompt);
      return;
    } catch (error) {
      if (!(error instanceof TerminalError)) throw error;
      if (Date.now() > deadline) throw new HttpError(409, error.message);
    }
  }
}

async function requestHandler(req, res) {
  // Preview origins (<token>.preview.localhost) never reach Dialogue's routes.
  if (proxy.handleRequest(req, res)) return;
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);

    if (url.pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, url);
      if (!handled) throw new HttpError(404, 'API route not found.');
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
    await serveAppFile(res, url.pathname);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError ? error.message : 'Unexpected local server error.';
    if (!res.headersSent) {
      if ((req.url || '').startsWith('/api/')) sendJson(res, status, { error: message, ...(error.reason ? { reason: error.reason } : {}), ...(error.setup ? { setup: error.setup } : {}) });
      else sendText(res, status, message);
    } else {
      res.destroy();
    }
    if (!(error instanceof HttpError)) console.error(error);
  }
}

// --- websocket proxy to ttyd ------------------------------------------------------

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function rejectUpgrade(socket, req, code, reason) {
  // Complete the handshake ourselves so the browser receives a close reason.
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return;
  }
  const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
  const protocol = req.headers['sec-websocket-protocol'] ? `Sec-WebSocket-Protocol: ${req.headers['sec-websocket-protocol'].split(',')[0].trim()}\r\n` : '';
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n${protocol}\r\n`);
  const text = Buffer.from(String(reason).slice(0, 120), 'utf8');
  const payload = Buffer.alloc(2 + text.length);
  payload.writeUInt16BE(code, 0);
  text.copy(payload, 2);
  socket.end(Buffer.concat([Buffer.from([0x88, payload.length]), payload]));
}

async function upgradeHandler(req, socket, head) {
  const match = /^\/ws\/terminal\/([^/]+\/[^/]+)\/ws$/.exec(req.url || '');
  if (!match) {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return;
  }
  const id = match[1];
  socket.on('error', () => {});

  let socketPath;
  try {
    const { workspace } = await resolveWorkspace(id);
    if (workspace.kind !== 'branch') throw new HttpError(403, 'Read-only workspace: terminals are only available on branches.');
    ({ socketPath } = await terminals.ensure(workspace));
  } catch (error) {
    const message = error instanceof HttpError || error instanceof TerminalError ? error.message : 'Terminal could not be started.';
    if (!(error instanceof HttpError) && !(error instanceof TerminalError)) console.error(error);
    rejectUpgrade(socket, req, 1011, message);
    return;
  }

  const upstream = net.connect({ path: socketPath });
  upstream.on('error', () => socket.destroy());
  socket.on('close', () => upstream.destroy());
  upstream.on('close', () => socket.destroy());
  upstream.once('connect', () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
}

// --- startup ---------------------------------------------------------------------------

const server = http.createServer(requestHandler);
server.on('upgrade', (req, socket, head) => {
  if (proxy.handleUpgrade(req, socket, head)) return;
  upgradeHandler(req, socket, head).catch((error) => {
    console.error(error);
    socket.destroy();
  });
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  agentAuth.shutdown();
  terminals.shutdown();
  server.close();
  // Preview servers run in their own process groups: stop them explicitly.
  await live.shutdown().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

ensureData()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`Dialogue local server running at http://${HOST}:${PORT}`);
      console.log(`Data directory: ${DATA_ROOT}`);
    });
    // Non-blocking: the UI shows "checking" until the first result lands.
    agentAuth.check().then((status) => {
      if (!status.ready) console.log(`AI model not ready (${status.reason}): ${status.detail.split('\n')[0]}`);
    }).catch((error) => console.error(error));
    // Setups interrupted by a restart, or still waiting, start again.
    projects.list().then((list) => {
      for (const project of list) {
        if (['queued', 'running', 'waiting-for-agent'].includes(project.previewSetup?.status)) setup.enqueue(project.slug);
      }
    }).catch((error) => console.error(error));
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
