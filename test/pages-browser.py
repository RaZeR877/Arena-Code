"""Vynqode focused IDE end-to-end browser smoke. Uses a mock AI model; no real inference claims."""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright, Error as BrowserError
import functools, os, threading
ROOT=Path(__file__).resolve().parents[1]/'dist'/'pages'
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
  with sync_playwright() as p:
    binary=os.getenv('ARENA_CHROMIUM','/usr/bin/chromium')
    browser=p.chromium.launch(headless=True,executable_path=binary if Path(binary).is_file() else None,args=['--no-sandbox','--disable-dev-shm-usage'])
    context=browser.new_context(viewport={'width':1366,'height':850},accept_downloads=True)
    page=context.new_page();errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.on('dialog',lambda d:d.accept())
    used_fallback=False
    try:
      page.goto(f'http://127.0.0.1:{server.server_port}/',wait_until='domcontentloaded',timeout=8000)
      page.locator('#fileList .file-row').first.wait_for(timeout=5000)
      print('Vynqode browser smoke using HTTP origin')
    except BrowserError:
      used_fallback=True
      page.close();page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
      page.set_content((ROOT/'index.html').read_text(),wait_until='domcontentloaded')
      page.evaluate("""() => { const m=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}}) }""")
      for asset in ['browser-core.js','model-catalog.js','ai-workflow.js','cloud-bridge.js','ide.js']:
        page.add_script_tag(content=(ROOT/asset).read_text())
      page.add_style_tag(content=(ROOT/'ide.css').read_text())
      print('Vynqode browser smoke using inline fallback')
    assert page.title()=='Vynqode — AI Coding IDE'
    assert page.locator('#fileList .file-row').count()==3
    assert page.locator('#assistantPanel').is_visible()
    desktop=ROOT.parents[1]/'test-results'/'vynqode-v013-desktop.png'
    desktop.parent.mkdir(exist_ok=True,parents=True)
    page.screenshot(path=str(desktop),full_page=False)
    assert page.locator('text=Battle').count()==0
    # All cloud providers are visible, but the public static site never accepts raw API keys.
    page.locator('#configureModel').click()
    page.locator('#apiEngineTab').click()
    assert page.locator('#apiProvider option').count()==8
    assert page.locator('#modelDialog input[type=password]').count()==0
    page.locator('#apiConnectionStatus').wait_for(timeout=5000)
    assert page.locator('#connectApi').is_disabled()
    page.locator('#modelDialog [data-close-modal]').click()
    # Functional quick-open, file filtering, and simultaneous editor/preview.
    page.locator('#quickOpen').click()
    page.locator('#quickFileInput').fill('style')
    page.locator('#quickFileResults button').first.click()
    assert 'style.css' in page.locator('#fileBadge').inner_text()
    page.locator('#fileSearch').fill('app')
    assert page.locator('#fileList .file-row:visible').count()==1
    page.locator('#fileSearch').fill('')
    page.locator('#splitTab').click()
    assert page.locator('#editorSurface').is_visible() and page.locator('#previewSurface').is_visible()
    page.locator('#editorTab').click()
    page.locator('[data-file="app.js"]').click()
    page.locator('#codeEditor').fill('const broken = ;')
    page.locator('#saveFile').click()
    page.locator('#checkSyntax').click()
    assert 'syntax issues found' in page.locator('#statusMessage').inner_text()
    page.locator('#undoChange').click()
    assert 'document.querySelector' in page.locator('#codeEditor').input_value()
    page.locator('#runPreview').click()
    preview=page.frame_locator('#previewFrame')
    print('PREVIEW_DIAGNOSTIC:', page.evaluate("""() => {
      const editor=document.getElementById('editorSurface'); const pane=document.getElementById('previewSurface'); const frame=document.getElementById('previewFrame');
      return {view:document.getElementById('previewTab').className, workspace:document.getElementById('editorPanel').className,
        preview:pane.className, paneDisplay:getComputedStyle(pane).display, paneHeight:pane.getBoundingClientRect().height,
        frameHeight:frame.getBoundingClientRect().height,editorDisplay:getComputedStyle(editor).display,
        frameSrcLength:frame.srcdoc.length};
    }"""),flush=True)
    print('ACTION_DIAGNOSTIC:', preview.locator('#action').evaluate("""el => {
      const r=el.getBoundingClientRect(), cs=getComputedStyle(el);
      const doc=el.ownerDocument, body=doc.body, bs=getComputedStyle(body);
      return {display:cs.display,visibility:cs.visibility,opacity:cs.opacity,rect:[r.x,r.y,r.width,r.height],
        parentDisplay:getComputedStyle(el.parentElement).display,bodyDisplay:bs.display,bodyRect:[body.getBoundingClientRect().width,body.getBoundingClientRect().height],
        cssLinks:doc.querySelectorAll('link[rel=stylesheet]').length,style:doc.querySelector('style')?.textContent.slice(0,200)};
    }"""),flush=True)
    preview.locator('#action').wait_for(timeout=5000)
    preview.locator('#action').click(timeout=5000)
    preview.get_by_text('You are building something great!').wait_for(timeout=5000)
    page.locator('#editorTab').click()
    page.evaluate("""() => { window.Vynqode.attachTestEngine({chat:{completions:{create:async ({messages})=>{
       window.vynqodeMockCalls=(window.vynqodeMockCalls||0)+1;
       if(window.vynqodeMockCalls===1)return {choices:[{message:{content:JSON.stringify({summary:'invalid JS',changes:[{path:'new.js',content:'const = ;'}]})}}]};
       return {choices:[{message:{content:JSON.stringify({summary:'new button handler',changes:[{path:'new.js',content:'const a = 42;'}]})}}]};
    }}}},'Mock Model'); }""")
    page.locator('#assistantPrompt').fill('Create a new.js file containing a constant')
    page.locator('#proposeEdits').click()
    page.locator('#reviewDialog[open]').wait_for(timeout=10000)
    assert page.evaluate('window.vynqodeMockCalls')==2
    assert page.locator('#fileList [data-file="new.js"]').count()==0
    page.locator('#approveChanges').click()
    page.locator('#fileList [data-file="new.js"]').wait_for(timeout=5000)
    page.locator('#undoChange').click()
    assert page.locator('#fileList [data-file="new.js"]').count()==0
    with page.expect_download(timeout=8000) as d:
       page.locator('#exportProject').click()
    assert d.value.suggested_filename.endswith('.zip')
    page.set_viewport_size({'width':390,'height':810})
    page.locator('[data-section="assistant"]').click()
    assert page.locator('#assistantPanel').is_visible()
    page.locator('[data-section="editor"]').click()
    assert page.locator('#editorPanel').is_visible()
    if not used_fallback:
      page.reload();page.locator('[data-section="files"]').click();page.locator('#fileList .file-row').first.wait_for(timeout=5000)
    screenshot=ROOT.parents[1]/'test-results'/'vynqode-ide-preview.png'
    screenshot.parent.mkdir(exist_ok=True,parents=True)
    page.screenshot(path=str(screenshot),full_page=False)
    assert not errors,errors
    print('Vynqode: editing, syntax checks, undo, preview, reviewed AI edits, ZIP and responsive layout PASS')
    browser.close()
finally:
  server.shutdown()
