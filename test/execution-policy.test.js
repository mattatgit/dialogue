const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {once}=require('node:events');
const {noListenFilter,outcome}=require('../server/worker-observation.js');
const {Workers,workerConfig,WorkerBudget,killWorker}=require('../server/workers.js');
const {Runner}=require('../server/runner.js');
// Evaluate the emitted cBPF branches, including foreign/compat architecture rejection.
function apply(bytes,arch,nr){let a=0;for(let pc=0;pc<bytes.length/8;pc++){const i=pc*8,code=bytes.readUInt16LE(i),k=bytes.readUInt32LE(i+4);if(code===0x20)a=k===4?arch:nr;else if(code===0x15)pc+=a===k?bytes[i+2]:bytes[i+3];else if(code===0x35)pc+=a>=k?bytes[i+2]:bytes[i+3];else if(code===6)return k;else assert.fail('unsupported instruction');}}
test('inherited agent filter denies bind/listen and io_uring for both native architectures while allowing outbound sockets',()=>{
 for(const [arch,a,bind,listen,connect] of [['x64',0xc000003e,49,50,42],['arm64',0xc00000b7,200,201,203]]){
 const b=noListenFilter(arch);for(const nr of [bind,listen,425])assert.equal(apply(b,a,nr),0x5000d);assert.equal(apply(b,a,connect),0x7fff0000);assert.equal(apply(b,0x40000003,connect),0x80000000);assert.equal(apply(b,a,bind|0x40000000),0x80000000);
 }
});
test('SIGKILL alone is not reported as OOM; explicit timeout/cancel and kernel OOM evidence stay distinct',()=>{
 assert.equal(outcome({signal:'SIGKILL'}),'signal');assert.equal(outcome({signal:'SIGKILL',oomKill:1}),'memory-limit');assert.equal(outcome({result:'oom-kill'}),'memory-limit');assert.equal(outcome({reason:'timeout',oomKill:0}),'timeout');assert.equal(outcome({reason:'cancelled'}),'cancelled');
});
test('coordinated profiles cannot exceed admission or installed slice; compatible queues do not deadlock behind heavy work',async()=>{
 assert.throws(()=>workerConfig({DIALOGUE_WORKER_PREVIEW_MB:'3000'}),/limits must fit/);
 assert.throws(()=>workerConfig({DIALOGUE_WORKER_BUDGET_MB:'3000'}),/limits must fit/);
 const c=workerConfig({DIALOGUE_WORKER_PREVIEW_MB:'512'});const budget=new WorkerBudget(c),agent=await budget.acquire('agent');
 const install=budget.acquire('install');const control=await budget.acquire('control');control();agent();(await install)();assert.equal(budget.active.size,0);
});
test('worker evidence retains attribution and limits with whole-tree measurement explicitly unavailable in direct mode',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dialogue-execution-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const runtime=new Workers({dataRoot:root,appRoot:path.resolve(__dirname,'..'),config:workerConfig({DIALOGUE_MODE:'test'})});t.after(()=>runtime.shutdown());
 const child=await runtime.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:root,stdio:'ignore'},{kind:'agent',attribution:{project:'disposable-deui',request:'request-1',phase:'acceptance',secret:'must-not-persist'}});
 child.workerReason='cancelled';const done=once(child,'close');killWorker(child,'SIGKILL');await done;await child.workerFinished;
 const records=await fs.readdir(path.join(root,'workers','records'));assert.equal(records.length,1);const record=JSON.parse(await fs.readFile(path.join(root,'workers','records',records[0]),'utf8'));
 assert.equal(record.attribution.request,'request-1');assert.equal(record.attribution.secret,undefined);assert.equal(record.outcome,'cancelled');assert.equal(record.measured,false);assert.equal(record.memoryMiB,1280);
});
test('one managed server owns a checkout, replacement waits for cleanup, and retry logs remain archived',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dialogue-runner-owner-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'index.html'),'ok');const runtime={previewOwners:new Map(),spawn:async(bin,args,opts)=>require('node:child_process').spawn(bin,args,opts)};
 const recipe={kind:'static',root:'.',entry:'/'};const a=new Runner({dir:root,stampDir:path.join(root,'a'),recipe,runtime}),b=new Runner({dir:root,stampDir:path.join(root,'b'),recipe,runtime});
 await a.start();await assert.rejects(b.start(),/already has a managed/);assert.equal(runtime.previewOwners.get(root),a);await a.stop();await b.start();await b.stop();assert.equal(runtime.previewOwners.size,0);
 assert.equal((await fs.readdir(path.join(root,'b','attempts'))).length,2);
});
test('managed preview tool only writes a bounded deferred operation and never spawns or waits for a runner',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dialogue-runner-tool-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'mailbox.json');await fs.writeFile(file,JSON.stringify({status:{state:'ready'}}));
 const prior=process.env.DIALOGUE_RUNNER_FILE;process.env.DIALOGUE_RUNNER_FILE=file;t.after(()=>{if(prior===undefined)delete process.env.DIALOGUE_RUNNER_FILE;else process.env.DIALOGUE_RUNNER_FILE=prior});
 const source=await fs.readFile(path.resolve(__dirname,'../omp/managed-preview.js'),'utf8');const {default:register}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));let tool;register({registerTool(t){tool=t}});
 assert.match((await tool.execute('one',{operation:'status'})).content[0].text,/ready/);assert.match((await tool.execute('two',{operation:'restart'})).content[0].text,/Finish your reply/);assert.equal(JSON.parse(await fs.readFile(file)).operation,'restart');
});
test('cold provider readiness pauses the requesting preview before reserving native work and restores it on failure',async()=>{
 const {WorkspaceRequests}=require('../server/requests.js');let paused=false,restored=false;
 const manager=new WorkspaceRequests({root:'/unused',workspacesRoot:'/unused',agent:{check:async()=>{assert.equal(paused,true);return {ready:false,reason:'not-connected'}}}});
 manager.previewPause=async()=>{paused=true};manager.previewReleased=async()=>{restored=true};
 await assert.rejects(manager.start({kind:'branch',id:'o-app/main',dir:'/unused',ref:'main'},{},{feedback:'Discuss only: a question'}),/not ready/);
 assert.equal(restored,true);assert.equal(manager.active.size,0);
});
