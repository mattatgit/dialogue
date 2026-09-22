const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const ROOT = __dirname;
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const DATA_ROOT = path.join(ROOT, '.dialogue-data');
const DB_PATH = path.join(DATA_ROOT, 'db.json');
const DB_BACKUP_PATH = path.join(DATA_ROOT, 'db.json.bak');
const TMP_ROOT = path.join(DATA_ROOT, 'tmp');
const PROTOTYPE_ROOT = path.join(DATA_ROOT, 'prototypes');
const REVISION_MANIFEST_NAME = '.dialogue-revision.json';
const UNZIP_BIN = process.env.DIALOGUE_UNZIP || '/usr/bin/unzip';
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

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

function initialData() {
  return {
    schemaVersion: 1,
    projects: [
      {
        id: 'project-landline',
        slug: 'landline',
        name: 'Landline',
        description: 'A simpler way for households to stay in touch.',
        createdAt: new Date().toISOString()
      }
    ],
    prototypes: [],
    revisions: []
  };
}

async function directoryHasMeaningfulEntries(directory) {
  try {
    const entries = await fsp.readdir(directory);
    return entries.some((entry) => entry !== '.DS_Store');
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function ensureData() {
  await Promise.all([
    fsp.mkdir(DATA_ROOT, { recursive: true }),
    fsp.mkdir(TMP_ROOT, { recursive: true }),
    fsp.mkdir(PROTOTYPE_ROOT, { recursive: true })
  ]);

  let databaseExists = true;
  try {
    await fsp.access(DB_PATH, fs.constants.F_OK);
  } catch {
    databaseExists = false;
  }

  if (!databaseExists) {
    if (await directoryHasMeaningfulEntries(PROTOTYPE_ROOT)) {
      throw new Error(
        `Dialogue metadata is missing at ${DB_PATH}, but stored prototype content still exists under ${PROTOTYPE_ROOT}. ` +
        `Refusing to create a blank database. Restore ${DB_PATH} or ${DB_BACKUP_PATH}, or explicitly move/remove the existing prototype storage before starting Dialogue.`
      );
    }

    const createdAt = new Date().toISOString();
    console.warn(`[Dialogue] Initializing a new local data store at ${DATA_ROOT} (${createdAt}).`);
    await saveData(initialData(), { backupExisting: false });
    return;
  }

  try {
    JSON.parse(await fsp.readFile(DB_PATH, 'utf8'));
  } catch {
    throw new Error(
      `Dialogue metadata at ${DB_PATH} is unreadable. Refusing to continue. ` +
      `Inspect or restore the backup at ${DB_BACKUP_PATH} before starting Dialogue again.`
    );
  }
}

async function loadData() {
  await ensureData();
  const raw = await fsp.readFile(DB_PATH, 'utf8');
  return JSON.parse(raw);
}

async function saveData(data, { backupExisting = true } = {}) {
  await fsp.mkdir(DATA_ROOT, { recursive: true });

  if (backupExisting) {
    try {
      await fsp.copyFile(DB_PATH, DB_BACKUP_PATH);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  const tempPath = `${DB_PATH}.tmp`;
  await fsp.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fsp.rename(tempPath, DB_PATH);
}

async function writeRevisionManifest(finalDir, project, prototype, revision) {
  const manifest = {
    schemaVersion: 1,
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      description: project.description || '',
      createdAt: project.createdAt
    },
    prototype: {
      id: prototype.id,
      projectId: prototype.projectId,
      slug: prototype.slug,
      name: prototype.name,
      createdAt: prototype.createdAt
    },
    revision
  };

  await fsp.writeFile(
    path.join(finalDir, REVISION_MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function sendText(res, status, text) {
  const body = Buffer.from(text);
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function slugify(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'prototype';
}

function nextVersionFor(data, prototypeId) {
  const numbers = data.revisions
    .filter((revision) => revision.prototypeId === prototypeId)
    .map((revision) => /^v?(\d+)$/i.exec(revision.version || ''))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  return `V${numbers.length ? Math.max(...numbers) + 1 : 1}`;
}

function joinedRevision(data, revision) {
  const prototype = data.prototypes.find((item) => item.id === revision.prototypeId);
  const project = prototype && data.projects.find((item) => item.id === prototype.projectId);
  return {
    ...revision,
    prototype: prototype
      ? { id: prototype.id, name: prototype.name, slug: prototype.slug }
      : null,
    project: project
      ? { id: project.id, name: project.name, slug: project.slug }
      : null,
    viewerUrl: `/prototype.html?revision=${encodeURIComponent(revision.id)}`
  };
}

async function readRequestBody(req, limit = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'Prototype package is larger than the 100 MB development limit.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function listZipEntries(zipPath) {
  try {
    const { stdout } = await execFileAsync(UNZIP_BIN, ['-Z1', zipPath], {
      maxBuffer: 8 * 1024 * 1024
    });
    return stdout.split(/\r?\n/).filter(Boolean);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new HttpError(500, `Could not find unzip at ${UNZIP_BIN}.`);
    }
    throw new HttpError(400, 'The selected file could not be read as a ZIP package.');
  }
}

function validateZipEntries(entries) {
  if (!entries.length) throw new HttpError(400, 'The ZIP package is empty.');
  if (entries.length > 5000) throw new HttpError(400, 'The ZIP package contains too many files for this development build.');

  for (const originalEntry of entries) {
    if (originalEntry.includes('\0')) throw new HttpError(400, 'The ZIP package contains an invalid file path.');
    const entry = originalEntry.replace(/\\/g, '/');
    if (entry.startsWith('/') || /^[A-Za-z]:\//.test(entry)) {
      throw new HttpError(400, 'The ZIP package contains an unsafe absolute file path.');
    }
    const segments = entry.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '..')) {
      throw new HttpError(400, 'The ZIP package contains an unsafe parent-directory path.');
    }
  }
}

async function isRegularFile(filePath) {
  try {
    const stat = await fsp.lstat(filePath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

async function collectIndexFiles(root, current = root, results = []) {
  const entries = await fsp.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '__MACOSX') continue;
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await collectIndexFiles(root, absolute, results);
    } else if (entry.isFile() && entry.name.toLowerCase() === 'index.html') {
      results.push(path.relative(root, absolute).split(path.sep).join('/'));
    }
  }
  return results;
}

async function findEntryPoint(root) {
  const rootIndex = path.join(root, 'index.html');
  if (await isRegularFile(rootIndex)) return 'index.html';

  const candidates = await collectIndexFiles(root);
  if (!candidates.length) {
    throw new HttpError(400, 'The prototype package must contain an index.html entry point.');
  }
  if (candidates.length > 1) {
    throw new HttpError(400, 'The prototype package contains multiple index.html files. Put the intended entry point at the ZIP root.');
  }
  return candidates[0];
}

async function importPrototype(req, res, projectSlug, url) {
  const data = await loadData();
  const project = data.projects.find((item) => item.slug === projectSlug);
  if (!project) throw new HttpError(404, 'Project not found.');

  const prototypeName = (url.searchParams.get('name') || '').trim() || project.name;
  const prototypeSlug = slugify(prototypeName);
  let prototype = data.prototypes.find(
    (item) => item.projectId === project.id && item.slug === prototypeSlug
  );

  const requestedVersion = (url.searchParams.get('version') || '').trim();
  const version = requestedVersion || (prototype ? nextVersionFor(data, prototype.id) : 'V1');

  if (prototype) {
    const duplicate = data.revisions.some(
      (revision) =>
        revision.prototypeId === prototype.id &&
        String(revision.version).toLowerCase() === version.toLowerCase()
    );
    if (duplicate) {
      throw new HttpError(409, `${prototypeName} ${version} has already been imported.`);
    }
  }

  const body = await readRequestBody(req);
  if (body.length < 4 || body[0] !== 0x50 || body[1] !== 0x4b) {
    throw new HttpError(400, 'Choose a valid ZIP package.');
  }

  const tempZip = path.join(TMP_ROOT, `${randomUUID()}.zip`);
  await fsp.writeFile(tempZip, body);

  let finalDir = null;
  try {
    const entries = await listZipEntries(tempZip);
    validateZipEntries(entries);

    if (!prototype) {
      prototype = {
        id: randomUUID(),
        projectId: project.id,
        slug: prototypeSlug,
        name: prototypeName,
        createdAt: new Date().toISOString()
      };
      data.prototypes.push(prototype);
    }

    const revisionId = randomUUID();
    finalDir = path.join(PROTOTYPE_ROOT, project.slug, prototype.slug, revisionId);
    await fsp.mkdir(finalDir, { recursive: true });

    try {
      await execFileAsync(UNZIP_BIN, ['-qq', tempZip, '-d', finalDir], {
        maxBuffer: 8 * 1024 * 1024
      });
    } catch {
      throw new HttpError(400, 'The ZIP package could not be extracted.');
    }

    const entryPoint = await findEntryPoint(finalDir);
    const createdAt = new Date().toISOString();
    const storageKey = path.relative(DATA_ROOT, finalDir).split(path.sep).join('/');
    const revision = {
      id: revisionId,
      prototypeId: prototype.id,
      version,
      title: `${prototype.name} ${version}`.trim(),
      createdAt,
      importedAt: createdAt,
      entryPoint,
      storageKey,
      source: 'manual-zip-import',
      fileCount: entries.filter((entry) => !entry.endsWith('/')).length
    };

    await writeRevisionManifest(finalDir, project, prototype, revision);
    data.revisions.push(revision);
    await saveData(data);
    sendJson(res, 201, { revision: joinedRevision(data, revision) });
  } catch (error) {
    if (finalDir) await fsp.rm(finalDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    await fsp.rm(tempZip, { force: true }).catch(() => {});
  }
}

async function servePrototypeFile(res, revisionId, requestedRelativePath) {
  const data = await loadData();
  const revision = data.revisions.find((item) => item.id === revisionId);
  if (!revision) throw new HttpError(404, 'Prototype revision not found.');

  const baseDir = path.resolve(DATA_ROOT, revision.storageKey);
  let relativePath = requestedRelativePath || revision.entryPoint;
  relativePath = decodeURIComponent(relativePath).replace(/\\/g, '/');

  if (relativePath === REVISION_MANIFEST_NAME) {
    throw new HttpError(404, 'Prototype file not found.');
  }

  if (relativePath.split('/').some((segment) => segment === '..')) {
    throw new HttpError(403, 'Unsafe prototype path.');
  }

  let absolute = path.resolve(baseDir, relativePath);
  const basePrefix = `${baseDir}${path.sep}`;
  if (absolute !== baseDir && !absolute.startsWith(basePrefix)) {
    throw new HttpError(403, 'Unsafe prototype path.');
  }

  let stat;
  try {
    stat = await fsp.stat(absolute);
  } catch {
    throw new HttpError(404, 'Prototype file not found.');
  }

  if (stat.isDirectory()) {
    absolute = path.join(absolute, 'index.html');
    try {
      stat = await fsp.stat(absolute);
    } catch {
      throw new HttpError(404, 'Prototype file not found.');
    }
  }

  if (!stat.isFile()) throw new HttpError(404, 'Prototype file not found.');

  const contentType = MIME_TYPES.get(path.extname(absolute).toLowerCase()) || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff'
  });
  fs.createReadStream(absolute).pipe(res);
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

  let stat;
  try {
    stat = await fsp.stat(absolute);
  } catch {
    throw new HttpError(404, 'Not found.');
  }
  if (!stat.isFile()) throw new HttpError(404, 'Not found.');

  const contentType = MIME_TYPES.get(path.extname(absolute).toLowerCase()) || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin'
  });
  fs.createReadStream(absolute).pipe(res);
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true, mode: 'local-functional-build' });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/projects') {
    const data = await loadData();
    const projects = data.projects.map((project) => ({
      ...project,
      prototypes: data.prototypes.filter((item) => item.projectId === project.id).length
    }));
    sendJson(res, 200, { projects });
    return true;
  }

  let match = /^\/api\/projects\/([^/]+)\/revisions$/.exec(pathname);
  if (req.method === 'GET' && match) {
    const projectSlug = decodeURIComponent(match[1]);
    const data = await loadData();
    const project = data.projects.find((item) => item.slug === projectSlug);
    if (!project) throw new HttpError(404, 'Project not found.');
    const prototypeIds = new Set(
      data.prototypes.filter((item) => item.projectId === project.id).map((item) => item.id)
    );
    const revisions = data.revisions
      .filter((revision) => prototypeIds.has(revision.prototypeId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((revision) => joinedRevision(data, revision));
    sendJson(res, 200, { project, revisions });
    return true;
  }

  match = /^\/api\/projects\/([^/]+)\/import$/.exec(pathname);
  if (req.method === 'POST' && match) {
    await importPrototype(req, res, decodeURIComponent(match[1]), url);
    return true;
  }

  match = /^\/api\/revisions\/([^/]+)$/.exec(pathname);
  if (req.method === 'GET' && match) {
    const revisionId = decodeURIComponent(match[1]);
    const data = await loadData();
    const revision = data.revisions.find((item) => item.id === revisionId);
    if (!revision) throw new HttpError(404, 'Prototype revision not found.');
    sendJson(res, 200, { revision: joinedRevision(data, revision) });
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

    const prototypeMatch = /^\/prototype-files\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
    if (req.method === 'GET' && prototypeMatch) {
      await servePrototypeFile(res, decodeURIComponent(prototypeMatch[1]), prototypeMatch[2] || '');
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new HttpError(405, 'Method not allowed.');
    }

    await serveAppFile(res, url.pathname);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError ? error.message : 'Unexpected local server error.';
    if (!res.headersSent) {
      if ((req.url || '').startsWith('/api/')) sendJson(res, status, { error: message });
      else sendText(res, status, message);
    } else {
      res.destroy();
    }
    if (!(error instanceof HttpError)) console.error(error);
  }
}

ensureData()
  .then(() => {
    const server = http.createServer(requestHandler);
    server.listen(PORT, HOST, () => {
      console.log(`Dialogue local functional build: http://${HOST}:${PORT}`);
      console.log('Data is stored locally in .dialogue-data/ and is not committed to Git.');
    });
  })
  .catch((error) => {
    console.error('Could not start Dialogue:', error);
    process.exitCode = 1;
  });
