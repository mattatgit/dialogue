// Per-workspace preview origins. Each registered workspace gets a random token
// and is reachable at http://<token>.preview.localhost:<port>/ (or
// <token>.<domain> when Dialogue runs behind a real hostname). Requests to a
// preview host are dispatched by what the workspace's resolve() reports:
// proxied to a dev server, served from a static root, or answered with a
// pending/failed status page. Node builtins only.
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const LOCAL_SUFFIX = '.preview.localhost';

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function statusPage({ title, message, log = null, refresh = false }) {
  const head = refresh ? '<meta http-equiv="refresh" content="2">' : '';
  const pre = log ? `<pre>${escapeHtml(log)}</pre>` : '';
  return `<!doctype html><html><head><meta charset="utf-8">${head}<title>${escapeHtml(title)}</title>` +
    '<style>body{font:15px/1.5 system-ui,sans-serif;margin:3rem auto;max-width:48rem;padding:0 1rem;color:#222}pre{background:#f4f4f4;padding:1rem;overflow:auto;white-space:pre-wrap}</style>' +
    `</head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${pre}</body></html>`;
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

// Headers that describe this hop's connection rather than the message; they
// must not be forwarded (RFC 7230 §6.1).
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

// Dev servers (Vite, webpack-dev-server, Next) reject requests whose Host or
// Origin they do not recognise, so the upstream only ever sees localhost:<port>.
// Returns raw header pairs [name, value, name, value, …] preserving the
// browser's header order and duplicates.
function rewriteRequestHeaders(req, target, { upgrade = false } = {}) {
  const local = `localhost:${target.port}`;
  const out = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i];
    const lower = name.toLowerCase();
    let value = req.rawHeaders[i + 1];
    if (HOP_BY_HOP.has(lower) && !(upgrade && (lower === 'connection' || lower === 'upgrade'))) continue;
    if (lower === 'host') value = local;
    else if (lower === 'origin') value = `http://${local}`;
    else if (lower === 'referer') value = value.replace(/^https?:\/\/[^/]+/i, `http://${local}`);
    out.push(name, value);
  }
  return out;
}

// Redirects the dev server issues against its own address must come back on
// the preview origin, or the browser leaves the proxy.
function rewriteLocation(value, target, origin) {
  const pattern = new RegExp(`^https?://(?:localhost|127\\.0\\.0\\.1|\\[::1\\]|${target.host.replace(/[.[\]]/g, '\\$&')}):${target.port}(?=/|$)`, 'i');
  return value.replace(pattern, origin);
}

function proxyRequest(req, res, target, origin) {
  const upstream = http.request({
    host: target.host,
    port: target.port,
    method: req.method,
    path: req.url,
    headers: rewriteRequestHeaders(req, target),
    setHost: false
  });
  upstream.on('response', (up) => {
    const headers = [];
    for (let i = 0; i < up.rawHeaders.length; i += 2) {
      const name = up.rawHeaders[i];
      const lower = name.toLowerCase();
      if (HOP_BY_HOP.has(lower)) continue;
      headers.push(name, lower === 'location' ? rewriteLocation(up.rawHeaders[i + 1], target, origin) : up.rawHeaders[i + 1]);
    }
    res.writeHead(up.statusCode, up.statusMessage, headers);
    up.pipe(res);
    up.on('error', () => res.destroy());
  });
  upstream.on('error', (error) => {
    if (res.headersSent) return res.destroy();
    sendHtml(res, 502, statusPage({ title: 'Preview unreachable', message: `The dev server did not answer (${error.code || error.message}). It may still be starting, or it may have crashed.`, refresh: true }));
  });
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}

// Raw TCP splice for WebSocket upgrades (HMR). The rewritten request head is
// replayed to the dev server; from then on bytes flow untouched both ways.
function proxyUpgrade(req, socket, head, target) {
  const upstream = net.connect({ host: target.host, port: target.port });
  upstream.on('error', () => {
    if (!socket.destroyed && socket.bytesWritten === 0) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    else socket.destroy();
  });
  // http.Server sockets allow half-open connections, so a FIN from one side
  // would otherwise leave both sockets lingering forever. A WebSocket is done
  // once either side hangs up: flush what is queued, then tear both down.
  socket.on('close', () => upstream.destroy());
  upstream.on('close', () => socket.destroy());
  socket.on('end', () => upstream.destroySoon());
  upstream.on('end', () => socket.destroySoon());
  upstream.once('connect', () => {
    const headers = rewriteRequestHeaders(req, target, { upgrade: true });
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < headers.length; i += 2) lines.push(`${headers[i]}: ${headers[i + 1]}`);
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm'
};

// Maps a request path onto a file inside root, or null when it points
// anywhere else. Decoding happens before resolving so encoded dots cannot
// sneak past, and realpath catches symlinks that leave the root.
async function resolveStatic(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rootReal = await fsp.realpath(root);
  const candidate = path.resolve(rootReal, `.${path.posix.normalize(`/${decoded}`)}`);
  if (candidate !== rootReal && !candidate.startsWith(rootReal + path.sep)) return null;
  let real;
  try {
    real = await fsp.realpath(candidate);
  } catch {
    return null;
  }
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) return null;
  let stat = await fsp.stat(real);
  if (stat.isDirectory()) {
    real = path.join(real, 'index.html');
    try {
      stat = await fsp.stat(real);
    } catch {
      return null;
    }
  }
  return stat.isFile() ? { file: real, size: stat.size } : null;
}

