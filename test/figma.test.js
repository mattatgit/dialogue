const test = require('node:test');
const assert = require('node:assert/strict');
const { FigmaError, parseFigmaUrl, readFigma, exportFigmaAsset } = require('../server/figma.js');

const fileUrl = 'https://www.figma.com/design/AbC123/My-Design?t=share-secret';
const nodeUrl = 'https://figma.com/file/AbC123/My-Design?node-id=10-24&m=dev';
const token = 'test-server-only-token';

test('file and node links canonicalize; malformed links never reach the network', async () => {
  assert.deepEqual(parseFigmaUrl(fileUrl), {
    url: 'https://www.figma.com/design/AbC123', fileKey: 'AbC123', nodeId: null
  });
  assert.deepEqual(parseFigmaUrl(nodeUrl), {
    url: 'https://www.figma.com/file/AbC123?node-id=10-24', fileKey: 'AbC123', nodeId: '10:24'
  });
  assert.equal(parseFigmaUrl('https://www.figma.com/design/AbC123?node-id=10%3A24').nodeId, '10:24');
  let calls = 0;
  for (const invalid of [
    'https://figma.com.evil.test/design/AbC123', 'https://www.figma.com@evil.test/design/AbC123',
    'http://www.figma.com/design/AbC123', 'https://api.figma.com/v1/files/AbC123',
    'https://www.figma.com:444/design/AbC123', 'https://www.figma.com/proto/AbC123',
    'https://www.figma.com/design/AbC123/../../file/Elsewhere',
    'https://www.figma.com/design/AbC123/%2e%2e', 'https://www.figma.com/design/AbC123/%2felsewhere',
    'https://www.figma.com/design/AbC123?node-id=1-2&node-id=3-4',
    'https://www.figma.com/design/AbC123?node-id=not-a-node'
  ]) {
    await assert.rejects(readFigma(invalid, { token, fetchImpl: () => { calls++; } }),
      (error) => error instanceof FigmaError && error.status === 400, invalid);
  }
  assert.equal(calls, 0);
});

