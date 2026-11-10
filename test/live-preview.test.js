const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { LivePreviews } = require('../server/live-preview.js');
const { PreviewProxy } = require('../server/preview-proxy.js');

test('a workspace opened before setup finished starts its preview once the project gets a recipe', { timeout: 10000 }, async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dialogue-live-'));
  await fsp.writeFile(path.join(dir, 'index.html'), 'hi');
  let recipe = null; // what the default branch carries, as setup would commit it
  const repo = { readRecipe: async () => (recipe ? { text: recipe, source: 'default' } : null) };
  const live = new LivePreviews({ proxy: new PreviewProxy(), previews: { available: false }, stampsRoot: dir, internalPort: 1 });
  const states = [];
  const release = await live.open('o-app/feature', { slug: 'o-app', ref: 'feature', dir, repo, isDefault: false, head: async () => null }, (payload) => states.push(payload.state));
  try {
    assert.equal(states.at(-1), 'no-recipe');
    recipe = '{"version":1,"kind":"static"}';
    await live.projectRecipeChanged('o-app');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(states.at(-1), 'ready');
  } finally {
    release();
    await live.shutdown();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('isolated previews stop at the final viewer while shared viewers retain their preview', async t => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dialogue-live-release-'));
  t.after(() => fsp.rm(dir, {recursive:true,force:true})); await fsp.writeFile(path.join(dir, 'index.html'), 'hi');
  const repo = {readRecipe:async()=>({text:'{"version":1,"kind":"static"}',source:'workspace'})};
  const live = new LivePreviews({proxy:new PreviewProxy(),previews:{available:false},stampsRoot:dir,internalPort:1,runtime:{isolated:true}});
  t.after(()=>live.shutdown());
  const context = {slug:'o-app',ref:'main',dir,repo,isDefault:false,head:async()=>null};
  const a=await live.open('o-app/main',context,()=>{}); const b=await live.open('o-app/main',context,()=>{});
  const ready = async runner => { for(let i=0;i<100;i++){if(runner.state==='ready')return;await new Promise(r=>setTimeout(r,10));} throw new Error('Preview did not become ready'); };
  const runner=live.pool.get('o-app/main'); await ready(runner);
  assert.equal(runner.state,'ready'); a(); assert.equal(live.pool.get('o-app/main'),runner);
  b(); await new Promise(r=>setImmediate(r)); assert.equal(live.pool.get('o-app/main'),undefined);assert.equal(runner.state,'stopped');
  await live.filesChanged('o-app/main');assert.equal(live.pool.get('o-app/main'),undefined,'conversation-only changes do not restart a hidden preview');
  const again=await live.open('o-app/main',context,()=>{});await ready(live.pool.get('o-app/main'));assert.equal(live.pool.get('o-app/main').state,'ready');again();
});

test('verification release and close await the same cleanup before a replacement can own the preview', async t => {
  const {Runner}=require('../server/runner.js');
  const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'dialogue-live-handoff-'));await fsp.writeFile(path.join(dir,'index.html'),'verified');
  const runtime={isolated:true,previewOwners:new Map()},repo={readRecipe:async()=>({text:'{"version":1,"kind":"static"}'})};
  const live=new LivePreviews({proxy:new PreviewProxy(),previews:{available:false},stampsRoot:dir,internalPort:1,runtime,createRunner:options=>new Runner(options)});
  let unblock;const cleanup=new Promise(r=>unblock=r);t.after(async()=>{unblock();await live.shutdown();await fsp.rm(dir,{recursive:true,force:true});});
  const id='build-one/main',context={slug:'build-one',ref:'main',dir,repo,isDefault:false,head:async()=>null};
  const verification=await live.open(id,context,()=>{});const old=live.entries.get(id).runner;await old.starting;old.logWrite=cleanup;
  verification();let closed=false;const closing=live.close(id).then(()=>closed=true);
  await new Promise(r=>setImmediate(r));assert.equal(closed,false,'close must await cleanup already started by the last viewer release');
  const viewer=await live.open(id,context,()=>{}),next=live.entries.get(id).runner;await new Promise(r=>setImmediate(r));assert.equal(runtime.previewOwners.get(dir),old,'ownership remains with the closing runner');
  unblock();await closing;await next.starting;assert.equal(next.state,'ready');assert.equal(runtime.previewOwners.get(dir),next);viewer();await live.shutdown();assert.equal(runtime.previewOwners.size,0);assert.equal(live.pool.closing.size,0);
});