async function serveStatic(req, res, root) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' });
    return res.end();
  }
  const found = await resolveStatic(root, new URL(req.url, 'http://x').pathname);
  if (!found) return sendHtml(res, 404, statusPage({ title: 'Not found', message: 'No such file in this preview.' }));
  res.writeHead(200, {
    'content-type': MIME[path.extname(found.file).toLowerCase()] || 'application/octet-stream',
    'content-length': found.size,
    'cache-control': 'no-store'
  });
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(found.file);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

class PreviewProxy {
  constructor({ domain = process.env.DIALOGUE_PREVIEW_DOMAIN || null } = {}) {
    this.domain = domain ? domain.toLowerCase().replace(/^\./, '') : null;
    this.byWorkspace = new Map(); // workspaceId → { token, resolve }
    this.byToken = new Map(); // token → workspaceId
  }

  register(workspaceId, resolve) {
    const existing = this.byWorkspace.get(workspaceId);
    if (existing) {
      existing.resolve = resolve;
      return existing.token;
    }
    const token = crypto.randomBytes(8).toString('hex');
    this.byWorkspace.set(workspaceId, { token, resolve });
    this.byToken.set(token, workspaceId);
    return token;
  }

  unregister(workspaceId) {
    const entry = this.byWorkspace.get(workspaceId);
    if (!entry) return;
    this.byWorkspace.delete(workspaceId);
    this.byToken.delete(entry.token);
  }

  tokenFor(workspaceId) {
    const entry = this.byWorkspace.get(workspaceId);
    return entry ? entry.token : null;
  }

  urlFor(workspaceId, req) {
    const token = this.tokenFor(workspaceId);
    if (!token) return null;
    if (this.domain) {
      const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
      return `${proto}://${token}.${this.domain}/`;
    }
    const host = String(req.headers.host || '');
    const port = /:(\d+)$/.exec(host)?.[1];
    return `http://${token}${LOCAL_SUFFIX}${port && port !== '80' ? `:${port}` : ''}/`;
  }

  // Token from the Host header when it names a preview origin, else null.
  // Returns '' for a preview host whose token is unknown.
  tokenFromHost(hostHeader) {
    const host = String(hostHeader || '').toLowerCase().replace(/:\d+$/, '');
    let label = null;
    if (host.endsWith(LOCAL_SUFFIX)) label = host.slice(0, -LOCAL_SUFFIX.length);
    else if (this.domain && host.endsWith(`.${this.domain}`)) label = host.slice(0, -(this.domain.length + 1));
    if (label === null) return null;
    return /^[0-9a-f]{16}$/.test(label) ? label : '';
  }

  // The preview origin the browser is talking to, from the incoming request.
  originFor(req) {
    const proto = this.domain ? String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() : 'http';
    return `${proto}://${String(req.headers.host || '').toLowerCase()}`;
  }

  handleRequest(req, res) {
    const token = this.tokenFromHost(req.headers.host);
    if (token === null) return false;
    const workspaceId = this.byToken.get(token);
    const entry = workspaceId === undefined ? undefined : this.byWorkspace.get(workspaceId);
    if (!entry) {
      sendHtml(res, 404, statusPage({ title: 'No such preview', message: 'This preview link is no longer valid. Open the workspace in Dialogue to get a fresh one.' }));
      return true;
    }
    const target = entry.resolve() || { kind: 'pending', title: 'Preview not ready', message: 'Waiting for the workspace…' };
    switch (target.kind) {
      case 'server':
        proxyRequest(req, res, target, this.originFor(req));
        break;
      case 'static':
        serveStatic(req, res, target.root).catch(() => {
          if (!res.headersSent) sendHtml(res, 500, statusPage({ title: 'Preview error', message: 'The file could not be read.' }));
          else res.destroy();
        });
        break;
      case 'pending':
        sendHtml(res, 200, statusPage({ title: target.title, message: target.message, refresh: true }));
        break;
      case 'failed':
        sendHtml(res, 200, statusPage({ title: target.title, message: target.message, log: target.log }));
        break;
      default:
        sendHtml(res, 500, statusPage({ title: 'Preview error', message: `Unknown preview target "${target.kind}".` }));
    }
    return true;
  }

  handleUpgrade(req, socket, head) {
    const token = this.tokenFromHost(req.headers.host);
    if (token === null) return false;
    socket.on('error', () => {});
    const workspaceId = this.byToken.get(token);
    const entry = workspaceId === undefined ? undefined : this.byWorkspace.get(workspaceId);
    const target = entry ? entry.resolve() : null;
    if (!target || target.kind !== 'server') {
      socket.end(`HTTP/1.1 ${entry ? 503 : 404} ${entry ? 'Service Unavailable' : 'Not Found'}\r\nConnection: close\r\n\r\n`);
      return true;
    }
    proxyUpgrade(req, socket, head, target);
    return true;
  }
}

module.exports = { PreviewProxy };