test('file requests return page/frame outline, node requests fetch full tree without a depth limit', async () => {
  const outline = { name: 'Design', document: { children: [{ name: 'Page', children: [{ id: '10:24', name: 'Frame' }] }] } };
  const frame = { nodes: { '10:24': { document: { children: [{ children: [{ name: 'deep layer' }] }] } } } };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(url.includes('/nodes?') ? frame : outline));
  };
  assert.deepEqual((await readFigma(fileUrl, { token, fetchImpl })).data, outline);
  assert.deepEqual((await readFigma(nodeUrl, { token, fetchImpl })).data, frame);
  assert.deepEqual(calls.map(({ url }) => url), [
    'https://api.figma.com/v1/files/AbC123?depth=2',
    'https://api.figma.com/v1/files/AbC123/nodes?ids=10%3A24'
  ]);
  for (const { options } of calls) {
    assert.equal(options.method, 'GET');
    assert.equal(options.headers['X-Figma-Token'], token);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test('missing token, rejected permissions, missing nodes and rate limits return safe statuses', async () => {
  let calls = 0;
  await assert.rejects(readFigma(fileUrl, { token: '', fetchImpl: () => { calls++; } }),
    (error) => error.status === 503 && /FIGMA_ACCESS_TOKEN/.test(error.message));
  assert.equal(calls, 0);
  await assert.rejects(readFigma(fileUrl, {
    token, fetchImpl: async () => new Response('private raw response', { status: 403 })
  }), (error) => error.status === 403 && !error.message.includes('private raw response'));
  await assert.rejects(readFigma(nodeUrl, {
    token, fetchImpl: async () => new Response(JSON.stringify({ nodes: {} }))
  }), (error) => error.status === 404);
  await assert.rejects(readFigma(fileUrl, {
    token, fetchImpl: async () => new Response('opaque', { status: 429, headers: { 'Retry-After': '45' } })
  }), (error) => error.status === 429 && /Retry after 45 seconds/.test(error.message));
});

test('large Figma responses are canceled before buffering or when crossing the byte cap', async () => {
  let canceled = false;
  const body = new ReadableStream({ cancel() { canceled = true; } });
  await assert.rejects(readFigma(fileUrl, {
    token, fetchImpl: async () => new Response(body, { headers: { 'Content-Length': String(32 * 1024 * 1024 + 1) } })
  }), (error) => error.status === 502 && /too large/.test(error.message));
  assert.equal(canceled, true);
  canceled = false;
  let emitted = 0;
  const chunk = new Uint8Array(1024 * 1024);
  await assert.rejects(readFigma(fileUrl, {
    token, fetchImpl: async () => new Response(new ReadableStream({
      pull(controller) { emitted++; controller.enqueue(chunk); },
      cancel() { canceled = true; }
    }, { highWaterMark: 0 }))
  }), (error) => error.status === 502 && /too large/.test(error.message));
  assert.equal(emitted, 33);
  assert.equal(canceled, true);
});

test('configured SVG and PNG exports fetch bytes without passing the credential to the asset host', async () => {
  const assetHost = 'https://figma-alpha-api.s3.us-west-2.amazonaws.com';
  const calls = [];
  for (const [format, scale, nodeId, body, mime] of [
    ['svg', 1, '10:24', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml'],
    ['png', 2, 'I10:24;20:30', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]), 'image/png']
  ]) {
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      return url.startsWith('https://api.figma.com/')
        ? new Response(JSON.stringify({ images: { [nodeId]: `${assetHost}/rendered` } }))
        : new Response(body, { headers: { 'Content-Type': mime } });
    };
    const result = await exportFigmaAsset('AbC123', nodeId, format, scale, { token, fetchImpl });
    assert.equal(result.contentType, mime);
    assert.deepEqual(result.bytes, Buffer.from(body));
  }
  assert.equal(calls.length, 4);
  assert.equal(calls[0].url, 'https://api.figma.com/v1/images/AbC123?ids=10%3A24&format=svg&scale=1');
  assert.equal(calls[2].url, 'https://api.figma.com/v1/images/AbC123?ids=I10%3A24%3B20%3A30&format=png&scale=2');
  for (const call of [calls[0], calls[2]]) {
    assert.equal(call.options.headers['X-Figma-Token'], token);
    assert.equal(call.options.redirect, 'error');
  }
  for (const call of [calls[1], calls[3]]) {
    assert.equal(call.url, `${assetHost}/rendered`);
    assert.equal(call.options.headers, undefined);
    assert.equal(call.options.redirect, 'error');
  }
});

test('exports reject untrusted download URLs, unrenderable nodes and unsafe asset bodies', async () => {
  const assetHost = 'https://figma-alpha-api.s3.us-west-2.amazonaws.com';
  let downloads = 0;
  for (const returned of ['http://127.0.0.1/secret', 'https://figma-alpha-api.s3.us-west-2.amazonaws.com.evil.test/a']) {
    await assert.rejects(exportFigmaAsset('AbC123', '10:24', 'svg', 1, {
      token, fetchImpl: async () => new Response(JSON.stringify({ images: { '10:24': returned } }))
    }), { status: 502 });
  }
  await assert.rejects(exportFigmaAsset('AbC123', '10:24', 'svg', 1, {
    token, fetchImpl: async () => new Response(JSON.stringify({ images: { '10:24': null } }))
  }), (error) => error.status === 502 && /could not render/.test(error.message));
  for (const response of [
    new Response('html', { headers: { 'Content-Type': 'text/html' } }),
    new Response('not a png', { headers: { 'Content-Type': 'image/png' } }),
    new Response('large', { headers: { 'Content-Type': 'image/png', 'Content-Length': String(16 * 1024 * 1024 + 1) } })
  ]) {
    await assert.rejects(exportFigmaAsset('AbC123', '10:24', 'png', 1, {
      token, fetchImpl: async (url) => url.startsWith('https://api.figma.com/')
        ? new Response(JSON.stringify({ images: { '10:24': `${assetHost}/rendered` } }))
        : (downloads++, response)
    }), { status: 502 });
  }
  assert.equal(downloads, 3);
});
