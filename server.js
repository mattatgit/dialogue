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

const ROOT = __dirname;
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const DATA_ROOT = path.resolve(process.env.DIALOGUE_DATA || path.join(ROOT, '.dialogue-data'));
const DB_PATH = path.join(DATA_ROOT, 'db.json');
const REPOS_ROOT = path.join(DATA_ROOT, 'repos');
const WORKSPACES_ROOT = path.join(DATA_ROOT, 'workspaces');
const KEYS_ROOT = path.join(DATA_ROOT, 'keys');
const COMMIT_PROMPT_PATH = path.join(ROOT, 'omp', 'commit-prompt.md');
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

const terminals = new TerminalManager({ appRoot: ROOT });
const watchers = new WatchRegistry();
const deployKeys = new DeployKeys(KEYS_ROOT);
const repos = new Map();

// --- data -------------------------------------------------------------------

const projects = new ProjectStore(DB_PATH);

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
  }
  await instance.destroy();
  await deployKeys.remove(project.slug);
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

async function publicWorkspace(project, workspace) {
  const prototypeDir = path.join(workspace.dir, project.repo.prototypePath || '');
  const hasEntry = await fsp.stat(path.join(prototypeDir, 'index.html')).then((s) => s.isFile(), () => false);
  return {
    id: workspace.id,
    project: { slug: project.slug, name: project.name },
    ref: workspace.ref,
    kind: workspace.kind,
    head: workspace.head,
    dirty: workspace.dirty,
    ahead: workspace.ahead,
    prototypePath: project.repo.prototypePath || '',
    entryPoint: hasEntry ? 'index.html' : null,
    terminal: workspace.kind === 'branch',
    viewerUrl: `workspace.html?id=${encodeURIComponent(workspace.id)}`,
    filesUrl: `/workspace-files/${workspace.id}/`
  };
}

async function resolveWorkspace(id) {
  const parsed = git.parseWorkspaceId(id);
  if (!parsed) throw new HttpError(404, 'Workspace not found.');
  const project = await findProject(parsed.slug);
  const repo = await repoFor(project);
  const workspace = await repo.findWorkspace(parsed.ref);
  if (!workspace) throw new HttpError(404, 'Workspace not found.');
  workspace.prototypePath = project.repo.prototypePath || '';
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

async function serveWorkspaceFile(res, id, requestedRelativePath) {
  const { project, workspace } = await resolveWorkspace(id);
  const baseDir = path.resolve(workspace.dir, project.repo.prototypePath || '');

  let relativePath;
  try {
    relativePath = decodeURIComponent(requestedRelativePath || 'index.html').replace(/\\/g, '/');
  } catch {
    throw new HttpError(400, 'Invalid URL.');
  }
  if (relativePath.split('/').some((segment) => segment === '..')) throw new HttpError(403, 'Unsafe prototype path.');

  let absolute = path.resolve(baseDir, relativePath);
  if (absolute !== baseDir && !absolute.startsWith(`${baseDir}${path.sep}`)) throw new HttpError(403, 'Unsafe prototype path.');

  let stat = await fsp.stat(absolute).catch(() => null);
  if (stat?.isDirectory()) {
    absolute = path.join(absolute, 'index.html');
    stat = await fsp.stat(absolute).catch(() => null);
  }
  if (!stat?.isFile()) throw new HttpError(404, 'Prototype file not found.');

  streamFile(res, absolute, stat, {
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin'
  });
}

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
  const roots = await repo.watchRoots(workspace, project.repo.prototypePath || '');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(`retry: 2000\n\n`);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
  res.on('close', () => clearInterval(keepAlive));

  watchers.subscribe(id, roots, res, async (watcher, files) => {
    try {
      const fresh = await repo.findWorkspace(workspace.ref);
      if (!fresh) {
        watchers.drop(id);
        return;
      }
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
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true, mode: 'local-functional-build' });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/projects') {
    sendJson(res, 200, { projects: await projects.list() });
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
    const prototypePath = await repo.detectPrototypePath();
    await projects.update(project.slug, { prototypePath });
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
    // failed: it has no prototype path yet, so detect it on first success.
    if (project.repo.prototypePath === null) {
      project.repo.prototypePath = await repo.detectPrototypePath();
      await projects.update(project.slug, { prototypePath: project.repo.prototypePath });
    }
    const [refs, open] = await Promise.all([repo.refs(), repo.openWorkspaces()]);
    const openRefs = new Set(open.map((item) => item.ref));
    const decorate = (ref) => ({ ...ref, open: openRefs.has(ref.name), workspaceId: git.workspaceId(project.slug, ref.name) });
    sendJson(res, 200, {
      project,
      branches: refs.branches.map(decorate),
      tags: refs.tags.map(decorate),
      ...(fetchError ? { fetchError } : {})
    });
    return true;
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
    sendJson(res, 201, { workspace: await publicWorkspace(project, workspace) });
    return true;
  }

  match = /^\/api\/workspaces\/([^/]+\/[^/]+)$/.exec(pathname);
  if (match && req.method === 'GET') {
    const { project, workspace } = await resolveWorkspace(match[1]);
    sendJson(res, 200, { workspace: await publicWorkspace(project, workspace) });
    return true;
  }
  if (match && req.method === 'DELETE') {
    const id = match[1];
    const { repo, workspace } = await resolveWorkspace(id);
    terminals.stop(id);
    watchers.drop(id);
    await repo.removeWorkspace(workspace.ref);
    sendJson(res, 200, { removed: id });
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

async function requestHandler(req, res) {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);

    if (url.pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, url);
      if (!handled) throw new HttpError(404, 'API route not found.');
      return;
    }

    const workspaceMatch = /^\/workspace-files\/([^/]+\/[^/]+)(?:\/(.*))?$/.exec(url.pathname);
    if ((req.method === 'GET' || req.method === 'HEAD') && workspaceMatch) {
      await serveWorkspaceFile(res, workspaceMatch[1], workspaceMatch[2] || '');
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
  upgradeHandler(req, socket, head).catch((error) => {
    console.error(error);
    socket.destroy();
  });
});

function shutdown() {
  terminals.shutdown();
  server.close();
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
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
