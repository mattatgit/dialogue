const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {setup}=require('./helpers/settings-fixture.js');
const {Workers,workerConfig}=require('../server/workers.js');
const {previewBrowser,until}=require('../server/browser-driver.js');

test('main navigation keeps the same logo, links and account geometry across pages and viewport sizes',{timeout:60000},async t=>{
  let browser,runtime;
  t.after(async()=>{await browser?.close().catch(()=>{});await runtime?.shutdown();});
  const fixture=await setup(t);
  runtime=new Workers({dataRoot:fixture.data,appRoot:path.resolve(__dirname,'..'),config:workerConfig({...process.env,DIALOGUE_MODE:'test',DIALOGUE_WORKER_MODE:'direct'})});
  browser=await previewBrowser(runtime,await runtime.directory('browser'));
  await browser.call('Network.setCookie',{name:'dialogue-session',value:fixture.account.headers.Cookie.split('=')[1],url:fixture.origin,httpOnly:true,sameSite:'Lax'});
  const ready=page=>until(()=>browser.evaluate(`location.pathname===${JSON.stringify('/'+page)} && document.readyState==='complete' && document.querySelector('[data-account-profile] strong')?.textContent==='Test owner'`),15000);
  const geometry=()=>browser.evaluate(`(()=>{
    const box=element=>{if(!element || getComputedStyle(element).display==='none')return null;const r=element.getBoundingClientRect();return [r.x,r.y,r.width,r.height]};
    const one=selector=>box(document.querySelector(selector));
    return {sidebar:one('.sidebar'),logo:one('.brand .icon'),links:[...document.querySelectorAll('.side-link')].map(box),icons:[...document.querySelectorAll('.side-nav-icon')].map(box),labels:[...document.querySelectorAll('.side-link>span:not(.side-nav-icon)')].map(box),profile:one('[data-account-profile]'),avatar:one('[data-account-profile] .avatar'),copy:one('.profile-copy'),chevron:one('.profile-chevron'),role:document.querySelector('.profile-copy>span').textContent};
  })()`);
  for(const width of [1440,390]){
    await browser.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width===390});
    await browser.navigate(fixture.origin+'/projects.html');await ready('projects.html');await browser.evaluate('document.fonts.ready');
    const expected=await geometry();
    for(const page of ['settings.html','design-systems.html','settings.html','projects.html']){
      await browser.evaluate(`document.querySelector('.side-nav a[href="${page}"]').click()`);await ready(page);await browser.evaluate('document.fonts.ready');
      assert.deepEqual(await geometry(),expected,`stable sidebar after navigation to ${page} at ${width}px`);
      assert.equal(await browser.evaluate(`document.querySelector('.brand use')?.getAttribute('href')`),'assets/review-icons.svg#mark');
      assert.equal(await browser.evaluate(`document.querySelector('.side-nav [aria-current="page"]').getAttribute('href')`),page);
      if(page==='settings.html' && width===1440){
        await browser.evaluate('window.scrollTo(0,document.body.scrollHeight)');
        await until(()=>browser.evaluate('scrollY>0'),5000);
        assert.deepEqual(await geometry(),expected,'scrolling Settings keeps fixed sidebar geometry');
      }
    }
    assert.equal(expected.role,'Owner');
    assert.deepEqual(expected.avatar.slice(2),[40,40]);
    assert.deepEqual(expected.profile.slice(2),[width===390?72:216,88]);
  }
});
