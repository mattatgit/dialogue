"""Opt-in UI regression test. Requires Python Playwright and Chromium.
Copies source to a disposable directory and NEVER reads/writes the real .dialogue-data.
Run: python tests/review-browser.py
Set CHROMIUM_PATH if the browser is not at /usr/bin/chromium.
"""
from pathlib import Path
import hashlib, json, os, shutil, socket, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = '''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#171717;font-family:Arial;font-size:12px}.stage{min-height:100vh;display:grid;place-items:center;padding:24px}.device{width:320px;height:672px;background:#ababab;border-radius:24px;position:relative;padding:24px;box-shadow:0 0 12px #0001}button{cursor:pointer}.title{height:24px;background:#1d1e1d;color:white;border:0;border-radius:8px;width:160px;margin-left:72px;font-size:11px;letter-spacing:1px}.dial{border-radius:50%;width:272px;height:272px;background:#1d1e1d;margin-top:48px;position:relative}.talk{border:0;border-radius:50%;background:#17b239;width:80px;height:80px;position:absolute;left:96px;top:96px;font-size:28px}.status{height:48px;background:#1d1e1d;color:white;border-radius:16px;margin-top:40px;padding:17px}.volume,.meter{background:#1d1e1d;border-radius:16px;height:80px;margin-top:16px;padding:20px;color:white}.meter{background:repeating-linear-gradient(90deg,#17b239 0 8px,transparent 8px 16px),#1d1e1d;background-size:240px 56px,100%;background-repeat:no-repeat;background-position:center}.volume input{width:100%;accent-color:#17b239;margin-top:12px}.slot{position:absolute;width:48px;height:48px;border-radius:50%;background:#070707;left:112px;top:16px}.slot:nth-child(2){left:197px;top:112px}.slot:nth-child(3){left:112px;top:208px}.slot:nth-child(4){left:26px;top:112px}</style></head><body><main class="stage"><section class="landline device"><button id="title" class="title">LANDLINE</button><div class="dial"><i class="slot"></i><i class="slot"></i><i class="slot"></i><i class="slot"></i><button id="talk" class="talk">0</button></div><div class="status">Ready to talk</div><div class="volume">Volume<input type="range" value="25" aria-label="Volume"></div><div class="meter"></div></section></main><script>let count=0;document.querySelector('#talk').onclick=e=>e.target.textContent=++count;</script></body></html>'''

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
                assert page.locator('[data-reload]').inner_text().strip()=='Restart'
                page.locator('[data-reload]').click(); page.wait_for_timeout(200)
                assert live.locator('#talk').inner_text()=='0'; print('PASS Interact mode and Restart reset')
                page.locator('[data-grid-toggle]').click()
                assert page.locator('.review-grid').is_visible()
                live.locator('#talk').click(); assert live.locator('#talk').inner_text()=='1'
                switch_before=page.locator('.review-mode-switch').bounding_box()
                assert abs(switch_before['width']-200)<1
                assert page.locator('[data-mode-button=test]').inner_text().strip()=='Interact'
                assert abs(page.locator('[data-mode-button=test]').bounding_box()['width']-88)<1
                assert abs(page.locator('[data-mode-button=comment]').bounding_box()['width']-88)<1
                assert page.locator('[data-mode-button=test] .mode-icon-active').get_attribute('src')=='assets/interact-white.svg'
                assert page.locator('[data-mode-button=test] .mode-icon-inactive').get_attribute('src')=='assets/interact-grey.svg'
                assert page.locator('[data-mode-button=comment] .mode-icon-active').get_attribute('src')=='assets/comment-white.svg'
                assert page.locator('[data-mode-button=comment] .mode-icon-inactive').get_attribute('src')=='assets/comment-grey.svg'
                prototype_before=page.locator('.review-frame-host').bounding_box()
                canvas_before=page.locator('.review-canvas').bounding_box()
                page.locator('[data-mode-button=comment]').click(); page.wait_for_timeout(160)
                assert page.locator('.review-history').is_visible()
                switch_comment=page.locator('.review-mode-switch').bounding_box()
                prototype_comment=page.locator('.review-frame-host').bounding_box()
                canvas_comment=page.locator('.review-canvas').bounding_box()
                motion=page.locator('.review-canvas').evaluate("""el=>({duration:getComputedStyle(el).transitionDuration,easing:getComputedStyle(el).transitionTimingFunction})""")
                assert abs(switch_before['x']-switch_comment['x'])<1
                assert abs(prototype_before['x']-prototype_comment['x'])<1
                assert abs(canvas_comment['x']-280)<1
                assert abs((canvas_before['width']-canvas_comment['width'])-272)<1
                assert '0.1s' in motion['duration'] and 'ease-out' in motion['easing']
                page.locator('[data-mode-button=test]').click(); page.wait_for_timeout(160)
                switch_test=page.locator('.review-mode-switch').bounding_box()
                prototype_test=page.locator('.review-frame-host').bounding_box()
                canvas_test=page.locator('.review-canvas').bounding_box()
                assert abs(switch_before['x']-switch_test['x'])<1
                assert abs(prototype_before['x']-prototype_test['x'])<1
                assert abs(canvas_before['x']-canvas_test['x'])<1
                page.locator('[data-mode-button=comment]').click(); page.wait_for_timeout(160)
                assert page.locator('.review-history').is_visible()
                prototype_root=live.locator('.landline').bounding_box()
                tools=page.locator('.review-tools').bounding_box()
                assert abs((tools['x']+tools['width']/2)-(prototype_root['x']+prototype_root['width']/2))<1
                print('PASS fixed header/prototype, centred comment toolbar and 100ms ease-out canvas transition')
                # Grid origin matches the actual UI root, not the iframe margin.
                geo=page.evaluate('''() => {const g=document.querySelector('.review-grid');return {x:parseFloat(g.style.getPropertyValue('--grid-x')),y:parseFloat(g.style.getPropertyValue('--grid-y')),plane:document.querySelector('.review-plane').getBoundingClientRect().toJSON()}}''')
                box=live.locator('.landline').bounding_box()
                assert abs(geo['x']+geo['plane']['x']-box['x'])<1
                assert abs(geo['y']+geo['plane']['y']-box['y'])<1
                assert abs((box['x']/8)-round(box['x']/8))<0.01
                assert abs((box['y']/8)-round(box['y']/8))<0.01
                clip=page.locator('.review-frame-host').evaluate("(el)=>el.style.clipPath")
                assert clip=='inset(25px 25px 25px 25px round 24px 24px 24px 24px)', clip
                print('PASS grid origin, prototype root clipping and non-interference')
                # Click through the parent review overlay, not the live DOM target.
                b=live.locator('#title').bounding_box(); page.mouse.click(b['x']+b['width']/2,b['y']+b['height']/2)
                page.wait_for_selector('[data-comment-form]:not([hidden])')
                assert page.locator('[data-anchor-label]').inner_text()=='Selection'
                assert not page.locator('[data-selection-rect]').get_attribute('hidden') == ''
                composer=page.locator('[data-comment-form]'); feedback=page.locator('#review-comment')
                assert composer.get_attribute('data-state')=='focused'
                assert composer.evaluate("el=>getComputedStyle(el).borderColor")=='rgb(186, 230, 255)'
                focus_style=feedback.evaluate("""el=>({outline:getComputedStyle(el).outlineStyle,shadow:getComputedStyle(el).boxShadow})""")
                assert focus_style['outline']=='none' and focus_style['shadow']=='none'
                feedback.evaluate("el=>el.blur()"); page.wait_for_timeout(20)
                assert composer.get_attribute('data-state')=='default'
                assert composer.evaluate("el=>getComputedStyle(el).borderColor")=='rgb(235, 235, 235)'
                feedback.focus(); assert composer.get_attribute('data-state')=='focused'
                close=page.locator('[data-close-comment]')
                assert close.locator('.close-icon-default').get_attribute('src')=='assets/comment-close-default.svg'
                assert close.locator('.close-icon-active').get_attribute('src')=='assets/comment-close-active.svg'
                close.hover(); assert close.evaluate("el=>getComputedStyle(el).backgroundColor")=='rgb(235, 235, 235)'
                close_box=close.bounding_box(); page.mouse.down()
                assert close.evaluate("el=>getComputedStyle(el).backgroundColor")=='rgb(205, 209, 205)'
                page.mouse.move(close_box['x']-10,close_box['y']-10); page.mouse.up()
                feedback.fill('Make this heading smaller. ' * 12)
                assert composer.get_attribute('data-state')=='typing'
                send=page.locator('.composer-send')
                assert send.locator('.enter-icon-default').get_attribute('src')=='assets/comment-enter-default.svg'
                assert send.locator('.enter-icon-active').get_attribute('src')=='assets/comment-enter-active.svg'
                send.hover(); page.wait_for_timeout(80)
                assert 'is-hovered' in (send.get_attribute('class') or '') and 'is-long-hover' not in (send.get_attribute('class') or '')
                enter_hover=send.evaluate("""el=>({w:getComputedStyle(el,'::before').width,opacity:getComputedStyle(el,'::before').opacity,label:getComputedStyle(el.querySelector('.composer-send-label')).opacity})""")
                assert enter_hover['w']=='32px' and enter_hover['opacity']=='1' and enter_hover['label']=='0'
                page.wait_for_timeout(420)
                assert 'is-long-hover' in (send.get_attribute('class') or '')
                enter_long=send.evaluate("""el=>({w:getComputedStyle(el,'::before').width,label:getComputedStyle(el.querySelector('.composer-send-label')).opacity,text:el.querySelector('.composer-send-label').textContent,title:el.getAttribute('title')})""")
                assert enter_long['w']=='69px' and enter_long['label']=='1'
                assert enter_long['text']=='Send' and enter_long['title'] is None
                send_box=send.bounding_box(); page.mouse.down()
                assert send.evaluate("el=>getComputedStyle(el,'::before').backgroundColor")=='rgb(205, 209, 205)'
                page.mouse.move(send_box['x']-10,send_box['y']-10); page.mouse.up()
                print('PASS comment default/focus/typing, close states and Send hover/long-hover/click states')
                send.click(); page.wait_for_timeout(2400)
                assert 'Draft (simulated preview)' in page.locator('[data-review-title]').inner_text()
                draft=page.locator('.activity-card').filter(has=page.locator('.revision-badge',has_text='Draft')).first
                assert draft.get_attribute('aria-current')=='true'
                assert abs(draft.bounding_box()['height']-256)<1
                draft.hover(); page.wait_for_timeout(50)
                assert draft.bounding_box()['height']>256
                page.locator('[data-reload]').hover()
                assert 'has-update' not in (page.locator('[data-reload]').get_attribute('class') or '')
                live.locator('#talk').click(); assert live.locator('#talk').inner_text()=='1'
                page.locator('[data-reload]').click(); page.wait_for_timeout(200)
                assert live.locator('#talk').inner_text()=='0'
                print('PASS successful edit auto-loads as Draft; Restart resets the current state')
                # Every timeline step navigates directly. Clicking Draft while viewing
                # history returns to it; clicking the active Draft opens save controls.
                card=page.locator('[data-card-id="fixture-revision-2"]'); card.scroll_into_view_if_needed(); card.click(); page.wait_for_timeout(200)
                assert page.locator('[data-review-title]').inner_text()=='Landline V23.17'
                active_top=page.locator('.activity-card.is-active').bounding_box()['y']
                assert abs(active_top-page.locator('.review-history').bounding_box()['y'])<3
                page.locator('.review-history').evaluate('(el)=>el.scrollTop=0')
                draft=page.locator('.activity-card').filter(has=page.locator('.revision-badge',has_text='Draft')).first
                draft.click(); page.wait_for_timeout(200)
                assert 'Draft (simulated preview)' in page.locator('[data-review-title]').inner_text()
                draft=page.locator('.activity-card').filter(has=page.locator('.revision-badge',has_text='Draft')).first
                draft.click(); page.wait_for_timeout(50)
                assert draft.locator('[data-card-save]').inner_text()=='Save version'
                assert abs(draft.bounding_box()['height']-304)<1
                draft.locator('[data-card-cancel]').click(); page.wait_for_timeout(50)
                draft=page.locator('.activity-card').filter(has=page.locator('.revision-badge',has_text='Draft')).first
                assert draft.locator('[data-card-save]').count()==0
                draft.click(); draft.locator('[data-card-save]').click(); page.wait_for_timeout(100)
                draft=page.locator('.activity-card').filter(has=page.locator('.revision-badge',has_text='Draft')).first
                assert draft.locator('[data-card-save]').inner_text()=='Saved version'
                page.wait_for_timeout(2100)
                version=page.locator('.activity-card').filter(has=page.locator('.revision-badge',has_text='V23.20')).first
                assert version.count()==1 and version.get_attribute('aria-current')=='true'
                assert 'V23.20 (simulated preview)' in page.locator('[data-review-title]').inner_text()
                print('PASS Draft navigation, cancel, Save version confirmation and promotion to V23.20')
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
                # Arrow can start outside the prototype, points toward the release
                # target, and places the comment box/terminal ball at the start.
                page.locator('[data-tool=arrow]').click()
                hb=page.locator('.review-frame-host').bounding_box(); b=live.locator('.dial').bounding_box()
                start={'x':hb['x']+hb['width']+40,'y':b['y']+130}
                end={'x':b['x']+100,'y':b['y']+100}
                page.mouse.move(start['x'],start['y']); page.mouse.down(); page.mouse.move(end['x'],end['y'],steps=4); page.mouse.up()
                assert page.locator('[data-anchor-label]').inner_text()=='Arrow'
                cb=page.locator('[data-comment-form]').bounding_box()
                assert abs(cb['x']-start['x'])<2
                assert abs((cb['y']+30)-start['y'])<2
                line=page.locator('[data-selection-arrow]').evaluate("""el=>{const p=document.querySelector('.review-plane').getBoundingClientRect();return {x:p.x+Number(el.getAttribute('x1')),y:p.y+Number(el.getAttribute('y1')),x2:p.x+Number(el.getAttribute('x2')),y2:p.y+Number(el.getAttribute('y2'))}}""")
                assert abs(line['x']-start['x'])<2 and abs(line['y']-start['y'])<2
                assert abs(line['x2']-end['x'])<2 and abs(line['y2']-end['y'])<2
                page.locator('#review-comment').fill('Arrow feedback'); page.locator('.composer-send').click(); page.wait_for_timeout(2400)
                draft=page.locator('.activity-card').filter(has=page.locator('.revision-badge',has_text='Draft')).first
                edited=page.locator('.activity-card').filter(has=page.locator('.revision-badge',has_text='Edited')).first
                assert draft.count()==1 and edited.count()>=1
                assert draft.get_attribute('aria-current')=='true'
                print('PASS canvas-wide arrow plus Draft/Edited checkpoint labels')
                # Closing/navigating intentionally discards unsent drafts without a browser warning.
                page.locator('[data-tool=area]').click(); page.mouse.move(b['x']+5,b['y']+5); page.mouse.down(); page.mouse.move(b['x']+30,b['y']+30); page.mouse.up()
                page.locator('#review-comment').fill('Discard this draft')
                page.locator('[data-mode-button=test]').click()
                assert page.locator('[data-comment-form]').is_hidden()
                assert page.locator('#review-comment').input_value()==''
                assert page.locator('[data-mode-button=test]').get_attribute('aria-pressed')=='true'
                print('PASS frictionless draft discard with no browser dialog')
                # Spoofed parent message cannot navigate or create a request.
                title=page.locator('[data-review-title]').inner_text()
                page.evaluate("window.postMessage({scope:'dialogue-review',type:'restart-shortcut',channel:'bad'},'*')")
                assert page.locator('[data-review-title]').inner_text()==title
                print('PASS foreign message rejection')
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
