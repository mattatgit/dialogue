const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { PreviewRenderer, WIDTH, HEIGHT } = require('../server/preview.js');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

async function tempRoot() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'dialogue-previews-'));
}

function pngSize(buffer) {
  assert.equal(buffer.subarray(1, 4).toString(), 'PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('capture screenshots a URL into every requested file at device size', { timeout: 60000 }, async (t) => {
  const root = await tempRoot();
  const renderer = new PreviewRenderer(root);
  if (!renderer.available) return t.skip('no Chromium on this machine');
  const server = http.createServer((req, res) => res.end('<body style="background:#f00">served</body>'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    await renderer.capture(url, [renderer.file('proj', SHA_A), renderer.mainFile('proj')]);
    for (const file of [renderer.file('proj', SHA_A), renderer.mainFile('proj')]) {
      assert.deepEqual(pngSize(await fsp.readFile(file)), { width: WIDTH, height: HEIGHT });
    }
  } finally {
    server.close();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('lookup returns the exact commit image, else the latest main image, else null', async () => {
  const root = await tempRoot();
  const renderer = new PreviewRenderer(root);
  try {
    assert.equal(await renderer.lookup('proj', SHA_A), null);
    await fsp.mkdir(path.join(root, 'proj'));
    await fsp.writeFile(renderer.mainFile('proj'), 'main');
    assert.deepEqual(await renderer.lookup('proj', SHA_A), { file: renderer.mainFile('proj'), exact: false });
    await fsp.writeFile(renderer.file('proj', SHA_A), 'a');
    assert.deepEqual(await renderer.lookup('proj', SHA_A), { file: renderer.file('proj', SHA_A), exact: true });
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('prune drops unreferenced commit images but keeps the main image', async () => {
  const root = await tempRoot();
  const renderer = new PreviewRenderer(root);
  try {
    await fsp.mkdir(path.join(root, 'proj'));
    for (const file of [renderer.file('proj', SHA_A), renderer.file('proj', SHA_B), renderer.mainFile('proj')]) await fsp.writeFile(file, 'x');
    await renderer.prune('proj', [SHA_B]);
    assert.deepEqual((await fsp.readdir(path.join(root, 'proj'))).sort(), [`${SHA_B}.png`, 'main.png']);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
