const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { Catalog } = require('../server/catalog.js');
const { ProjectStore } = require('../server/projects.js');
const { ProjectRepo } = require('../server/git.js');
const { attachmentDir } = require('../server/conversation.js');
const { GuidedImports } = require('../server/guided-import.js');
const { makeProject, sh, commit } = require('./helpers/git-fixture.js');

async function store(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dialogue-catalog-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const legacy = new ProjectStore(path.join(root, 'db.json')); await legacy.load();
  const catalog = new Catalog(path.join(root, 'catalog.json'), legacy); await catalog.load(); return { root, legacy, catalog };
}
const plan = (name = 'Web review') => ({ projectName: 'Espresso', assessment: 'Reuse the existing Web UI. Device integrations remain unverified.', builds: [{ name, target: 'Web', root: '.', ref: 'main', destinationRef: 'dialogue/web-review', approach: 'Use the existing interface', limitations: 'No machine attached', verification: { clickText: 'Show', expectedText: 'Pressure' } }] });

test('catalog migration keeps legacy storage, refs, sessions, attachments and credentials untouched and is repeatable', async t => {
  const f = await store(t); await fs.rm(f.catalog.file); f.catalog.data = null;
  await f.legacy.insert({ slug: 'original-storage', createdAt: '2026-01-01T00:00:00Z', repo: { url: 'https://github.com/owner/app', host: 'github.com', owner: 'owner', repo: 'app' }, previewSetup: { status: 'ready', uiVerified: false } });
  const before = await fs.readFile(f.legacy.dbPath);
  for (const p of ['workspaces/original-storage/main/unsaved.txt', 'requests/.sessions/native.jsonl', 'requests/.attachments/source.png', 'keys/original-storage', 'users/member/home/profile']) { await fs.mkdir(path.dirname(path.join(f.root,p)),{recursive:true}); await fs.writeFile(path.join(f.root,p),'retained '+p); }
  const a = await f.catalog.load(), reloaded = new Catalog(f.catalog.file,f.legacy); const b = await reloaded.load();
  assert.equal(a.projects.length,1); assert.equal(a.builds.length,1); assert.deepEqual(b,a); assert.equal(a.builds[0].storageSlug,'original-storage'); assert.equal(a.builds[0].recipePath,'.dialogue/preview.json'); assert.equal(a.builds[0].root,null);
  assert.equal(reloaded.project(b,'original-storage').id,a.projects[0].id); assert.deepEqual(await fs.readFile(f.legacy.dbPath),before);
  for (const p of ['workspaces/original-storage/main/unsaved.txt', 'requests/.sessions/native.jsonl', 'requests/.attachments/source.png', 'keys/original-storage', 'users/member/home/profile']) assert.equal(await fs.readFile(path.join(f.root,p),'utf8'),'retained '+p);
});

test('projects may be empty or share sources; names and duplicate URLs do not define identity', async t => {
  const {catalog} = await store(t), a = await catalog.createProject('Same name'), b = await catalog.createProject('Same name'); assert.notEqual(a.id,b.id);
  const s1 = await catalog.connect(a.id,'https://github.com/owner/app'), s2 = await catalog.connect(b.id,'git@github.com:owner/app.git'); assert.equal(s1.id,s2.id);
  const other = await catalog.connect(a.id,'https://github.com/owner/other'); assert.notEqual(other.id,s1.id);
  const data=await catalog.snapshot(); assert.equal(data.builds.length,0); assert.equal(data.projects[0].sourceIds.length,2);
  for (const url of ['https://token@github.com/owner/app','https://github.com/owner/app?token=x','https://gitlab.com/owner/app','/private/tmp/local-repo']) await assert.rejects(catalog.connect(a.id,url), e=>e.status===400);
});

test('creation and import retries with an operation identity do not duplicate product records', async t => {
  const {catalog}=await store(t), operationId=randomUUID(); const a=await catalog.createProject('Empty',operationId), b=await catalog.createProject('Empty',operationId); assert.equal(a.id,b.id);
  const input={name:'Local',target:'Web',prompt:'Create a page',operationId:randomUUID()}; assert.equal((await catalog.createBuild(a.id,input)).id,(await catalog.createBuild(a.id,input)).id);
  const s=await catalog.connect(a.id,'https://github.com/o/app'), req={projectId:a.id,sourceId:s.id,actorId:'one',operationId:randomUUID()}; assert.equal((await catalog.startImport(req)).id,(await catalog.startImport(req)).id);
  await assert.rejects(catalog.createProject('Other',operationId),e=>e.status===409); assert.equal((await catalog.snapshot()).projects.length,1,'a rejected update must not poison subsequent reads');
});

