"""Exercise approved tests and repair context through the active UI and real local Node runner."""
import json, os, socket, subprocess, time, shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with socket.socket() as sock:
 sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
child=subprocess.Popen(['node','server.js'],cwd=root,env={**os.environ,'HOST':'127.0.0.1','PORT':str(port),'ARENA_HOSTED_MODE':'0','ARENA_EXECUTION_BACKEND':'host'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
ids=[]
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page();page.on('dialog',lambda d:d.accept())
  def response(r):
   if r.url.endswith('/api/projects/import-zip') and r.ok: ids.append(r.json()['project']['id'])
  page.on('response',response)
  for _ in range(60):
   try: page.goto(f'http://127.0.0.1:{port}/');break
   except Exception: time.sleep(.1)
  project={'name':'Runner browser contract','files':{'package.json':json.dumps({'scripts':{'test':'node --test contract.test.cjs'}}),'contract.test.cjs':"const {test}=require('node:test');const assert=require('node:assert/strict');test('sum',()=>assert.equal(require('./sum.cjs')(2,3),5));",'sum.cjs':'module.exports=(a,b)=>a-b;'}}
  page.locator('#importInput').set_input_files({'name':'runner.json','mimeType':'application/json','buffer':json.dumps(project).encode()})
  page.locator('[data-file="sum.cjs"]').wait_for()
  page.locator('#openTests').click();page.locator('#executeTests').click()
  page.wait_for_function("document.getElementById('testOutput').textContent.includes('exit 1')",timeout=20000)
  assert page.locator('#prepareRepair').is_enabled()
  page.locator('#prepareRepair').click()
  assert 'actual runner output' in page.locator('#assistantPrompt').input_value()
  assert 'sum' in page.locator('#assistantPrompt').input_value()
  page.locator('[data-file="sum.cjs"]').click();page.locator('#codeEditor').fill('module.exports=(a,b)=>a+b;');page.locator('#saveFile').click()
  page.locator('#openTests').click();page.locator('#executeTests').click()
  page.wait_for_function("document.getElementById('testOutput').textContent.includes('exit 0')",timeout=20000)
  assert page.locator('#prepareRepair').is_disabled()
  assert '# pass 1' in page.locator('#testOutput').inner_text()
  assert len(ids)==2
  print('Active IDE -> approved Node tests -> real assertion failure -> repair prompt -> edited source -> 1 passing test PASS')
  browser.close()
finally:
 child.terminate();child.wait(timeout=10)
 for project_id in ids:
  shutil.rmtree(root/'data/projects'/project_id,ignore_errors=True)
