const fs=require('node:fs/promises'),path=require('node:path');
const{buildServer}=require('./build-server.js');
const PNG='iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALElEQVR4AeyTsQ0AAAjCGv//WeUFHVhIYIShgQL6YxVs/q4UQBiEgR7k38EAAAD//16LopYAAAAGSURBVAMA7eIQERhjxOYAAAAASUVORK5CYII=';
const setup=(t,{workingCopy=false}={})=>buildServer(t,{hostname:'localhost',omp:path.join(__dirname,'settings-omp.js'),prepare:async(data,root)=>{
 await fs.writeFile(path.join(data,'agent.json'),JSON.stringify({model:'openai-codex/gpt-6.1-sol'}));
 if(workingCopy){
  const {ProjectStore}=require('../../server/projects.js'),{ProjectRepo}=require('../../server/git.js');
  const store=new ProjectStore(path.join(data,'db.json'));await store.load();await store.insert({slug:'fixture',repo:{url:'https://github.com/acceptance/fixture',host:'github.com',owner:'acceptance',repo:'fixture'},previewSetup:{status:'ready'}});
  const repo=new ProjectRepo({slug:'fixture',url:path.join(root,'source'),reposRoot:path.join(data,'repos'),workspacesRoot:path.join(data,'workspaces')});await repo.ensure();await repo.ensureWorkspace('main');
  const db=new(require('node:sqlite').DatabaseSync)(path.join(data,'accounts.sqlite'));db.prepare('INSERT INTO editors VALUES (?,?)').run('fixture/main',db.prepare("SELECT user_id FROM members WHERE role='owner'").get().user_id);db.close();
 }
}});
async function request(f,route,{method='GET',body,cookie=f.account.headers.Cookie,origin=f.origin}={}) {
 const r=await fetch(f.origin+route,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const bytes=Buffer.from(await r.arrayBuffer());let json;try{json=JSON.parse(bytes)}catch{}return{status:r.status,json,bytes,headers:r.headers};
}
module.exports={setup,request,PNG};
