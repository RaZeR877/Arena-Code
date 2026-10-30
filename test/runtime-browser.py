"""Real browser, PTY and Inspector integration. No mocked runtime."""
import json,os,socket,subprocess,time,shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
child=subprocess.Popen(['node','server.js'],cwd=root,env={**os.environ,'HOST':'127.0.0.1','PORT':str(port),'ARENA_HOSTED_MODE':'0'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
ids=[]
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page(viewport={'width':1440,'height':960});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
  def response(r):
   if r.url.endswith('/api/projects/import-zip') and r.ok:ids.append(r.json()['project']['id'])
  page.on('response',response)
  for _ in range(60):
   try:page.goto(f'http://127.0.0.1:{port}/');break
   except Exception:time.sleep(.1)
  project={'name':'Runtime browser','files':{'main.cjs':'const seed = 4;\nconst result = seed + 3;\nconsole.log(result);\n'}}
  page.locator('#importInput').set_input_files({'name':'runtime.json','mimeType':'application/json','buffer':json.dumps(project).encode()})
  page.locator('[data-file="main.cjs"]').wait_for()
  before=page.locator('#filesPanel').bounding_box()['width']
  page.get_by_role('separator',name='Resize file explorer').press('ArrowRight')
  assert page.locator('#filesPanel').bounding_box()['width']>before
  page.locator('#openRuntime').click();page.locator('#startTerminal').click()
  page.locator('#terminalSurface .xterm').wait_for()
  page.locator('#terminalSurface .xterm-helper-textarea').focus()
  page.keyboard.type("printf 'terminal edit' > terminal.txt\r",delay=15)
  for _ in range(80):
   if ids and (root/'data/projects'/ids[-1]/'terminal.txt').exists():break
   page.wait_for_timeout(100)
  assert (root/'data/projects'/ids[-1]/'terminal.txt').read_text()=='terminal edit'
  page.locator('#importRuntime').click()
  page.locator('#stopTerminal').click()
  page.locator('#startDebugger').click()
  page.wait_for_function("document.getElementById('debugState').textContent==='Paused'",timeout=15000)
  page.locator('#breakpointLine').fill('3');page.locator('[data-debug-action="breakpoint"]').click();page.locator('[data-debug-action="resume"]').click()
  page.wait_for_function("document.getElementById('debugLocals').textContent.includes('result = 7')",timeout=15000)
  page.locator('[data-debug-action="stepOver"]').click()
  page.wait_for_function("document.getElementById('debugOutput').textContent.includes('7')")
  page.screenshot(path=str(root/'test-results/vynqode-runtime.png'))
  page.locator('#closeRuntime').click()
  page.locator('[data-file="terminal.txt"]').click()
  assert page.locator('#codeEditor').input_value()=='terminal edit'
  page.set_viewport_size({'width':390,'height':844})
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert page.get_by_role('separator',name='Resize file explorer').is_hidden()
  assert not errors,errors
  print('Real xterm keyboard -> PTY file edit -> import; Node breakpoint/local variables/step; keyboard panel resizing and mobile layout PASS')
  browser.close()
finally:
 child.terminate();child.wait(timeout=10)
 for id in ids:shutil.rmtree(root/'data/projects'/id,ignore_errors=True)
