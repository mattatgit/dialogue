const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { makeProject, sh } = require('./helpers/git-fixture.js');
const { WorkspaceRequests } = require('../server/requests.js');
const { conversationDir } = require('../server/conversation.js');

function pngFixture() {
  const { deflateSync } = require('node:zlib');
  const { randomFillSync } = require('node:crypto');
  const width = 640, height = 640;
  const pixels = randomFillSync(Buffer.alloc((width * 3 + 1) * height));
  for (let y=0;y<height;y++) pixels[y*(width*3+1)] = 0;
  const chunk = (name, data) => {
    const type = Buffer.from(name), bytes=Buffer.concat([type,data]); let crc=0xffffffff;
    for (const byte of bytes) { crc ^= byte; for(let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
    const out=Buffer.alloc(data.length+12); out.writeUInt32BE(data.length); type.copy(out,4); data.copy(out,8); out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4); return out;
  };
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}

// Real pinned OMP, disposable credentials and an in-process provider. No real
// account, inbox, provider key or remote model service is involved.
test('real OMP preserves complete discussion across annotations, reload, handoff and branches', { timeout: 90000 }, async () => {
  const fixture = await makeProject(); const seen = [], authHeaders = [];
  let referenceFile = null, requestedImage = false;
  const longReply = 'The cobalt penguin decision stays in this conversation.\n\n' + 'A complete architectural explanation. '.repeat(14) + '\n\n```js\nconst choice = "cobalt";\n```';
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      seen.push(JSON.parse(raw)); authHeaders.push(req.headers.authorization);
      const piece = (delta, finish_reason) => 'data: ' + JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'fake-model', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n';
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (referenceFile && !requestedImage && raw.includes('What did Matt decide earlier?')) {
        requestedImage = true;
        res.end(piece({ role: 'assistant', tool_calls: [{ index:0,id:'read-reference',type:'function',function:{name:'read',arguments:JSON.stringify({path:referenceFile})} }] }, null) + piece({}, 'tool_calls') + 'data: [DONE]\n\n');
      } else res.end(piece({ role: 'assistant', content: longReply }, null) + piece({}, 'stop') + 'data: [DONE]\n\n');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let home = path.join(fixture.root, 'matt');
  const setupHome = async dir => {
    const ext = path.join(dir, '.omp', 'agent', 'extensions'); await fs.mkdir(ext, { recursive: true });
    await fs.writeFile(path.join(ext, 'fake.js'), `export default function(pi){pi.registerProvider('fake-local',{baseUrl:'http://127.0.0.1:${server.address().port}/v1',apiKey:'${path.basename(dir)}-local-only',authHeader:true,api:'openai-completions',models:[{id:'fake-model',name:'Fake',reasoning:false,input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:8000}]});}`);
  };
  const options = { root: path.join(fixture.root, 'requests'), workspacesRoot: path.join(fixture.root, 'workspaces'), configPath: path.resolve(__dirname, '../omp/config.yml'),
    agent: { model: 'fake-local/fake-model', async check() { return { ready: true }; }, ompEnv() { return { HOME: home, PI_CODING_AGENT_DIR: path.join(home, '.omp', 'agent') }; } } };
  let manager = new WorkspaceRequests(options);
  const turn = async (workspace, feedback, actor, extra = {}) => {
    const accepted = await manager.start(workspace, fixture.repo, { feedback, ...extra }, actor);
    await manager.active.get(workspace.id).done;
    const record = manager.list(workspace.id).find(r => r.id === accepted.id);
    assert.equal(record.status, 'completed', record.error);
    assert.equal(record.reply, longReply); assert.equal(record.sessionStored, true);
    assert.equal(record.snapshotSha, undefined, 'discussion does not fabricate an edit snapshot');
    return record;
  };
  try {
    await setupHome(home); await manager.load();
    const workspace = await fixture.repo.ensureWorkspace('main');
    await turn(workspace, 'Remember the cobalt penguin architecture decision. Discuss only; do not edit files.', { id: 'matt', name: 'Matt' });
    assert.equal(await fs.readFile(path.join(workspace.dir, 'index.html'), 'utf8'), '<h1>hi</h1>');
    await manager.shutdown(); manager = new WorkspaceRequests(options); await manager.load();
    const referenceTurn = await turn(workspace, 'Explain how our earlier decision applies to this selection.', { id: 'matt', name: 'Matt' }, { anchor: { type: 'selection', selector: 'h1' }, attachments: [{ name: 'notes.txt', data: Buffer.from('Use rounded corners.').toString('base64') }, { name: 'reference.png', data: pngFixture().toString('base64') }] });
    const context = JSON.stringify(seen.at(-1).messages);
    assert.match(context, /Remember the cobalt penguin architecture decision/); assert.match(context, /complete architectural explanation/); assert.match(context, /Use rounded corners/);
    assert.equal(authHeaders.at(-1), 'Bearer matt-local-only');
    referenceFile = referenceTurn.attachments.find(f => f.name === 'reference.png').file;
    home = path.join(fixture.root, 'saori'); await setupHome(home);
    await turn(workspace, 'What did Matt decide earlier?', { id: 'saori', name: 'Saori' });
    assert.match(JSON.stringify(seen.at(-1).messages), /Explain how our earlier decision/);
    assert.equal(authHeaders.at(-1), 'Bearer saori-local-only', 'handoff uses the receiving member’s provider credentials');
    assert.ok(seen.at(-1).messages.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image_url')), 'the earlier reference image can be reopened after member handoff');
    sh(fixture.origin, 'branch', 'experiment'); await fixture.repo.fetch();
    const other = await fixture.repo.ensureWorkspace('experiment');
    await turn(other, 'Start a separate discussion about amber foxes.', { id: 'saori', name: 'Saori' });
    assert.ok(!JSON.stringify(seen.at(-1).messages).includes('Remember the cobalt penguin architecture decision'), 'branch contexts stay separate');
    assert.notEqual(conversationDir(options.root, workspace.id), conversationDir(options.root, other.id));
  } finally { await manager.shutdown(); server.close(); await fixture.cleanup(); }
});
