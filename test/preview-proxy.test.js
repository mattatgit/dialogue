const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { PreviewProxy } = require('../server/preview-proxy.js');

// Serve a PreviewProxy on a random port; returns { port, close }.
function serveProxy(proxy) {
  const server = http.createServer((req, res) => {
    if (proxy.handleRequest(req, res)) return;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('dialogue');
  });
  server.on('upgrade', (req, socket, head) => {
    if (proxy.handleUpgrade(req, socket, head)) return;
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

// Plain HTTP request against 127.0.0.1:port with an explicit Host header.
function request(port, { method = 'GET', path = '/', host, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { host, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('register returns a stable 16-hex token that unregister forgets', () => {
  const proxy = new PreviewProxy({ domain: null });
  const token = proxy.register('ws-1', () => ({ kind: 'pending', title: 't', message: 'm' }));
  assert.match(token, /^[0-9a-f]{16}$/);
  assert.equal(proxy.register('ws-1', () => null), token);
  assert.equal(proxy.tokenFor('ws-1'), token);
  const other = proxy.register('ws-2', () => null);
  assert.notEqual(other, token);
  proxy.unregister('ws-1');
  assert.equal(proxy.tokenFor('ws-1'), null);
});

test('urlFor builds a preview.localhost origin from the request Host, or the configured domain', () => {
  const local = new PreviewProxy({ domain: null });
  const token = local.register('ws', () => null);
  assert.equal(local.urlFor('ws', { headers: { host: 'localhost:4321' } }), `http://${token}.preview.localhost:4321/`);
  assert.equal(local.urlFor('ws', { headers: { host: 'localhost' } }), `http://${token}.preview.localhost/`);

  const hosted = new PreviewProxy({ domain: 'dialogue.example.com' });
  const t2 = hosted.register('ws', () => null);
  assert.equal(hosted.urlFor('ws', { headers: { host: 'dialogue.example.com' } }), `http://${t2}.dialogue.example.com/`);
  assert.equal(hosted.urlFor('ws', { headers: { host: 'dialogue.example.com', 'x-forwarded-proto': 'https' } }), `https://${t2}.dialogue.example.com/`);
});

test('handleRequest ignores non-preview hosts and 404s unknown preview tokens', async () => {
  const proxy = new PreviewProxy({ domain: 'dialogue.example.com' });
  const { port, close } = await serveProxy(proxy);
  try {
    const plain = await request(port, { host: `localhost:${port}` });
    assert.equal(plain.body, 'dialogue');
    const appHost = await request(port, { host: 'dialogue.example.com' });
    assert.equal(appHost.body, 'dialogue');

    const unknown = await request(port, { host: `0123456789abcdef.preview.localhost:${port}` });
    assert.equal(unknown.status, 404);
    assert.match(unknown.headers['content-type'], /text\/html/);
    const unknownDomain = await request(port, { host: '0123456789ABCDEF.Dialogue.Example.com' });
    assert.equal(unknownDomain.status, 404);
  } finally {
    await close();
  }
});

test('pending resolves render an auto-refreshing status page', async () => {
  const proxy = new PreviewProxy({ domain: null });
  const token = proxy.register('ws', () => ({ kind: 'pending', title: 'Installing <deps>', message: 'npm ci & friends' }));
  const { port, close } = await serveProxy(proxy);
  try {
    const res = await request(port, { host: `${token}.preview.localhost:${port}`, path: '/anything' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.match(res.body, /http-equiv="refresh" content="2"/);
    assert.match(res.body, /Installing &lt;deps&gt;/);
    assert.match(res.body, /npm ci &amp; friends/);
  } finally {
    await close();
  }
});

test('failed resolves render the escaped log without auto refresh', async () => {
  const proxy = new PreviewProxy({ domain: null });
  const token = proxy.register('ws', () => ({ kind: 'failed', title: 'Start failed', message: 'exit 1', log: 'error: <script>alert(1)</script>' }));
  const { port, close } = await serveProxy(proxy);
  try {
    const res = await request(port, { host: `${token}.preview.localhost:${port}` });
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.body, /http-equiv="refresh"/);
    assert.doesNotMatch(res.body, /<script>/);
    assert.match(res.body, /<pre>error: &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/pre>/);
  } finally {
    await close();
  }
});

// Fake dev server that echoes what it received as JSON, and redirects on /redirect.
function echoUpstream() {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: `http://localhost:${server.address().port}/after?x=1` });
        return res.end();
      }
      res.writeHead(201, { 'content-type': 'application/json', 'set-cookie': ['a=1; Path=/', 'b=2'], 'x-upstream': 'yes' });
      res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => new Promise((done) => server.close(done)) }));
  });
}

