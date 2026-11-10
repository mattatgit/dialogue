// Bounded browser driver. Chrome and all its children stay in the
// supplied worker runtime; CDP pipes never expose a debugging TCP listener.
const {spawnWorker,killWorker}=require('./workers.js');
const {findChromium}=require('./preview.js');
const UI_TIMEOUT = Number(process.env.DIALOGUE_ACCEPTANCE_UI_TIMEOUT_MS || 60000);
if (!Number.isSafeInteger(UI_TIMEOUT) || UI_TIMEOUT < 10000 || UI_TIMEOUT > 120000) throw new Error('UI acceptance deadline must be 10000–120000 ms.');
async function previewBrowser(runtime,dir,attribution={},signal) {
  const bin=findChromium();if(!bin)throw new Error('Provide the pinned headless Chromium.');
  const child=await spawnWorker(runtime,bin,['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${dir}/profile`,'--remote-debugging-pipe','about:blank'],{cwd:dir,env:{},stdio:['ignore','pipe','pipe','pipe','pipe']},{kind:'browser',attribution,signal});
  let next=0,buffer='';const events=[];const pending=new Map();let stderr='';child.stderr.on('data',d=>stderr=(stderr+d).slice(-2000));
  child.stdio[4].on('data',piece=>{buffer+=piece;let i;while((i=buffer.indexOf('\0'))>=0){const raw=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!raw)continue;const frame=JSON.parse(raw),item=pending.get(frame.id);if(frame.method==='Runtime.exceptionThrown')events.push({event:frame.method,text:String(frame.params?.exceptionDetails?.exception?.description || frame.params?.exceptionDetails?.text || '').slice(0,2000)});if(frame.method==='Network.loadingFailed')events.push({event:frame.method,type:frame.params?.type,error:frame.params?.errorText});if(frame.method==='Network.responseReceived' && frame.params?.response?.status>=400){const u=new URL(frame.params.response.url);events.push({event:frame.method,status:frame.params.response.status,url:u.origin+u.pathname});}if(events.length>80)events.splice(0,events.length-80);if(item){clearTimeout(item.timer);pending.delete(frame.id);frame.error?item.reject(new Error(frame.error.message)):item.resolve(frame.result);}}});
  child.on('close',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Acceptance browser exited: '+stderr));}pending.clear()});
  const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timed out: '+method))},Math.min(UI_TIMEOUT,60000));pending.set(id,{resolve,reject,timer});child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');});
  const {targetId}=await call('Target.createTarget',{url:'about:blank'});const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
  await call('Page.enable',{},sessionId);await call('Runtime.enable',{},sessionId);await call('Network.enable',{},sessionId);
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1024,deviceScaleFactor:1,mobile:false},sessionId);
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  return {child,events,evaluate,call:(method,params)=>call(method,params,sessionId),navigate:url=>call('Page.navigate',{url},sessionId),screenshot:async file=>{const r=await call('Page.captureScreenshot',{format:'png'},sessionId);await require('node:fs/promises').writeFile(file,Buffer.from(r.data,'base64'));},close:async()=>{await call('Browser.close').catch(()=>{});await child.workerFinished;killWorker(child,'SIGTERM');}};
}
async function until(check,timeout=UI_TIMEOUT){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,250));}throw new Error('Intended UI/interaction did not become ready.');}
module.exports={previewBrowser,until};