test('confirmation is tied to source and plan revision; recovery retains approved decisions and working-copy identities', async t => {
  const f=await store(t), s=await f.catalog.connect(null,'https://github.com/o/app'); let a=await f.catalog.startImport({sourceId:s.id,actorId:'one'});
  await f.catalog.patchImport(a.id,{state:'awaiting-confirmation',sourceSha:'a'.repeat(40)}); a=await f.catalog.setPlan(a.id,plan());
  const old=a.revision; a=await f.catalog.setPlan(a.id,plan('Changed')); assert.notEqual(a.revision,old); await assert.rejects(f.catalog.approve(a.id,old),e=>e.status===409);
  a=await f.catalog.approve(a.id,a.revision); const buildId=a.prepared[0].buildId; await f.catalog.recover();
  const restarted=new Catalog(f.catalog.file,f.legacy); const data=await restarted.snapshot(); assert.equal(data.imports[0].state,'failed'); assert.equal(data.imports[0].approval.sourceSha,'a'.repeat(40)); assert.equal(data.builds[0].id,buildId);
  const revised=await restarted.setPlan(a.id,plan('Revised approach')); await restarted.approve(a.id,revised.revision); assert.equal((await restarted.snapshot()).builds.length,1); assert.equal((await restarted.snapshot()).builds[0].id,buildId);
});

test('a corrupt catalog or legacy database fails closed without replacing the original bytes', async t => {
  const f=await store(t); await fs.writeFile(f.catalog.file,'broken'); const c=new Catalog(f.catalog.file,f.legacy); await assert.rejects(c.load(),/not replaced/); assert.equal(await fs.readFile(f.catalog.file,'utf8'),'broken');
  await fs.writeFile(f.legacy.dbPath,'bad JSON'); await assert.rejects(f.legacy.load(),/not replaced/); assert.equal(await fs.readFile(f.legacy.dbPath,'utf8'),'bad JSON');
});

test('independent build mirrors cannot publish another build’s pending edits, including the same remote branch', async t => {
  const f=await makeProject({'index.html':'initial'});t.after(f.cleanup);sh(f.origin,'config','receive.denyCurrentBranch','updateInstead');
  const make=async slug=>{const r=new ProjectRepo({slug,url:f.origin,pushUrl:f.origin,reposRoot:path.join(f.root,'repos'),workspacesRoot:path.join(f.root,'workspaces'),recipePath:`.dialogue/builds/${slug}/preview.json`});await r.ensure();return r;};
  const one=await make('build-one'),two=await make('build-two'),a=await one.ensureWorkspace('main'),b=await two.ensureWorkspace('main'); assert.notEqual(a.dir,b.dir);
  await fs.writeFile(path.join(a.dir,'one.txt'),'first pending edit');await fs.writeFile(path.join(b.dir,'two.txt'),'second pending edit');
  await one.publishVersion(a);assert.equal(sh(f.origin,'show','HEAD:one.txt'),'first pending edit');assert.throws(()=>sh(f.origin,'show','HEAD:two.txt'));
  await assert.rejects(two.publishVersion(b),/remote branch moved|conflicts with the pending Draft/i);assert.equal(await fs.readFile(path.join(b.dir,'two.txt'),'utf8'),'second pending edit');
  const branch=await one.ensureBranchFrom('alternative',sh(f.origin,'rev-parse','HEAD')); assert.notEqual(branch.id,a.id); assert.equal((await one.refs()).branches.some(r=>r.name==='alternative'),true);
});

