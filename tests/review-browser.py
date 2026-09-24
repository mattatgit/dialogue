"""Opt-in UI regression test. Requires Python Playwright and Chromium.
Copies source to a disposable directory and NEVER reads/writes the real .dialogue-data.
Run: python tests/review-browser.py
Set CHROMIUM_PATH if the browser is not at /usr/bin/chromium.
"""
from pathlib import Path
import hashlib, json, os, shutil, socket, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = '''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:transparent;font-family:Arial;font-size:12px;display:flex;justify-content:center;padding-top:25px}.device{width:320px;height:672px;background:#ababab;border-radius:24px;position:relative;padding:24px;box-shadow:0 0 12px #0001}button{cursor:pointer}.title{height:24px;background:#1d1e1d;color:white;border:0;border-radius:8px;width:160px;margin-left:72px;font-size:11px;letter-spacing:1px}.dial{border-radius:50%;width:272px;height:272px;background:#1d1e1d;margin-top:48px;position:relative}.talk{border:0;border-radius:50%;background:#17b239;width:80px;height:80px;position:absolute;left:96px;top:96px;font-size:28px}.status{height:48px;background:#1d1e1d;color:white;border-radius:16px;margin-top:40px;padding:17px}.volume,.meter{background:#1d1e1d;border-radius:16px;height:80px;margin-top:16px;padding:20px;color:white}.meter{background:repeating-linear-gradient(90deg,#17b239 0 8px,transparent 8px 16px),#1d1e1d;background-size:240px 56px,100%;background-repeat:no-repeat;background-position:center}.volume input{width:100%;accent-color:#17b239;margin-top:12px}.slot{position:absolute;width:48px;height:48px;border-radius:50%;background:#070707;left:112px;top:16px}.slot:nth-child(2){left:197px;top:112px}.slot:nth-child(3){left:112px;top:208px}.slot:nth-child(4){left:26px;top:112px}</style></head><body><main class="device" data-dialogue-root><button id="title" class="title">LANDLINE</button><div class="dial"><i class="slot"></i><i class="slot"></i><i class="slot"></i><i class="slot"></i><button id="talk" class="talk">0</button></div><div class="status">Ready to talk</div><div class="volume">Volume<input type="range" value="25" aria-label="Volume"></div><div class="meter"></div></main><script>let count=0;document.querySelector('#talk').onclick=e=>e.target.textContent=++count;</script></body></html>'''

def stage(target):
    shutil.copy2(ROOT / 'server.js', target / 'server.js')
    for name in ['assets','css','js']:
        shutil.copytree(ROOT / name, target / name)
    for file in ROOT.glob('*.html'): shutil.copy2(file, target / file.name)
    data = target / '.dialogue-data'
    prototype = {'id':'fixture-prototype','projectId':'project-landline','slug':'landline','name':'Landline','createdAt':'2026-09-20T00:00:00Z'}
    project = {'id':'project-landline','slug':'landline','name':'Landline','description':'A simpler way for households to stay in touch.','createdAt':'2026-09-20T00:00:00Z'}
    revisions=[]
    for i in range(1,5):
        rid=f'fixture-revision-{i}'; key=f'prototypes/landline/landline/{rid}'; folder=data/key; folder.mkdir(parents=True)
        (folder/'index.html').write_text(HTML)
        revisions.append({'id':rid,'prototypeId':prototype['id'],'version':f'V23.{15+i}','title':f'Landline V23.{15+i}','createdAt':f'2026-09-2{i}T00:00:00Z','entryPoint':'index.html','storageKey':key,'fileCount':1,'source':'manual-zip-import'})
    (data/'db.json').write_text(json.dumps({'schemaVersion':1,'projects':[project],'prototypes':[prototype],'revisions':revisions}))
    return data

def digest(root):
    return {str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}

