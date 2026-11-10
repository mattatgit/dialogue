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
const { Workers, workerConfig, killWorker, PROFILES } = require('../server/workers.js');
const { PreviewRenderer } = require('../server/preview.js');
const { readProjectFile } = require('../server/project-files.js');
const { sessionArgs, readReply } = require('../server/conversation.js');
const { AgentAuth } = require('../server/agent-auth.js');
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
  let server, provider, passed = false;
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
    await run(`const n=require('net');const s=n.createServer();s.on('error',e=>{if(!['EACCES','EPERM'].includes(e.code))process.exit(3);console.log('listener denied')});s.listen(0,'127.0.0.1',()=>process.exit(2));`);
    console.log('PASS: agent and all descendants cannot listen; outbound provider traffic remains permitted');
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
    const sessionDir = path.join(root, 'requests', '.sessions', 'check');
    const attachmentDir = path.join(root, 'requests', '.attachments', 'check');
    const replyFile = path.join(root, 'requests', '.replies', 'check.json');
    for (const folder of [sessionDir, attachmentDir, path.dirname(replyFile)]) await fs.mkdir(folder, { recursive: true });
    const attachment = path.join(attachmentDir, 'notes.txt'); await fs.writeFile(attachment, 'retained design notes');
    await fs.writeFile(replyFile, '{}');
    const policy = { kind: 'agent', home, sessionDir, attachmentDir, replyFile, readOnlyWorkspace: true };
    await runtime.run(process.execPath, ['-e', `const f=require('fs'),a=require('assert/strict');a.throws(()=>f.writeFileSync('worker-file','forbidden'));a.equal(f.readFileSync(${JSON.stringify(attachment)},'utf8'),'retained design notes');a.throws(()=>f.writeFileSync(${JSON.stringify(attachment)},'forbidden'));f.writeFileSync(${JSON.stringify(path.join(sessionDir, 'canary'))},'own session');f.writeFileSync(${JSON.stringify(replyFile)},'{}');`], { cwd: dir, env: {}, timeout: 15000 }, policy);
    console.log('PASS: selected conversation session/reply are writable; checkout and branch attachments can be read-only');
    const readOnlyCwd = path.join(root, 'workspaces', '.read-only', 'check'); await fs.mkdir(readOnlyCwd, { recursive: true });
    await runtime.run(process.execPath, ['-e', `const f=require('fs'),a=require('assert/strict');a.equal(process.cwd(),${JSON.stringify(readOnlyCwd)});a.equal(f.readFileSync(${JSON.stringify(path.join(dir,'safe-text'))},'utf8'),'safe');a.throws(()=>f.writeFileSync(${JSON.stringify(path.join(dir,'safe-text'))},'forbidden'));a.throws(()=>f.writeFileSync('project-script','forbidden'));a.throws(()=>f.readFileSync(${JSON.stringify(privateFile)}));`], { cwd: readOnlyCwd, env: {}, timeout: 15000 }, { ...policy, sourceRoot: dir });
    console.log('PASS: read-only agent starts outside project configuration; selected source is mounted separately and cannot be changed');
    const modelCalls = [];
    provider = http.createServer((req, res) => {
      let raw = ''; req.on('data', chunk => { raw += chunk; }); req.on('end', () => {
        modelCalls.push(JSON.parse(raw));
        const frame = (delta, finish_reason) => 'data: ' + JSON.stringify({ id: 'check', object: 'chat.completion.chunk', model: 'fake', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n';
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(frame({ role: 'assistant', content: 'The cobalt penguin decision persists.\n\nA complete user-facing reply.' }, null) + frame({}, 'stop') + 'data: [DONE]\n\n');
      });
    });
    await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
    const extension = path.join(dir, 'acceptance-provider.js');
    await fs.writeFile(extension, `export default function(pi){pi.registerProvider('dialogue-check',{baseUrl:'http://127.0.0.1:${provider.address().port}/v1',apiKey:'fake-local-only',api:'openai-completions',models:[{id:'fake',name:'Check',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1000}]});}`);
    for (let turn = 0; turn < 2; turn++) {
      const args = ['-p', '--no-tools', '--no-skills', '--no-rules', '--no-extensions', '-e', extension, '-e', path.resolve(__dirname, '../omp/conversation.js'), ...await sessionArgs(sessionDir, turn > 0), '--model', 'dialogue-check/fake', turn ? 'Explain the earlier decision.' : 'Remember the cobalt penguin decision.'];
      const started = Date.now();
      try {
        await runtime.run(process.env.DIALOGUE_OMP || 'omp', args, { cwd: dir, env: { DIALOGUE_REPLY_FILE: replyFile }, timeout: 30000 }, { ...policy, home: turn ? otherHome : home });
      } catch (error) { throw new Error(`Native conversation turn ${turn + 1} failed after ${Date.now() - started} ms (${modelCalls.length} provider calls): ${error.message}`); }
      assert.ok((await readReply(replyFile))?.text.includes('complete user-facing reply'));
    }
    assert.ok(JSON.stringify(modelCalls.at(-1).messages).includes('Remember the cobalt penguin decision.'));
    console.log('PASS: real isolated OMP retains branch conversation and complete replies across member homes');
    // --version does not initialize the provider/RPC runtime. Exercise the
    // actual Settings catalog path with disposable credentials under its cap.
    const extensions = path.join(home, '.omp', 'agent', 'extensions');
    await fs.mkdir(extensions, { recursive: true });
    await fs.copyFile(extension, path.join(extensions, 'acceptance-provider.js'));
    const auth = new AgentAuth({ dataRoot: path.dirname(home), appRoot: path.resolve(__dirname, '..'), env: { HOME: home }, runtime });
    let models;
    try { models = await auth.models(); }
    catch (error) { throw new Error(`Native provider RPC failed under its ${PROFILES.provider.memory} MiB limit: ${error.message}`); }
    assert.ok(models.some(model => model.id === 'dialogue-check/fake'));
    console.log('PASS: real isolated provider RPC initializes and lists a model under the provider memory limit');
    provider.close(); provider = null;
    const survivor = await runtime.spawn(process.execPath, ['-e', `require('child_process').spawn('/bin/sleep',['60'],{detached:true,stdio:'ignore'}).unref();console.log('spawned');setInterval(()=>{},1000);`], { cwd: dir, env: {}, stdio: ['ignore', 'pipe', 'pipe'] }, { kind: 'agent', home });
    await workerReady(survivor); const closed = once(survivor, 'close'); await killWorker(survivor, 'SIGKILL'); await closed;
    await exec(runtime.config.systemctl, ['--user', 'stop', survivor.workerUnit]).catch(error => { if (!/not loaded|not found|could not be found/i.test(error.stderr || '')) throw error; });
    console.log('PASS: cancellation stops the entire scope, including detached descendants');
    const completedParent = await runtime.spawn(process.execPath,['-e',`require('child_process').spawn('/bin/sleep',['60'],{stdio:'inherit'}).unref();console.log('ready');process.exit(0);`],{cwd:dir,env:{},stdio:['ignore','pipe','pipe']},{kind:'agent',home});
    await workerReady(completedParent);await completedParent.workerFinished;
    assert.equal(runtime.children.has(completedParent),false);console.log('PASS: normal parent completion reaps descendants holding inherited output pipes');
    await assert.rejects(run(`const keep=[];setInterval(()=>keep.push(Buffer.alloc(8*1024*1024,7)),2);`, 'control'), /memory limit/);
    const records = await fs.readdir(path.join(root,'workers','records'));
    const evidence = await Promise.all(records.map(name=>fs.readFile(path.join(root,'workers','records',name),'utf8').then(JSON.parse)));
    assert.ok(evidence.some(record=>record.kind==='control' && record.outcome==='memory-limit' && record.measured && record.peakBytes>0));
    console.log('PASS: attributed whole-cgroup peak and OOM evidence retained before cleanup');
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
    console.log('ALL LINUX WORKER CHECKS PASSED'); passed = true;
  } finally {
    provider?.close(); server?.close(); await runtime.shutdown();
    if (passed && process.env.DIALOGUE_RETAIN_WORKER_CHECKS !== '1') await fs.rm(root, {recursive:true,force:true});
    else console.log('RETAINED_NATIVE_WORKER_ROOT',root);
  }
}
main().catch(error => { console.error('WORKER CHECK FAILED:', error.message); process.exitCode = 1; });