test('server resolves proxy method, path, query, body and rewrite Host/Origin/Referer to localhost:<port>', async () => {
  const upstream = await echoUpstream();
  const proxy = new PreviewProxy({ domain: null });
  const token = proxy.register('ws', () => ({ kind: 'server', host: '127.0.0.1', port: upstream.port }));
  const { port, close } = await serveProxy(proxy);
  const previewHost = `${token}.preview.localhost:${port}`;
  try {
    const res = await request(port, {
      method: 'POST',
      path: '/api/thing?q=1&r=two',
      host: previewHost,
      headers: { 'content-type': 'text/plain', origin: `http://${previewHost}`, referer: `http://${previewHost}/page?x=y`, 'x-custom': 'kept', connection: 'keep-alive' },
      body: 'hello body'
    });
    assert.equal(res.status, 201);
    assert.equal(res.headers['x-upstream'], 'yes');
    assert.deepEqual(res.headers['set-cookie'], ['a=1; Path=/', 'b=2']);
    const seen = JSON.parse(res.body);
    assert.equal(seen.method, 'POST');
    assert.equal(seen.url, '/api/thing?q=1&r=two');
    assert.equal(seen.body, 'hello body');
    assert.equal(seen.headers.host, `localhost:${upstream.port}`);
    assert.equal(seen.headers.origin, `http://localhost:${upstream.port}`);
    assert.equal(seen.headers.referer, `http://localhost:${upstream.port}/page?x=y`);
    assert.equal(seen.headers['x-custom'], 'kept');
    assert.equal(seen.headers['content-type'], 'text/plain');
  } finally {
    await close();
    await upstream.close();
  }
});

test('Location headers pointing at the upstream are rewritten to the preview origin', async () => {
  const upstream = await echoUpstream();
  const proxy = new PreviewProxy({ domain: null });
  const token = proxy.register('ws', () => ({ kind: 'server', host: '127.0.0.1', port: upstream.port }));
  const { port, close } = await serveProxy(proxy);
  try {
    const res = await request(port, { host: `${token}.preview.localhost:${port}`, path: '/redirect' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, `http://${token}.preview.localhost:${port}/after?x=1`);
  } finally {
    await close();
    await upstream.close();
  }
});

test('an unreachable upstream yields a 502 page', async () => {
  const dead = await echoUpstream();
  await dead.close(); // port is now free and refuses connections
  const proxy = new PreviewProxy({ domain: null });
  const token = proxy.register('ws', () => ({ kind: 'server', host: '127.0.0.1', port: dead.port }));
  const { port, close } = await serveProxy(proxy);
  try {
    const res = await request(port, { host: `${token}.preview.localhost:${port}` });
    assert.equal(res.status, 502);
    assert.match(res.headers['content-type'], /text\/html/);
  } finally {
    await close();
  }
});

// Minimal RFC 6455 upstream: completes the handshake, records the request
// headers, and echoes every frame it receives byte-for-byte.
function wsUpstream() {
  const seen = {};
  const server = http.createServer((req, res) => {
    res.writeHead(426);
    res.end();
  });
  server.on('upgrade', (req, socket) => {
    seen.headers = req.headers;
    const accept = require('node:crypto').createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on('data', (chunk) => socket.write(chunk));
    socket.on('end', () => socket.end());
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, seen, close: () => new Promise((done) => server.close(done)) }));
  });
}

