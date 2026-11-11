const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn}=require('node:child_process');const {seedAccounts}=require('./account-fixture.js');const {sh,commit}=require('./git-fixture.js');
async function buildServer(t, options = {}) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dialogue-build-http-')),data=path.join(root,'data'),originRepo=path.join(root,'source');await fs.mkdir(originRepo);
 sh(originRepo,'init','-q','-b','main');await commit(originRepo,{'index.html':'<!doctype html><h1>Imported fixture</h1><button onclick="this.textContent=\'Charts\'">Show</button>'});
 const config=path.join(root,'gitconfig');await fs.writeFile(config,`[url "${originRepo}"]\n insteadOf = https://github.com/acceptance/fixture\n`);
 const port=await new Promise(r=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});const account=seedAccounts(data,port),origin=`http://${options.hostname || '127.0.0.1'}:${port}`;account.env.DIALOGUE_ORIGIN=origin;account.headers.Origin=origin;
 if(options.prepare)await options.prepare(data,root);
 const child=spawn(process.execPath,[path.resolve(__dirname,'../../server.js')],{env:{...process.env,...account.env,DIALOGUE_DATA:data,DIALOGUE_SEED:'',DIALOGUE_OMP:options.omp || path.resolve(__dirname,'build-omp.js'),DIALOGUE_SSH_KEYSCAN:'/usr/bin/false',GIT_CONFIG_GLOBAL:config,HOME:root},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}await fs.rm(root,{recursive:true,force:true});});
 for(let i=0;i<120;i++){if(child.exitCode!==null)throw Error(log);try{if((await fetch(origin+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
 const request=async(url,body,headers={})=>{const response=await fetch(origin+url,{method:body===undefined?'GET':'POST',headers:{...account.headers,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await response.text();let json;try{json=JSON.parse(text)}catch{}return{status:response.status,json,text};};
 const until=async(fn)=>{for(let i=0;i<200;i++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,50));}throw Error('Flow did not settle. '+log.slice(-2000));};
 return{root,data,port,origin,originRepo,account,child,request,until,log:()=>log};
}
module.exports={buildServer};