def run():
    with tempfile.TemporaryDirectory(prefix='dialogue-review-test-') as tmp:
        target=Path(tmp); data=stage(target); before=digest(data)
        with socket.socket() as sock: sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
        base=f'http://127.0.0.1:{port}'
        proc=subprocess.Popen(['node','server.js'],cwd=target,env={**os.environ,'PORT':str(port),'HOST':'127.0.0.1'},stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        try:
            for _ in range(100):
                try: urllib.request.urlopen(base+'/api/health', timeout=.2); break
                except Exception: time.sleep(.05)
            with sync_playwright() as pw:
                browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
                context=browser.new_context(viewport={'width':1440,'height':1024})
                page=context.new_page(); errors=[]; page.on('pageerror',lambda e: errors.append(str(e)))
                # External fonts are not needed to verify behavior.
                page.route('https://fonts.googleapis.com/**', lambda r: r.abort())
                page.goto(base+'/prototype.html?revision=fixture-revision-4')
                page.wait_for_selector('[data-load-state]', state='hidden')
                live=page.frame_locator('[data-review-frame]')
                live.locator('#talk').click(); assert live.locator('#talk').inner_text()=='1'
                page.locator('[data-reload]').click(); page.wait_for_timeout(200)
                assert live.locator('#talk').inner_text()=='0'; print('PASS test mode and reset')
                page.locator('[data-grid-toggle]').click()
                assert page.locator('.review-grid').is_visible()
                live.locator('#talk').click(); assert live.locator('#talk').inner_text()=='1'
                page.locator('[data-mode-button=comment]').click(); page.wait_for_timeout(200)
                assert page.locator('.review-history').is_visible()
                # Grid origin matches the actual UI root, not the iframe margin.
                geo=page.evaluate('''() => {const g=document.querySelector('.review-grid');return {x:parseFloat(g.style.getPropertyValue('--grid-x')),y:parseFloat(g.style.getPropertyValue('--grid-y')),plane:document.querySelector('.review-plane').getBoundingClientRect().toJSON()}}''')
                box=live.locator('[data-dialogue-root]').bounding_box()
                assert abs(geo['x']+geo['plane']['x']-box['x'])<1
                assert abs(geo['y']+geo['plane']['y']-box['y'])<1
                print('PASS grid origin and non-interference')
                # Click through the parent review overlay, not the live DOM target.
                b=live.locator('#title').bounding_box(); page.mouse.click(b['x']+b['width']/2,b['y']+b['height']/2)
                page.wait_for_selector('[data-comment-form]:not([hidden])')
                assert page.locator('[data-anchor-label]').inner_text()=='Selection'
                assert not page.locator('[data-selection-rect]').get_attribute('hidden') == ''
                page.locator('#review-comment').fill('Make this heading smaller')
                page.locator('.composer-send').click(); page.wait_for_timeout(2400)
                assert page.locator('[data-reload]').get_attribute('class').find('has-update')>=0
                assert page.locator('[data-review-title]').inner_text()=='Landline V23.19'
                page.locator('[data-reload]').click(); page.wait_for_timeout(200)
                assert 'Demo 1' in page.locator('[data-review-title]').inner_text()
                assert 'has-update' not in page.locator('[data-reload]').get_attribute('class')
                assert live.locator('#talk').inner_text()=='0'; print('PASS select, simulated result, no autoswitch, green reload')
                # Rewind leaves newer cards above the viewport, not reordered.
                card=page.locator('[data-card-id="fixture-revision-2"]'); card.scroll_into_view_if_needed(); card.click()
                page.locator('[data-card-load="fixture-revision-2"]').click(); page.wait_for_timeout(200)
                assert page.locator('[data-review-title]').inner_text()=='Landline V23.17'
                active_top=page.locator('.activity-card.is-active').bounding_box()['y']
                assert abs(active_top-page.locator('.review-history').bounding_box()['y'])<3
                assert page.locator('[data-history-items]').locator('.activity-card').first.get_attribute('data-card-id').startswith('sim-')
                page.locator('.review-history').evaluate('(el)=>el.scrollTop=0')
                assert page.locator('[data-history-items]').locator('.activity-card').first.is_visible()
                print('PASS history rewind, active card at top, newer cards retained')
                # Area + failure/retry.
                page.locator('[data-tool=area]').click()
                b=live.locator('.dial').bounding_box()
                page.mouse.move(b['x']+5,b['y']+5); page.mouse.down(); page.mouse.move(b['x']+120,b['y']+120,steps=5); page.mouse.up()
                page.wait_for_selector('[data-comment-form]:not([hidden])'); assert page.locator('[data-anchor-label]').inner_text()=='Area'
                page.locator('.simulation-controls summary').click(); page.locator('[data-simulation-scenario]').select_option('failure'); page.locator('.simulation-controls summary').click()
                page.locator('#review-comment').fill('Area feedback'); page.locator('.composer-send').click(); page.wait_for_timeout(1700)
                assert page.locator('[data-request-retry]').count()==1
                page.locator('[data-request-retry]').click(); page.wait_for_timeout(2400)
                assert page.locator('[data-request-retry]').count()==0; print('PASS area, failure, retry')
                # Arrow and cancellation.
                page.locator('[data-tool=arrow]').click()
                b=live.locator('.dial').bounding_box(); page.mouse.move(b['x']+200,b['y']+130); page.mouse.down(); page.mouse.move(b['x']+100,b['y']+100,steps=4); page.mouse.up()
                assert page.locator('[data-anchor-label]').inner_text()=='Arrow'
                page.locator('#review-comment').fill('Arrow feedback'); page.locator('.composer-send').click()
                page.locator('[data-request-cancel]').click(); page.wait_for_timeout(200)
                assert page.locator('.activity-card').filter(has_text='Simulation cancelled').count()==1; print('PASS arrow and cancel')
                # Draft is not dropped by changing mode.
                page.locator('[data-tool=area]').click(); page.mouse.move(b['x']+5,b['y']+5); page.mouse.down(); page.mouse.move(b['x']+30,b['y']+30); page.mouse.up()
                page.locator('#review-comment').fill('Keep this draft')
                page.once('dialog', lambda d:d.dismiss()); page.locator('[data-mode-button=test]').click()
                assert page.locator('#review-comment').input_value()=='Keep this draft'
                page.once('dialog', lambda d:d.accept()); page.locator('[data-close-comment]').click()
                # Spoofed parent message cannot navigate or create a request.
                title=page.locator('[data-review-title]').inner_text()
                page.evaluate("window.postMessage({scope:'dialogue-review',type:'restart-shortcut',channel:'bad'},'*')")
                assert page.locator('[data-review-title]').inner_text()==title
                print('PASS draft guard and foreign message rejection')
                page.screenshot(path=str(target/'dialogue-review-test.png'))
                settings=context.new_page(); settings.goto(base+'/settings.html'); settings.locator('[name=gridOpacity]').select_option('20')
                settings.locator('[name=gridSize]').fill('16'); settings.locator('[name=gridSize]').dispatch_event('change')
                page.wait_for_timeout(200)
                assert page.locator('.review-grid').evaluate("el=>el.style.getPropertyValue('--grid-opacity')")=='0.2'
                settings.reload(); assert settings.locator('[name=gridSize]').input_value()=='16'
                settings.goto(base+'/design-systems.html'); assert settings.locator('.empty-state').is_visible()
                settings.goto(base+'/projects.html?empty=1'); settings.wait_for_selector('[data-project-empty]:not([hidden])')
                assert 'preview' in settings.locator('[data-project-status]').inner_text()
                print('PASS grid preferences and empty states')
                page.set_viewport_size({'width':390,'height':844}); page.wait_for_timeout(200)
                assert page.locator('[data-grid-toggle]').is_visible(); assert page.locator('[data-reload]').is_visible()
                page.screenshot(path=str(target/'dialogue-review-mobile-test.png'))
                assert digest(data)==before, 'Simulation changed stored prototype or metadata bytes'
                assert not errors, errors
                print('PASS no runtime data writes; no viewer JavaScript errors')
                browser.close()
        finally:
            proc.terminate(); proc.wait(timeout=5)

if __name__=='__main__': run()
