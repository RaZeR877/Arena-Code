"""Bounded AI repair orchestration with a mocked model and actual Node tests."""
import json,os,socket,subprocess,time,shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
child=subprocess.Popen(['node','server.js'],cwd=root,env={**os.environ,'HOST':'127.0.0.1','PORT':str(port),'ARENA_HOSTED_MODE':'0','ARENA_EXECUTION_BACKEND':'host'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
ids=[]
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page(viewport={'width':1440,'height':960});page.on('dialog',lambda d:d.accept())
  def response(r):
   if r.url.endswith('/api/projects/import-zip') and r.ok:ids.append(r.json()['project']['id'])
  page.on('response',response)
  for _ in range(60):
   try:page.goto(f'http://127.0.0.1:{port}/');break
   except Exception:time.sleep(.1)
  project={'name':'Repair contract','files':{'package.json':json.dumps({'scripts':{'test':'node --test contract.test.cjs'}}),'contract.test.cjs':"const {test}=require('node:test');const assert=require('node:assert/strict');test('sum',()=>assert.equal(require('./sum.cjs')(2,3),5));",'sum.cjs':'module.exports=(a,b)=>a-b;'}}
  def import_project():
   page.locator('#importInput').set_input_files({'name':'repair.json','mimeType':'application/json','buffer':json.dumps(project).encode()})
   page.locator('[data-file="sum.cjs"]').wait_for()
  def engine(path,content):
   page.evaluate("""({path,content})=>{window.repairCalls=0;Vynqode.attachTestEngine({chat:{completions:{create:async()=>{window.repairCalls++;return {choices:[{message:{content:JSON.stringify({summary:'Repair',changes:[{path,content}]})}}]};}}}},'Mock repair model');} """,{'path':path,'content':content})
  def begin():page.locator('#openTests').click();page.locator('#startRepair').click()
  import_project();engine('sum.cjs','module.exports=(a,b)=>a+b;');begin()
  page.locator('#reviewDialog[open]').wait_for(timeout=15000)
  assert page.evaluate('Vynqode.getProject().files["sum.cjs"]')=='module.exports=(a,b)=>a-b;'
  page.locator('#approveChanges').click()
  page.wait_for_function("document.getElementById('statusMessage').textContent.includes('Repair loop complete')",timeout=15000)
  assert '# pass 1' in page.locator('#testOutput').inner_text()
  assert page.evaluate('window.repairCalls')==1
  # Attempts to rewrite test contracts are rejected before approval.
  import_project();engine('contract.test.cjs',"console.log('fake pass')");begin()
  page.wait_for_function("document.getElementById('statusMessage').textContent.includes('protected test contracts')",timeout=15000)
  assert page.evaluate('Vynqode.getProject().files["contract.test.cjs"]')==project['files']['contract.test.cjs']
  # Two well-formed but incorrect patches exhaust the loop instead of running forever.
  import_project();engine('sum.cjs','module.exports=(a,b)=>0;');begin()
  for _ in range(2):
   page.locator('#reviewDialog[open]').wait_for(timeout=15000);page.locator('#approveChanges').click()
  page.wait_for_function("document.getElementById('statusMessage').textContent.includes('Repair limit reached')",timeout=15000)
  assert page.evaluate('window.repairCalls')==2
  assert '# fail 1' in page.locator('#testOutput').inner_text()
  # Cancelling while inference is pending discards its late result.
  import_project()
  page.evaluate("""()=>{window.modelPending=false;Vynqode.attachTestEngine({chat:{completions:{create:()=>new Promise(resolve=>{window.modelPending=true;window.finishModel=()=>resolve({choices:[{message:{content:JSON.stringify({summary:'late patch',changes:[{path:'sum.cjs',content:'module.exports=(a,b)=>a+b;'}]})}}]});})}}},'Delayed mock');}""")
  begin();page.wait_for_function('window.modelPending',timeout=15000)
  page.locator('#stopRepair').click();page.evaluate('window.finishModel()')
  page.wait_for_function("document.getElementById('statusMessage').textContent.includes('cancelled')")
  assert page.locator('#reviewDialog').is_hidden()
  assert page.evaluate('Vynqode.getProject().files["sum.cjs"]')==project['files']['sum.cjs']
  # Equal revision numbers in different projects must never admit stale patches.
  page.evaluate("window.modelPending=false;window.finishModel=null")
  page.locator('#assistantPrompt').fill('Fix the implementation')
  page.locator('#proposeEdits').click();page.wait_for_function('window.modelPending')
  page.evaluate("()=>{const revision=Vynqode.getProject().revision;Vynqode.openProject({name:'Different project',revision,files:{'sum.cjs':'module.exports=()=>99;'}});window.finishModel();}")
  page.wait_for_function("document.getElementById('statusMessage').textContent.includes('Project changed while')")
  assert page.locator('#reviewDialog').is_hidden()
  assert page.evaluate('Vynqode.getProject().files["sum.cjs"]')=='module.exports=()=>99;'
  print('Mock model + real red/green tests: approval gate, protected tests, successful repair and bounded failure loop PASS')
  browser.close()
finally:
 child.terminate();child.wait(timeout=10)
 for id in ids:shutil.rmtree(root/'data/projects'/id,ignore_errors=True)