async function guidedFixture(t) {
  const f=await store(t), g=await makeProject({'index.html':'<button>Show</button>'});t.after(g.cleanup); const calls=[],records=new Map(), requests={root:path.join(f.root,'requests'),active:new Map(),list:id=>records.get(id)||[],stop:async()=>{}};
  requests.start=async(workspace,repo,input)=>{
    calls.push({workspace,input}); const record={id:randomUUID(),workspaceId:workspace.id,feedback:input.feedback,status:'completed',reply:JSON.stringify(plan())};
    if(input.intent!=='discuss') { const name=/ONLY at ([^\s]+)\./.exec(input.feedback)[1]; await fs.mkdir(path.dirname(path.join(workspace.dir,name)),{recursive:true});await fs.writeFile(path.join(workspace.dir,name),JSON.stringify({version:1,kind:'static',root:'.'}));record.reply='Prepared the selected build'; }
    records.set(workspace.id,[...(records.get(workspace.id)||[]),record]);return record;
  };
  const repos=new Map(); const repoFor=async p=>{if(!repos.has(p.slug)){const r=new ProjectRepo({slug:p.slug,url:g.origin,reposRoot:path.join(f.root,'repos'),workspacesRoot:path.join(f.root,'workspaces'),recipePath:p.recipePath});await r.ensure();repos.set(p.slug,r);}return repos.get(p.slug);};
  const guided=new GuidedImports({catalog:f.catalog,projects:f.legacy,repoFor,requests,dataRoot:f.root,reserve:()=>{},validatePreview:async()=>({previewConfigured:true,uiVerified:false})});
  return {...f,source:g,calls,guided,requests};
}
test('shared import assesses read-only before confirmation, pins source, prepares once and retains context', async t => {
  const f=await guidedFixture(t);let a=await f.guided.connect({url:'https://github.com/acceptance/app'},{id:'one'});await f.guided.active.get(a.id).done;a=await f.guided.get(a.id);
  assert.equal(a.state,'awaiting-confirmation');assert.equal((await f.catalog.snapshot()).builds.length,0);assert.equal(f.calls[0].input.intent,'discuss');assert.equal(f.calls[0].workspace.assessment,true);
  assert.equal(sh(f.source.origin,'status','--porcelain'),'');const approved=await f.guided.confirm(a.id,a.revision,{id:'one'});await f.guided.active.get(a.id).done;
  const d=await f.catalog.snapshot(),b=d.builds[0];assert.equal(b.state,'configured');assert.equal(b.uiVerified,false);assert.ok(f.calls[1].workspace.conversationContext.approvedPlan);assert.match(f.calls[1].workspace.conversationContext.assessment,/Device integrations/);
  await f.guided.resume(a.id,{id:'one'});await f.guided.active.get(a.id).done;assert.equal((await f.catalog.snapshot()).builds.length,1);assert.equal((await f.guided.get(a.id)).prepared[0].buildId,approved.prepared[0].buildId);
});
test('source advancement before confirmation requires reassessment and creates no build', async t => {
  const f=await guidedFixture(t);let a=await f.guided.connect({url:'https://github.com/acceptance/app'},{id:'one'});await f.guided.active.get(a.id).done;a=await f.guided.get(a.id);
  await commit(f.source.origin,{'new.txt':'source changed'});await assert.rejects(f.guided.confirm(a.id,a.revision,{id:'one'}),e=>e.status===409);assert.equal((await f.catalog.snapshot()).builds.length,0);assert.equal((await f.guided.get(a.id)).failureKind,'source-changed');
});
test('multiple selected builds share a source but have separate recipes, storage and target availability', async t => {
  const f=await guidedFixture(t), p=await f.catalog.createProject('Container');let a=await f.guided.connect({projectId:p.id,url:'https://github.com/acceptance/app'},{id:'one'});await f.guided.active.get(a.id).done;a=await f.guided.get(a.id);
  const value=plan();value.builds.push({...value.builds[0],name:'Other web',destinationRef:'dialogue/other'});value.builds.push({...value.builds[0],name:'Device',target:'iOS',destinationRef:'dialogue/device'});
  a=await f.catalog.setPlan(a.id,value);await f.guided.confirm(a.id,a.revision,{id:'one'});await f.guided.active.get(a.id).done;
  const d=await f.catalog.snapshot();assert.equal(d.projects.length,1);assert.equal(d.builds.length,3);assert.equal(new Set(d.builds.map(b=>b.recipePath)).size,3);assert.equal(new Set(d.builds.map(b=>b.storageSlug)).size,3);assert.equal(d.builds[2].state,'unsupported');assert.equal(f.calls.length,3,'only assessment plus two Web preparations');
});

