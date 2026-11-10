const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const{buildServer}=require('./helpers/build-server.js');const{Workers,workerConfig}=require('../server/workers.js');const{previewBrowser,until}=require('../server/browser-driver.js');
test('rough UI supports empty project, prompt/file build, and the shared Import build / Import project flow', {timeout:60000},async t=>{
 let browser,runtime;t.after(async()=>{await browser?.close().catch(()=>{});await runtime?.shutdown();});
 const f=await buildServer(t);runtime=new Workers({dataRoot:f.data,appRoot:path.resolve(__dirname,'..'),config:workerConfig({...process.env,DIALOGUE_MODE:'test',DIALOGUE_WORKER_MODE:'direct'})});
 browser=await previewBrowser(runtime,await runtime.directory('browser'));
 await browser.call('Network.setCookie',{name:'dialogue-session',value:f.account.headers.Cookie.split('=')[1],url:f.origin,httpOnly:true,sameSite:'Lax'});
 const fill=(selector,value)=>browser.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('Field missing');n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 const click=selector=>browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const submit=selector=>browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`);
 const wait=expression=>until(()=>browser.evaluate(expression),15000);
 await browser.navigate(f.origin+'/projects.html');await wait(`document.readyState==='complete' && document.querySelector('[data-project-create]') && document.body.innerText.includes('Create project')`);
 await click('a[href="#new-project"]');await fill('[data-project-create] [name="name"]','Flow review');await submit('[data-project-create]');
 await wait(`document.querySelector('[data-build-empty]')?.hidden===false`);assert.match(await browser.evaluate('document.body.innerText'),/No builds yet/);
 await click('a[href="#new-project"]');await fill('[data-build-create] [name="name"]','First Web');await fill('[data-build-create] [name="prompt"]','Create a disposable fixture page');await submit('[data-build-create]');
 await wait(`document.querySelector('[data-build-state]')?.textContent.includes('Preview configured')`);
 assert.match(await browser.evaluate('document.body.innerText'),/Local source · no remote repository/);
 await click('[data-project-link]');await wait(`document.querySelectorAll('[data-build-grid] > a').length===1`);await click('[data-import-build]');
 await wait(`document.querySelector('[data-import-title]')?.textContent==='Import build'`);await fill('[data-import-connect] [name="url"]','https://github.com/acceptance/fixture');await submit('[data-import-connect]');
 await wait(`document.querySelector('.flow-plan-build') && document.querySelector('[data-plan-confirm]')?.disabled===false`);await fill('.flow-plan-build [name="name"]','Second Web');await submit('[data-import-plan]');
 await wait(`document.querySelector('[data-plan-confirm]')?.disabled===false`);await click('[data-plan-confirm]');await wait(`document.querySelector('[data-results-panel]')?.hidden===false && document.querySelector('[data-import-state]').textContent.includes('Preview configured')`);
 assert.equal(await browser.evaluate(`document.querySelector('[data-build-results]').textContent.includes('Second Web')`),true);
 await browser.screenshot(path.join(f.root,'import-review.png'));await click('[data-open-project]');await wait(`document.querySelectorAll('[data-build-grid] > a').length===2`);
 await browser.screenshot(path.join(f.root,'build-gallery.png'));assert.equal(await browser.evaluate(`document.body.innerText.includes('Branches 2')`),false);
 await browser.navigate(f.origin+'/projects.html');await wait(`document.querySelector('a[href="import.html"]')!==null`);await click('a[href="import.html"]');await wait(`document.readyState==='complete' && document.querySelector('[data-import-connect] [name="url"]')!==null`);await fill('[data-import-connect] [name="url"]','https://github.com/acceptance/fixture');await submit('[data-import-connect]');await wait(`document.querySelector('.flow-plan-build') && document.querySelector('[data-plan-confirm]')?.disabled===false`);
 assert.equal((await f.request('/api/catalog/projects')).json.projects.length,1,'whole-project assessment still waits for confirmation');
 assert.equal(await browser.evaluate(`document.querySelector('[data-import-title]').textContent`),'Import project');
 // Chromium can cancel an optional cross-document transition during fast
 // automated navigation. Retain/ignore only that exact platform diagnostic;
 // application exceptions still fail this functional flow check.
 const errors=browser.events.filter(e=>e.event==='Runtime.exceptionThrown'&&e.text!=='InvalidStateError: Transition was aborted because of invalid state. ViewTransition opt-in disabled');assert.deepEqual(errors,[]);
});
