// Real HTTP checks use an isolated server copy and disposable fixture directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
const run=promisify(execFile);
const root=path.resolve(import.meta.dirname,'..');
const html='<!doctype html><html><head><title>Disposable fixture</title></head><body><main id="app"><h1>Original prototype</h1></main></body></html>';

test('HTTP instrumentation, real import, manifests and persistence', {timeout:15000}, async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dialogue-http-test-'));
  let child;
  t.after(async()=>{ if(child && child.exitCode===null) {child.kill(); await once(child,'exit');} await fs.rm(dir,{recursive:true,force:true}); });
  await fs.copyFile(path.join(root,'server.js'),path.join(dir,'server.js'));
  await fs.mkdir(path.join(dir,'js')); await fs.copyFile(path.join(root,'js/prototype-review-bridge.js'),path.join(dir,'js/prototype-review-bridge.js'));
  await fs.writeFile(path.join(dir,'index.html'),html);
  await run('/usr/bin/zip',['-q',path.join(dir,'fixture.zip'),'index.html'],{cwd:dir});
  const probe=net.createServer(); probe.listen(0,'127.0.0.1'); await once(probe,'listening'); const port=probe.address().port; await new Promise(r=>probe.close(r));
  child=spawn(process.execPath,['server.js'],{cwd:dir,env:{...process.env,HOST:'127.0.0.1',PORT:String(port)},stdio:'ignore'});
  const base=`http://127.0.0.1:${port}`;
  for(let i=0;i<50;i++){try { const r=await fetch(base+'/api/health'); if(r.ok)break;}catch{} await new Promise(r=>setTimeout(r,50));}
  const zip=await fs.readFile(path.join(dir,'fixture.zip'));
  const result=await fetch(base+'/api/projects/landline/import?name=Landline&version=V23.18',{method:'POST',body:zip});
  assert.equal(result.status,201); const {revision}=await result.json();
  const data=path.join(dir,'.dialogue-data'), stored=path.join(data,revision.storageKey,'index.html');
  assert.equal(await fs.readFile(stored,'utf8'),html);
  const manifest=JSON.parse(await fs.readFile(path.join(data,revision.storageKey,'.dialogue-revision.json'),'utf8'));
  assert.equal(manifest.revision.id,revision.id); assert.equal(manifest.revision.version,'V23.18');
  const backup=JSON.parse(await fs.readFile(path.join(data,'db.json.bak'),'utf8')); assert.equal(backup.revisions.length,0);
  const url=base+`/prototype-files/${revision.id}/index.html`;
  const plain=await (await fetch(url)).text(); assert.equal(plain,html);
  const instrumented=await fetch(url+'?reviewChannel='+'a'.repeat(32)), text=await instrumented.text();
  assert.ok(text.includes('data-review-channel="'+'a'.repeat(32)+'"')); assert.equal(Number(instrumented.headers.get('content-length')),Buffer.byteLength(text));
  assert.equal(await fs.readFile(stored,'utf8'),html); // Response-only, never disk mutation.
  assert.equal(await (await fetch(url+'?reviewChannel=invalid')).text(),html);
  assert.equal((await fetch(base+'/js/prototype-review-bridge.js')).status,200);
  assert.equal((await fetch(base+`/prototype-files/${revision.id}/.dialogue-revision.json`)).status,404);
  assert.equal((await fetch(base+'/api/projects/landline/import?name=Landline&version=V23.18',{method:'POST',body:zip})).status,409);
  child.kill(); await once(child,'exit');
  // The saved revision remains readable after restart.
  child=spawn(process.execPath,['server.js'],{cwd:dir,env:{...process.env,HOST:'127.0.0.1',PORT:String(port)},stdio:'ignore'});
  for(let i=0;i<50;i++){try {const r=await fetch(base+'/api/health');if(r.ok)break;}catch{} await new Promise(r=>setTimeout(r,50));}
  assert.equal((await (await fetch(base+'/api/projects/landline/revisions')).json()).revisions[0].id,revision.id);
  child.kill(); await once(child,'exit');
  await fs.unlink(path.join(data,'db.json'));
  child=spawn(process.execPath,['server.js'],{cwd:dir,env:{...process.env,PORT:String(port)},stdio:'ignore'});
  const [code]=await once(child,'exit'); assert.equal(code,1);
  await assert.rejects(fs.access(path.join(data,'db.json'))); // Missing metadata is not silently recreated.
});