test('revising a prepared plan retains working-copy identity and unpublished edits; branch/selection replacements are refused', async t => {
  const f=await guidedFixture(t);let a=await f.guided.connect({url:'https://github.com/acceptance/app'},{id:'one'});await f.guided.active.get(a.id).done;a=await f.guided.get(a.id);
  await f.guided.confirm(a.id,a.revision,{id:'one'});await f.guided.active.get(a.id).done;const b=(await f.catalog.snapshot()).builds[0],repo=await f.guided.engineBuild(b),w=await repo.findWorkspace(b.destinationRef);
  await fs.writeFile(path.join(w.dir,'pending.txt'),'keep my work');
  let changed=structuredClone(a.plan);changed.builds[0].destinationRef='replacement';await assert.rejects(f.catalog.setPlan(a.id,changed),e=>e.status===409);
  changed=structuredClone(a.plan);changed.builds[0].selected=false;await assert.rejects(f.catalog.setPlan(a.id,changed),e=>e.status===409);
  changed=structuredClone(a.plan);changed.builds[0].name='Revised name';changed.builds[0].approach='Revised approved adaptation';a=await f.catalog.setPlan(a.id,changed);await f.guided.confirm(a.id,a.revision,{id:'one'});await f.guided.active.get(a.id).done;
  assert.equal((await f.catalog.snapshot()).builds[0].id,b.id);assert.equal((await repo.findWorkspace(b.destinationRef)).dir,w.dir);assert.equal(await fs.readFile(path.join(w.dir,'pending.txt'),'utf8'),'keep my work');
});
test('reassessment across source revisions retains earlier discussion and attachments in the resulting build', async t => {
  const f=await guidedFixture(t);let a=await f.guided.connect({url:'https://github.com/acceptance/app'},{id:'one'});await f.guided.active.get(a.id).done;a=await f.guided.get(a.id);
  const oldId=a.workspaceId,dir=attachmentDir(f.requests.root,oldId);await fs.mkdir(path.join(dir,'original-request'),{recursive:true});const file=path.join(dir,'original-request','brief.txt');await fs.writeFile(file,'cobalt decision');
  f.requests.list(oldId)[0].attachments=[{name:'brief.txt',file}];await commit(f.source.origin,{'revision.txt':'updated source'});
  await f.guided.discuss(a.id,{message:'Keep the original cobalt brief'},{id:'one'});await f.guided.active.get(a.id).done;a=await f.guided.get(a.id);assert.notEqual(a.workspaceId,oldId);assert.equal(f.guided.history(a).length,2);
  await f.guided.confirm(a.id,a.revision,{id:'one'});await f.guided.active.get(a.id).done;const b=(await f.catalog.snapshot()).builds[0],repo=await f.guided.engineBuild(b),w=await f.guided.decorate(await repo.findWorkspace(b.destinationRef),b);
  assert.equal(w.conversationContext.importDiscussion.length,2);const inherited=w.conversationContext.importDiscussion.flatMap(r=>r.attachments).find(f=>f.name==='brief.txt');assert.equal(await fs.readFile(inherited.file,'utf8'),'cobalt decision');
});
test('cancelling a connecting import aborts I/O and retains a resumable single attempt', async t => {
  const f=await store(t);let started;const entered=new Promise(r=>started=r);const guided=new GuidedImports({catalog:f.catalog,dataRoot:f.root,requests:{stop:async()=>{}},repoFor:async(_p,{signal})=>{started();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));}});
  const a=await guided.connect({url:'https://github.com/acceptance/app'},{id:'one'});await entered;await guided.cancel(a.id);assert.equal((await guided.get(a.id)).state,'cancelled');assert.equal((await f.catalog.snapshot()).builds.length,0);assert.equal((await f.catalog.snapshot()).imports.length,1);
});

test('cancellation between checkout and request creation cannot start a late agent', async t => {
  const f=await guidedFixture(t),original=f.catalog.patchImport.bind(f.catalog);let entered,unblock;const paused=new Promise(r=>entered=r),released=new Promise(r=>unblock=r);
  f.catalog.patchImport=async(id,patch)=>{const result=await original(id,patch);if(patch.state==='inspecting'){entered();await released;}return result;};
  const a=await f.guided.connect({url:'https://github.com/acceptance/app'},{id:'one'});await paused;const cancel=f.guided.cancel(a.id);unblock();await cancel;assert.equal(f.calls.length,0);assert.equal((await f.guided.get(a.id)).state,'cancelled');
});
