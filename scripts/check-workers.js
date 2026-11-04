// Mandatory target-Linux acceptance. Run in the named, unprivileged user
// service described in docs/WORKERS.md. Never run against production app data.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { once } = require('node:events');
const { Workers, workerConfig, killWorker } = require('../server/workers.js');
const { PreviewRenderer } = require('../server/preview.js');
const { readProjectFile } = require('../server/project-files.js');
const exec = promisify(execFile);

async function workerReady(child) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Worker did not become ready.')), 15000);
    const data = () => finish();
    const close = () => finish(new Error('Worker exited before becoming ready.'));
    const error = failure => finish(failure);
    function finish(failure) {
      clearTimeout(timer); child.stdout.off('data', data); child.off('close', close); child.off('error', error);
      failure ? reject(failure) : resolve();
    }
    child.stdout.once('data', data); child.once('close', close); child.once('error', error);
  });
}

async function main() {
  if (process.platform !== 'linux' || process.getuid() === 0) throw new Error('Run this check as the unprivileged Linux app user, inside its check service.');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dialogue-isolation-check-')));
  const runtime = new Workers({ dataRoot: root, appRoot: path.resolve(__dirname, '..'), config: workerConfig({ ...process.env, DIALOGUE_MODE: 'production', NODE_ENV: 'production' }) });
  const dir = path.join(root, 'workspaces', 'check', 'main');
  const home = path.join(root, 'users', 'matt', 'home'); const otherHome = path.join(root, 'users', 'saori', 'home');
  const privateFile = path.join(root, 'accounts.sqlite');
  let server;
  try {
    await fs.mkdir(path.dirname(dir), { recursive: true }); await fs.mkdir(home, { recursive: true }); await fs.mkdir(otherHome, { recursive: true });
    await fs.writeFile(privateFile, 'app-private-canary'); await fs.writeFile(path.join(otherHome, 'credential'), 'other-private-canary'); await fs.writeFile(path.join(home, 'credential'), 'own-profile-canary');
    const bare = path.join(root, 'repos', 'check.git'); await fs.mkdir(path.dirname(bare));
    const git = async args => (await exec(process.env.DIALOGUE_GIT || 'git', args)).stdout.trim();
    await git(['init', '--bare', bare]);
    const tree = await git(['--git-dir', bare, 'hash-object', '-w', '-t', 'tree', '/dev/null']);
    const commit = await git(['--git-dir', bare, '-c', 'user.name=Dialogue check', '-c', 'user.email=check@example.test', 'commit-tree', tree, '-m', 'Isolated test fixture']);
    await git(['--git-dir', bare, 'worktree', 'add', '--detach', dir, commit]);
    await fs.symlink(privateFile, path.join(dir, 'escape-link'));
    await runtime.assertReady(); console.log('PASS: namespace and kernel cgroup limits');
    const run = (code, kind = 'agent') => runtime.run(process.execPath, ['-e', code], { cwd: dir, env: { ...process.env, APP_TEST_SECRET: 'must-not-leak' }, timeout: 15000 }, { kind, home });
    await run(`const f=require('fs'),a=require('assert/strict');a.equal(f.readFileSync(${JSON.stringify(path.join(home, 'credential'))},'utf8'),'own-profile-canary');for(const p of ${JSON.stringify([privateFile, path.join(otherHome, 'credential'), path.join(dir, 'escape-link'), '/etc/dialogue/mail.env', '/etc/dialogue-backup', '/run/systemd', '/sys/fs/cgroup'])})a.throws(()=>f.readFileSync(p));a.equal(process.env.APP_TEST_SECRET,undefined);a.throws(()=>f.writeFileSync(${JSON.stringify(path.join(bare, 'config'))},'changed'));f.writeFileSync('worker-file','changed');`);
    assert.equal(await fs.readFile(path.join(dir, 'worker-file'), 'utf8'), 'changed'); console.log('PASS: selected checkout is writable; app data, other member credentials, management sockets and Git metadata are inaccessible');
    await fs.writeFile(path.join(dir, 'safe-text'), 'safe');
    const race = await runtime.spawn(process.execPath, ['-e', `const f=require('fs');let flip=false;console.log('ready');setInterval(()=>{try{f.unlinkSync('race-tmp')}catch{};f.symlinkSync(flip?'safe-text':${JSON.stringify(privateFile)},'race-tmp');f.renameSync('race-tmp','race-link');flip=!flip;},1);`], { cwd: dir, env: {}, stdio: ['ignore', 'pipe', 'pipe'] }, { kind: 'agent', home });
    await workerReady(race);
    for (let i = 0; i < 200; i++) { let bytes; try { bytes = await readProjectFile(dir, path.join(dir, 'race-link')); } catch { continue; } assert.equal(bytes.toString(), 'safe'); }
    const racedone = once(race, 'close'); await killWorker(race, 'SIGKILL'); await racedone;
    console.log('PASS: concurrent project symlink replacement cannot trick host file reads');
    await run(`const f=require('fs'),a=require('assert/strict');a.throws(()=>f.readFileSync(${JSON.stringify(path.join(home, 'credential'))}));a.equal(process.env.HOME,'/home/worker');`, 'preview');
    console.log('PASS: preview worker has no provider home');
    for (const [bin, args] of [[process.env.DIALOGUE_OMP || 'omp', ['--version']], [process.env.DIALOGUE_TMUX || 'tmux', ['-V']], [process.env.DIALOGUE_TTYD || 'ttyd', ['--version']]]) {
      await runtime.run(bin, args, { cwd: dir, env: {}, timeout: 15000 }, { kind: 'control', home });
    }
    console.log('PASS: OMP, tmux and ttyd execute inside the namespace');
    const survivor = await runtime.spawn(process.execPath, ['-e', `require('child_process').spawn('/bin/sleep',['60'],{detached:true,stdio:'ignore'}).unref();console.log('spawned');setInterval(()=>{},1000);`], { cwd: dir, env: {}, stdio: ['ignore', 'pipe', 'pipe'] }, { kind: 'agent', home });
    await workerReady(survivor); const closed = once(survivor, 'close'); await killWorker(survivor, 'SIGKILL'); await closed;
    await exec(runtime.config.systemctl, ['--user', 'stop', survivor.workerUnit]).catch(error => { if (!/not loaded|not found|could not be found/i.test(error.stderr || '')) throw error; });
    console.log('PASS: cancellation stops the entire scope, including detached descendants');
    await assert.rejects(run(`const keep=[];setInterval(()=>keep.push(Buffer.alloc(8*1024*1024,7)),2);`, 'control'));
    await run('console.log("still healthy")', 'control'); console.log('PASS: worker memory exhaustion does not stop the parent; subsequent work succeeds');
    await run(`const c=require('child_process');let errors=0;for(let i=0;i<70;i++){const p=c.spawn('/bin/sleep',['10'],{stdio:'ignore'});p.on('error',()=>errors++);}setTimeout(()=>process.exit(errors>0?0:2),500);`, 'control');
    console.log('PASS: process limit rejects excess descendants');
    const shotDir = await runtime.directory('browser');
    const renderer = new PreviewRenderer(path.join(root, 'previews'), { runtime });
    if (!renderer.available) throw new Error('Provide a namespace-compatible Chromium/headless-shell for acceptance.');
    server = http.createServer((_req, res) => res.end('<!doctype html><title>Worker check</title><p>Isolated screenshot</p>'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const shot = path.join(shotDir, 'check.png'); await renderer.capture(`http://127.0.0.1:${server.address().port}/`, [shot]);
    assert.ok((await fs.stat(shot)).size > 100); console.log('PASS: Chromium screenshot through loopback with no app/credential mounts');
    console.log('ALL LINUX WORKER CHECKS PASSED');
  } finally {
    server?.close(); await runtime.shutdown(); await fs.rm(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error('WORKER CHECK FAILED:', error.message); process.exitCode = 1; });
