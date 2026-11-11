const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {buildServer}=require('./helpers/build-server.js');const {AgentAuth}=require('../server/agent-auth.js');const {Accounts,accountConfig}=require('../server/accounts.js');
const APP=path.resolve(__dirname,'..');
// Real browser canvas export (16x16 opaque raster), not an SVG or upload mock.
const {setup,request,PNG}=require('./helpers/settings-fixture.js');
test('Settings profile and avatar changes retain account identity, email, sessions and SQLite recovery',async t=>{
 const f=await setup(t),before=(await request(f,'/api/auth/session')).json.user;
 assert.equal((await request(f,'/api/account/profile',{method:'PATCH',body:{name:'Matt revised',email:'outsider@example.test'}})).status,200);
 const uploaded=await request(f,'/api/account/avatar',{method:'PUT',body:{png:PNG,userId:'another-person'}});assert.equal(uploaded.status,200);assert.match(uploaded.json.avatarUrl,/^\/api\/account\/avatars\//);
 const user=(await request(f,'/api/auth/session')).json.user;assert.equal(user.id,before.id);assert.equal(user.email,before.email);assert.equal(user.name,'Matt revised');assert.equal(user.avatarUrl,uploaded.json.avatarUrl);
 const image=await request(f,user.avatarUrl);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.match(image.headers.get('cache-control'),/private/);assert.equal(image.headers.get('cross-origin-resource-policy'),'same-origin');assert.deepEqual(image.bytes.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
 const reopened=new Accounts({dataRoot:f.data,config:accountConfig(f.account.env),sendMail:async()=>{}});assert.equal(reopened.avatarUrl(user.id),user.avatarUrl);assert.equal(reopened.user(user.id).name,'Matt revised');reopened.close();
 assert.equal((await request(f,'/api/account/avatar',{method:'DELETE'})).status,200);assert.equal((await request(f,user.avatarUrl)).status,404);assert.equal((await request(f,'/api/auth/session')).json.user.avatarUrl,null);
});
test('avatar upload and private reads enforce membership, Origin and bounded raster validation without losing the prior avatar',async t=>{
 const f=await setup(t);const ok=await request(f,'/api/account/avatar',{method:'PUT',body:{png:PNG}});assert.equal(ok.status,200);
 assert.equal((await request(f,ok.json.avatarUrl,{cookie:''})).status,401);
 assert.equal((await request(f,'/api/account/avatar',{method:'PUT',origin:'https://wrong.example',body:{png:PNG}})).status,403);
 for(const png of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64'),PNG.slice(0,-12),'a'.repeat(350001),Buffer.concat([Buffer.from(PNG,'base64'),Buffer.from('extra')]).toString('base64')])assert.equal((await request(f,'/api/account/avatar',{method:'PUT',body:{png}})).status,400);
 assert.equal((await request(f,ok.json.avatarUrl)).status,200);
 const members=(await request(f,'/api/account/members')).json.members;assert.equal(members.filter(m=>m.avatarUrl).length,1);
});
async function authFixture(t) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dialogue-settings-auth-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const auth=new AgentAuth({dataRoot:root,appRoot:APP});t.after(()=>auth.shutdown());auth.probe=async()=>({ready:true,model:auth.model});return{auth,root};
}
test('Disconnect survives restart, gates future work and preserves provider credential files',async t=>{
 const {auth,root}=await authFixture(t);const file=path.join(root,'existing-omp-credentials');await fs.writeFile(file,'retain this private fixture');await auth.setModel('one/model');await auth.disconnect();
 const resumed=new AgentAuth({dataRoot:root,appRoot:APP});t.after(()=>resumed.shutdown());resumed.runOmp=()=>assert.fail('disconnected check must not probe a credential');assert.equal((await resumed.check()).ready,false);assert.equal(await fs.readFile(file,'utf8'),'retain this private fixture');
});
test('serialized model switch and disconnect cannot revive an older connection after a slow probe',async t=>{
 const {auth}=await authFixture(t);await auth.setModel('one/model');let unblock;const pending=new Promise(r=>unblock=r);let first=true;
 auth.probe=async()=>{if(first){first=false;await pending;throw Error('Previous probe failed');}return{ready:true,model:auth.model};};
 const probe=auth.check({force:true}),change=auth.setModel('two/model'),disconnect=auth.disconnect();unblock();const results=await Promise.allSettled([probe,change,disconnect]);assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'fulfilled');assert.equal(results[2].status,'fulfilled');assert.equal(auth.model,'two/model');assert.equal(auth.disconnected,true);assert.equal(auth.status().ready,false);
});
test('an explicitly selected service cannot silently fall back to another signed-in provider',async t=>{
 const {auth}=await authFixture(t);await auth.saveModel('one/model');delete auth.probe;auth.runOmp=async()=>({code:1});auth.models=()=>assert.fail('must not discover a replacement for an explicit connection');assert.equal((await auth.check()).reason,'not-connected');assert.equal(auth.model,'one/model');
});
test('successful connection switches to the new service even when the old provider still has credentials',async()=>{
 const auth=Object.create(AgentAuth.prototype);auth.model='old/model';auth.runOmp=()=>assert.fail('old credentials must not decide the new connection');let closed=false;auth.setModel=async model=>{assert.equal(closed,true);return{ready:true,model};};
 const events=[],session={providerId:'new',loginProviderId:'new',requestedMethod:'auto',method:'browser',ended:false,push:(event,data)=>events.push({event,data})};
 const rpc={ready:Promise.resolve(),exited:Promise.resolve(),child:{workerFinished:Promise.resolve()},close(){closed=true;},request:async c=>c.type==='get_available_models'?{models:[{provider:'new',id:'model',name:'Model'}]}:{}};
 await auth.driveLogin(session,rpc);assert.equal(events.at(-1).data.status.model,'new/model');
});

test('connection and avatar changes are scoped to each member and member-management permissions remain enforced',async t=>{
 const f=await setup(t),editor=require('./helpers/account-fixture.js').seedAccounts(f.data,f.port,'editor@example.test'),cookie=editor.headers.Cookie;
 await request(f,'/api/agent/connection',{method:'DELETE'});assert.equal((await request(f,'/api/agent')).json.disconnected,true);
 assert.equal((await request(f,'/api/agent/model',{method:'PUT',cookie,body:{model:'anthropic/claude-test'}})).json.status.ready,true);
 assert.equal((await request(f,'/api/agent')).json.disconnected,true);assert.equal((await request(f,'/api/agent',{cookie})).json.disconnected,false);
 await request(f,'/api/account/avatar',{method:'PUT',cookie,body:{png:PNG}});assert.equal((await request(f,'/api/auth/session')).json.user.avatarUrl,null);assert.ok((await request(f,'/api/auth/session',{cookie})).json.user.avatarUrl);
 assert.equal((await request(f,'/api/account/members',{method:'POST',cookie,body:{email:'denied@example.test'}})).status,403);
});
