import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID_DEFAULTS, gridSettings, stageGeometry, rectFromPoints, safeSelection, reloadTarget, chronological } from '../js/review-model.mjs';
import { MockReviewAdapter } from '../js/review-adapter.mjs';
const memory = () => { const entries = new Map(); return { getItem:k=>entries.get(k), setItem:(k,v)=>entries.set(k,v) }; };
const base = {id:'real-revision',version:'V23.18',createdAt:'2026-01-01',entryPoint:'index.html',project:{slug:'landline'},prototype:{id:'prototype'}};
const input = {base,feedback:'Make the heading smaller',anchor:{type:'area',rect:{x:0,y:0,width:80,height:40}}};
async function settled(adapter) { for(let i=0;i<100 && adapter.isBusy;i++) await new Promise(r=>setTimeout(r,5)); assert.equal(adapter.isBusy,false); }

test('grid defaults are 8 design pixels, Figma blue, 50% opacity',()=>assert.deepEqual(gridSettings(),GRID_DEFAULTS));
test('grid input is bounded and colour cannot inject CSS',()=>{
  const result=gridSettings({size:1000,opacity:-1,color:'url(evil)',enabled:true});
  assert.deepEqual(result,{size:64,opacity:0,color:'#BAE6FF',enabled:true});
});
test('grid remains registered to actual UI top-left across viewport changes',()=>{
  for (const size of [[1152,936],[700,600],[375,500]]) {
    const g=stageGeometry(...size,{width:370,height:722},{x:25,y:25,width:320,height:672});
    assert.equal(g.gridX,g.x+25*g.scale); assert.equal(g.gridY,g.y+25*g.scale);
    assert.ok(g.scale<=1 && g.scale>=.25);
  }
});
test('rectangle capture works in every drag direction',()=>assert.deepEqual(rectFromPoints({x:90,y:70},{x:10,y:20}),{x:10,y:20,width:80,height:50}));
test('untrusted selection rejects nonfinite geometry and bounds text',()=>{
  assert.equal(safeSelection({rect:{x:NaN,y:0,width:2,height:2}}),null);
  const s=safeSelection({rect:{x:1,y:1,width:4,height:4},selector:'x'.repeat(2000),text:'t'.repeat(500),value:'secret'});
  assert.equal(s.selector.length,1000); assert.equal(s.text.length,240); assert.equal(s.value,undefined);
});
test('revision order uses timestamps, not decimal-looking version numbers',()=>{
  const revisions=[{id:'a',version:'V99',createdAt:'2026-01-01'},{id:'b',version:'V23.18',createdAt:'2026-01-02'}];
  assert.equal(chronological(revisions)[0].id,'b'); assert.equal(reloadTarget(revisions,'a').id,'b'); assert.equal(reloadTarget(revisions,'b'),null);
});
test('simulation creates a labelled output without mutating its base',async()=>{
  const adapter=new MockReviewAdapter('p',memory(),2), copy=structuredClone(input);
  const request=await adapter.createRequest(input); assert.equal(request.result,null);
  await settled(adapter); const result=adapter.listRevisions()[0];
  assert.equal(result.simulated,true); assert.equal(result.sourceRevisionId,base.id); assert.match(result.version,/^Demo /);
  assert.deepEqual(input,copy); assert.equal(adapter.listRequests()[0].status,'complete'); adapter.dispose();
});
test('failure leaves no output badge; retry returns a simulated result',async()=>{
  const adapter=new MockReviewAdapter('p',memory(),2);
  const r=await adapter.createRequest({...input,scenario:'failure'}); await settled(adapter);
  assert.equal(adapter.listRequests()[0].status,'failed'); assert.deepEqual(adapter.listRevisions(),[]);
  adapter.retry(r.id); await settled(adapter); assert.equal(adapter.listRevisions().length,1); adapter.dispose();
});
test('cancellation does not manufacture a published revision',async()=>{
  const adapter=new MockReviewAdapter('p',memory(),100);
  const r=await adapter.createRequest(input); adapter.cancel(r.id); await settled(adapter);
  assert.equal(adapter.listRequests()[0].status,'cancelled'); assert.equal(adapter.listRevisions().length,0); adapter.dispose();
});
test('one active request, whitespace validation, stored history restoration',async()=>{
  const store=memory(), adapter=new MockReviewAdapter('p',store,3);
  await assert.rejects(()=>adapter.createRequest({...input,feedback:'  '}));
  await adapter.createRequest(input); await assert.rejects(()=>adapter.createRequest(input));
  await settled(adapter); const restored=new MockReviewAdapter('p',store,3);
  assert.equal(restored.listRevisions().length,1); adapter.dispose(); restored.dispose();
});
test('simulation survives unavailable or malformed browser storage',async()=>{
  const denied={getItem(){throw new Error('Denied');},setItem(){throw new Error('Denied');}};
  const adapter=new MockReviewAdapter('p',denied,2); await adapter.createRequest(input); await settled(adapter);
  assert.equal(adapter.storageAvailable,false); assert.equal(adapter.listRevisions().length,1); adapter.dispose();
  const invalid={getItem:()=> '[null,2,"invalid"]',setItem(){}};
  assert.deepEqual(new MockReviewAdapter('p',invalid).listRequests(),[]);
});