test('WebSocket upgrades are piped both ways with a rewritten Host', async () => {
  const upstream = await wsUpstream();
  const proxy = new PreviewProxy({ domain: null });
  const token = proxy.register('ws', () => ({ kind: 'server', host: '127.0.0.1', port: upstream.port }));
  const { port, close } = await serveProxy(proxy);
  const previewHost = `${token}.preview.localhost:${port}`;
  try {
    const socket = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: '/vite-hmr',
        headers: { host: previewHost, origin: `http://${previewHost}`, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' }
      });
      req.on('upgrade', (res, sock) => {
        assert.equal(res.statusCode, 101);
        assert.equal(res.headers['sec-websocket-accept'], 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
        resolve(sock);
      });
      req.on('response', (res) => reject(new Error(`unexpected ${res.statusCode}`)));
      req.on('error', reject);
      req.end();
    });
    assert.equal(upstream.seen.headers.host, `localhost:${upstream.port}`);
    assert.equal(upstream.seen.headers.origin, `http://localhost:${upstream.port}`);

    const frame = Buffer.from([0x81, 0x85, 0x01, 0x02, 0x03, 0x04, 0x69, 0x67, 0x6f, 0x68, 0x6e]); // masked "hello"
    const echoed = await new Promise((resolve) => {
      const chunks = [];
      socket.on('data', (c) => {
        chunks.push(c);
        if (Buffer.concat(chunks).length >= frame.length) resolve(Buffer.concat(chunks));
      });
      socket.write(frame);
    });
    assert.deepEqual(echoed, frame);
    socket.destroy();
  } finally {
    await close();
    await upstream.close();
  }
});

// A static root with an index, a nested asset, a symlink escaping the root,
// and a secret sibling outside the root.
async function staticFixture() {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'preview-proxy-'));
  const root = path.join(base, 'site');
  await fsp.mkdir(path.join(root, 'assets'), { recursive: true });
  await fsp.writeFile(path.join(root, 'index.html'), '<h1>hi</h1>');
  await fsp.writeFile(path.join(root, 'assets', 'app.js'), 'console.log(1)');
  await fsp.writeFile(path.join(root, 'assets', 'style.css'), 'body{}');
  await fsp.writeFile(path.join(root, 'font.woff2'), Buffer.from([0, 1, 2]));
  await fsp.writeFile(path.join(base, 'secret.txt'), 'top secret');
  await fsp.symlink(path.join(base, 'secret.txt'), path.join(root, 'leak.txt'));
  return { root, base, cleanup: () => fsp.rm(base, { recursive: true, force: true }) };
}

test('static resolves serve files under root with MIME types and no-store caching', async () => {
  const fixture = await staticFixture();
  const proxy = new PreviewProxy({ domain: null });
  const token = proxy.register('ws', () => ({ kind: 'static', root: fixture.root }));
  const { port, close } = await serveProxy(proxy);
  const host = `${token}.preview.localhost:${port}`;
  try {
    const index = await request(port, { host, path: '/' });
    assert.equal(index.status, 200);
    assert.equal(index.body, '<h1>hi</h1>');
    assert.match(index.headers['content-type'], /^text\/html/);
    assert.equal(index.headers['cache-control'], 'no-store');

    const dir = await request(port, { host, path: '/assets/../?x=1' });
    assert.equal(dir.status, 200);

    const js = await request(port, { host, path: '/assets/app.js?v=2' });
    assert.equal(js.body, 'console.log(1)');
    assert.match(js.headers['content-type'], /javascript/);
    assert.match((await request(port, { host, path: '/assets/style.css' })).headers['content-type'], /^text\/css/);
    assert.equal((await request(port, { host, path: '/font.woff2' })).headers['content-type'], 'font/woff2');

    const head = await request(port, { host, path: '/assets/app.js', method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-length'], '14');
    assert.equal(head.body, '');

    assert.equal((await request(port, { host, path: '/missing.html' })).status, 404);
    assert.equal((await request(port, { host, path: '/', method: 'POST' })).status, 405);
  } finally {
    await close();
    await fixture.cleanup();
  }
});

test('static resolves refuse every way out of the root', async () => {
  const fixture = await staticFixture();
  const proxy = new PreviewProxy({ domain: null });
  const token = proxy.register('ws', () => ({ kind: 'static', root: fixture.root }));
  const { port, close } = await serveProxy(proxy);
  const host = `${token}.preview.localhost:${port}`;
  try {
    for (const attempt of ['/../secret.txt', '/assets/../../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%2e%2e%2fsecret.txt', '/leak.txt', '/index.html%00.png']) {
      const res = await request(port, { host, path: attempt });
      assert.notEqual(res.status, 200, `${attempt} should not be served`);
      assert.doesNotMatch(res.body, /top secret/, `${attempt} leaked`);
    }
  } finally {
    await close();
    await fixture.cleanup();
  }
});
