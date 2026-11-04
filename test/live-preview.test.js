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
