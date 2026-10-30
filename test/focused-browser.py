"""Real Chromium tests for bundled Monaco, recovery and project snapshots; no inference."""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(root/'dist/pages')))
Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page(viewport={'width':1440,'height':960})
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
  page.goto(f'http://127.0.0.1:{server.server_port}/')
  page.locator('#codeEditor').fill('<html><body>Recovered draft</body></html>')
  page.wait_for_function("localStorage.getItem('vynqode-editor-draft-v1') !== null")
  page.reload()
  assert page.locator('#codeEditor').input_value()=='<html><body>Recovered draft</body></html>'
  assert 'Recovered unsaved draft' in page.locator('#statusMessage').inner_text()
  page.locator('#saveFile').click()
  page.locator('#openProjects').click();page.locator('#saveSnapshot').click()
  page.locator('.snapshot-row').wait_for()
  assert page.locator('.snapshot-row').count()==1
  page.locator('#closeProjects').click()
  page.locator('#codeEditor').fill('<html><body>Changed after snapshot</body></html>');page.locator('#saveFile').click()
  page.locator('#openProjects').click();page.locator('.snapshot-row button',has_text='Open').click()
  assert page.locator('#codeEditor').input_value()=='<html><body>Recovered draft</body></html>'
  page.locator('[data-file="app.js"]').click()
  page.locator('#toggleSmartEditor').click()
  page.wait_for_function('window.VynqodeEditor.enabled',timeout=20000)
  assert page.locator('#codeEditor').is_hidden()
  assert page.locator('#smartEditor .monaco-editor').is_visible()
  page.locator('#smartEditor .view-lines').click()
  page.keyboard.press('Control+End');page.keyboard.type('\nconst fromSmartEditor = 42;')
  page.locator('#saveFile').click()
  assert 'const fromSmartEditor = 42;' in page.evaluate('window.Vynqode.getProject().files["app.js"]')
  completions=page.evaluate("""async()=>{const m=monaco.editor.getModels().find(m=>m.uri.path.endsWith('/app.js'));const worker=await monaco.languages.typescript.getJavaScriptWorker();const service=await worker(m.uri);return service.getCompletionsAtPosition(m.uri.toString(),m.getValueLength(),{});} """)
  assert completions and len(completions['entries'])>0
  page.locator('[data-file="style.css"]').click()
  assert page.evaluate("monaco.editor.getModels().some(m=>m.getLanguageId()==='css')")
  page.locator('[data-file="app.js"]').click()
  page.screenshot(path=str(root/'test-results/vynqode-smart-editor.png'))
  page.locator('#toggleSmartEditor').click()
  assert 'fromSmartEditor' in page.locator('#codeEditor').input_value()
  assert not errors,errors
  print('Monaco keyboard editing, bundled language worker/completion, saved files, draft recovery and snapshot restore PASS')
  browser.close()
finally: server.shutdown()
