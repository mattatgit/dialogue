const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { WatchRegistry } = require('../server/watch.js');

function fakeResponse() {
  const res = new EventEmitter();
  res.write = () => {};
  res.end = () => res.emit('close');
  return res;
}

function nextChange(changes) {
  return new Promise((resolve) => changes.once('change', resolve));
}

test('file roots report file changes; meta roots only state changes; non-recursive roots ignore subdirectories', { timeout: 5000 }, async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dialogue-watch-'));
  await fsp.mkdir(path.join(dir, 'src'));
  await fsp.mkdir(path.join(dir, 'skipped'));
  await fsp.mkdir(path.join(dir, 'git'));
  const changes = new EventEmitter();
  const registry = new WatchRegistry();
  const res = fakeResponse();
  registry.subscribe('w', [
    { path: dir, recursive: false, files: true },
    { path: path.join(dir, 'src'), recursive: true, files: true },
    { path: path.join(dir, 'git'), recursive: true, files: false }
  ], res, (_watcher, files) => changes.emit('change', files));
  try {
    let change = nextChange(changes);
    await fsp.writeFile(path.join(dir, 'git', 'HEAD'), 'x');
    assert.equal(await change, false);

    change = nextChange(changes);
    await fsp.mkdir(path.join(dir, 'src', 'deep'));
    await fsp.writeFile(path.join(dir, 'src', 'deep', 'a.js'), 'x');
    assert.equal(await change, true);

    let fired = false;
    changes.once('change', () => { fired = true; });
    await fsp.writeFile(path.join(dir, 'skipped', 'b.js'), 'x');
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(fired, false);
  } finally {
    res.end();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
