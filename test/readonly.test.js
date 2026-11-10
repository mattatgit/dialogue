const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
test('read-only policy clamps active tools and blocks execution, private configuration, source escapes and ambient credential reads',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dialogue-read-policy-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const source=path.join(root,'source'),attachments=path.join(root,'attachments');await fs.mkdir(source);await fs.mkdir(attachments);await fs.writeFile(path.join(source,'public.txt'),'public');await fs.writeFile(path.join(root,'secret.txt'),'secret');await fs.symlink(path.join(root,'secret.txt'),path.join(source,'escape'));
 const prior=[process.env.DIALOGUE_INSPECTION_ROOT,process.env.DIALOGUE_READ_ATTACHMENTS];process.env.DIALOGUE_INSPECTION_ROOT=source;process.env.DIALOGUE_READ_ATTACHMENTS=attachments;t.after(()=>{for(const[k,v]of[['DIALOGUE_INSPECTION_ROOT',prior[0]],['DIALOGUE_READ_ATTACHMENTS',prior[1]]])if(v===undefined)delete process.env[k];else process.env[k]=v;});
 const code=await fs.readFile(path.join(__dirname,'../omp/readonly.js'),'utf8');const {default:register}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));const hooks=new Map();let active;
 register({on:(name,fn)=>hooks.set(name,fn),setActiveTools:async names=>{active=names}});await hooks.get('session_start')({},{});assert.deepEqual(active,['read','grep','glob']);await hooks.get('before_agent_start')({},{});
 const invoke=(toolName,input={})=>hooks.get('tool_call')({toolName,input});
 for(const name of ['bash','write','edit','dialogue_preview','task','eval','arbitrary_mcp'])assert.equal((await invoke(name)).block,true,name);
 for(const file of ['../secret.txt','escape','.env','.env.local','.git/config','.omp/tools/tool.js'])assert.equal((await invoke('read',{path:path.resolve(source,file)})).block,true,file);
 assert.equal(await invoke('read',{path:path.join(source,'public.txt')}),undefined);assert.equal(await invoke('grep',{path:path.join(source,'public.txt'),pattern:'public'}),undefined);
 assert.equal((await invoke('grep',{path:source,pattern:'secret'})).block,true);assert.equal((await invoke('glob',{path:source,pattern:'../../*'})).block,true);assert.equal(await invoke('glob',{path:source,pattern:'**/*.txt'}),undefined);
});
