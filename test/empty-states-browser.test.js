const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {setup}=require('./helpers/settings-fixture.js');
const {Workers,workerConfig}=require('../server/workers.js');
const {previewBrowser,until}=require('../server/browser-driver.js');

test('Figma empty states use the exact original assets, geometry and working create/import entry points',{timeout:60000},async t=>{
  let browser,runtime;
  t.after(async()=>{await browser?.close().catch(()=>{});await runtime?.shutdown();});
  const f=await setup(t);
  runtime=new Workers({dataRoot:f.data,appRoot:path.resolve(__dirname,'..'),config:workerConfig({...process.env,DIALOGUE_MODE:'test',DIALOGUE_WORKER_MODE:'direct'})});
  browser=await previewBrowser(runtime,await runtime.directory('browser'));
  await browser.call('Network.setCookie',{name:'dialogue-session',value:f.account.headers.Cookie.split('=')[1],url:f.origin,httpOnly:true,sameSite:'Lax'});
  await browser.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1024,deviceScaleFactor:1,mobile:false});
  const wait=expression=>until(()=>browser.evaluate(expression),15000);
  const click=selector=>browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const box=selector=>browser.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`);
  const ready=kind=>wait(`document.readyState==='complete' && document.querySelector('[data-empty-kind="${kind}"]')?.hidden===false && document.querySelector('.gallery-empty-illustration')?.complete && document.querySelector('.gallery-empty-illustration')?.naturalWidth>0`);
  const design=async(kind,size,hash)=>{
    await ready(kind);await browser.evaluate('document.fonts.ready');
    assert.deepEqual(await box('.page-surface'),[216,80,1216,936]);
    assert.deepEqual(await box('.gallery-empty-illustration'),[816-size/2,512-size/2,size,size]);
    assert.deepEqual(await box('.gallery-empty-copy'),[224,631,1216,44]);
    assert.deepEqual(await box('.gallery-empty-primary'),[1336,24,72,32]);
    assert.equal(await browser.evaluate(`document.querySelector('.gallery-empty-illustration').getAttribute('src')`),`assets/empty-states/${kind}.png`);
    assert.deepEqual(await browser.evaluate(`(()=>{const e=document.querySelector('.gallery-empty-copy'),s=getComputedStyle(e);return [s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight,s.color]})()`),['"Inter Tight", sans-serif','16px','500','22px','rgb(158, 163, 158)']);
    const bytes=await fs.readFile(path.join(__dirname,'../assets/empty-states',kind+'.png'));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),hash,'unchanged original Figma image bytes');
  };

  await browser.navigate(f.origin+'/projects.html');
  await design('projects',176,'7562b0da4e3a44de56dc582d4382cfab91fa487ab96134c30c61ebde03cba4c6');
  assert.equal(await browser.evaluate(`document.querySelector('.gallery-empty-copy').textContent`),'Click to create a new Dialogue project');
  assert.equal(await browser.evaluate(`document.querySelector('.page-head a[href="import.html"]').hidden`),true);
  await click('.gallery-empty-figure');await wait(`location.hash==='#new-project'`);
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('#new-project')).display`),'flex');
  await click('[data-empty-import-alternative]');
  await wait(`location.pathname==='/import.html' || Boolean(document.querySelector('dialog[open] [data-import-connect]'))`);
  if(await browser.evaluate(`location.pathname!=='/import.html'`))await wait(`getComputedStyle(document.querySelector('#new-project')).display==='none'`);

  await browser.navigate(f.origin+'/projects.html');await ready('projects');await click('.gallery-empty-copy a');
  await browser.evaluate(`document.querySelector('[data-project-create] [name=name]').value='Empty-state review';document.querySelector('[data-project-create]').requestSubmit()`);
  await ready('builds');const projectId=await browser.evaluate(`new URLSearchParams(location.search).get('id')`);
  await design('builds',180,'3156cdd75db08ed3f340093b4bd87407be776e62c95e91b5e00592a0f2335f86');
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.page-title a')).color`),'rgb(158, 163, 158)');
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[data-project-name]')).color`),'rgb(23, 23, 23)');
  assert.equal(await browser.evaluate(`document.querySelector('.gallery-empty-copy').innerText`),'This project doesn’t have any builds yet.\nCreate something new or import something.');
  assert.ok((await browser.evaluate(`document.querySelector('.gallery-empty-copy a:last-child').href`)).includes('project='+projectId));
  await click('.gallery-empty-figure');await wait(`location.hash==='#new-project'`);
  assert.ok((await browser.evaluate(`document.querySelector('[data-empty-import-alternative]').href`)).includes('project='+projectId));
  await click('[data-empty-import-alternative]');
  await wait(`location.pathname==='/import.html' || document.querySelector('dialog[open] [data-import-title]')?.textContent==='Import build'`);

  const created=await f.request(`/api/catalog/projects/${projectId}/builds`,{name:'Retained native brief',target:'iOS',prompt:'Keep this native brief without executing it.',operationId:crypto.randomUUID()});assert.equal(created.status,202,JSON.stringify(created.json));
  await browser.navigate(f.origin+'/project.html?id='+projectId);await wait(`document.querySelectorAll('[data-build-grid]>.proto-tile').length===1 && document.querySelector('[data-build-empty]').hidden`);
  await wait(`!document.querySelector('main').classList.contains('has-gallery-empty-state')`);
  assert.equal(await browser.evaluate(`document.querySelector('[data-import-build]').hidden`),false,'nonempty gallery retains its import action');
  await browser.navigate(f.origin+'/projects.html');await wait(`document.querySelectorAll('[data-project-grid]>.project-card').length===1 && document.querySelector('[data-project-empty]').hidden`);
  assert.equal(await browser.evaluate(`document.querySelector('h1').classList.contains('sr-only')`),false,'populated Projects keeps its existing heading');

  await browser.navigate(f.origin+'/design-systems.html');
  await design('design-systems',176,'fb78514aa1748c18b156f9b9aa98873f5f219d69acf88caa0ee55d0f110726f3');
  assert.equal(await browser.evaluate(`document.querySelector('.gallery-empty-copy').textContent`),'Click import to add a design system to Dialogue');
  assert.equal(await browser.evaluate(`document.querySelector('.page-head button').disabled`),true,'this UI change does not invent the unimplemented design-system import flow');
  await browser.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  const illustration=await box('.gallery-empty-illustration'),caption=await box('.gallery-empty-copy');assert.ok(illustration[1]+illustration[3]<caption[1]);assert.ok(caption[0]>=72 && caption[0]+caption[2]<=390);

  await browser.navigate(f.origin+'/project.html?id=missing-project');await wait(`document.querySelector('[data-flow-note]')?.textContent.length>0`);
  assert.equal(await browser.evaluate(`document.querySelector('[data-build-empty]').hidden`),true,'a load failure never claims an empty project');
  const errors=browser.events.filter(e=>e.event==='Runtime.exceptionThrown'&&!e.text.startsWith('InvalidStateError: Transition was aborted'));
  assert.deepEqual(errors,[]);
});
