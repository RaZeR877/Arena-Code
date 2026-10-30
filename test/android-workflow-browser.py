"""Android-first workflow contracts in real Chromium. Native APIs are mocked explicitly."""
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
import os
from playwright.sync_api import sync_playwright
import json
root=Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(root/'dist/pages')));Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page(viewport={'width':1440,'height':960});errors=[];page.on('pageerror',lambda error:errors.append(str(error)));page.on('dialog',lambda dialog:dialog.accept())
  page.goto(f'http://127.0.0.1:{server.server_port}/');page.locator('#fileList button').first.wait_for()
  # QuickJS runs actual source with no DOM/network/Native APIs.
  files={'sum.js':'module.exports=(a,b)=>a+b;','contract.test.cjs':"const {test}=require('node:test');const assert=require('node:assert/strict');test('sum',()=>assert.equal(require('./sum')(2,3),5));",'probe.js':"const assert=require('assert');assert.equal(typeof fetch,'undefined');assert.equal(typeof indexedDB,'undefined');assert.equal(typeof VynqodeNative,'undefined');console.log('isolated');",'loop.js':'while(true){}','empty.js':"console.log('no tests')"}
  project={'name':'Android workflow','files':files}
  page.locator('#importInput').set_input_files({'name':'workflow.json','mimeType':'application/json','buffer':json.dumps(project).encode()})
  result=page.evaluate("project=>VynqodePlayground.run(project,'contract.test.cjs',true)",project)
  assert result['ok'] and result['assertions']==1,result
  result=page.evaluate("project=>VynqodePlayground.run(project,'probe.js',true)",project);assert result['ok'] and result['assertions']==3,result
  result=page.evaluate("project=>VynqodePlayground.run(project,'loop.js',false)",project);assert not result['ok'],result
  result=page.evaluate("project=>VynqodePlayground.run(project,'empty.js',true)",project);assert not result['ok'] and 'No assertions' in result['output'],result
  hostile={**project,'files':{**files,'tamper.js':"Object.prototype.toJSON=()=>({ok:true,assertions:999});const {test}=require('node:test');const assert=require('assert');test('must fail',()=>assert.equal(1,2));",'memory.js':"const values=[];while(true)values.push(new Array(100000).fill(42));"}}
  result=page.evaluate("project=>VynqodePlayground.run(project,'tamper.js',true)",hostile);assert not result['ok'] and result['assertions']==1,result
  result=page.evaluate("project=>VynqodePlayground.run(project,'memory.js',false)",hostile);assert not result['ok'],result
  result=page.evaluate("async project=>{const pending=VynqodePlayground.run(project,'loop.js',false);VynqodePlayground.stop();return pending;}",project);assert not result['ok'] and 'cancelled' in result['output'],result
  # Search navigates to a matching source position.
  page.keyboard.press('Control+Shift+f');page.locator('#projectSearchQuery').fill('module.exports')
  page.locator('#projectSearchResults button').first.click();assert 'sum.js' in page.locator('#fileBadge').inner_text()
  # Offline Git commits exercise the actual JS Git engine and IndexedDB filesystem.
  repo=page.evaluate('project=>VynqodeGit.init(project)',project)
  commit=page.evaluate("({repo,project})=>VynqodeGit.commit(repo,project,'Initial source',{name:'Fixture',email:'fixture@example.test'})",{'repo':repo,'project':project});repo=commit['repo']
  logs=page.evaluate('repo=>VynqodeGit.log(repo)',repo);assert len(logs)==1 and logs[0]['commit']['message'].strip()=='Initial source'
  loaded=page.evaluate('repo=>VynqodeGit.project(repo)',repo);assert loaded['project']['files']['sum.js']==files['sum.js']
  # Native provider bridge delegates no browser key; fake inference is explicit.
  page.evaluate("""()=>{window.VynqodeNative={available:true,ai:{providers:async()=>({providers:[{id:'openai',name:'Mock native OpenAI',configured:true,models:['fixture-model']}]}),configure:async id=>{window.nativeConfigured=id;},clear:async()=>({removed:true}),complete:async body=>{window.nativeRequest=body;return {text:JSON.stringify({summary:'native mock change',changes:[{path:'sum.js',content:'module.exports=(a,b)=>a+b+0;'}]})};}}};}""")
  page.locator('#headerConnectAI').click();page.locator('#connectApi').wait_for(state='visible');page.wait_for_function("!document.getElementById('connectApi').disabled")
  assert page.locator('#apiKeySetup').is_hidden();assert page.locator('#nativeApiSetup').is_visible()
  page.locator('#connectApi').click();page.locator('#assistantPrompt').fill('Improve sum.js');page.locator('#proposeEdits').click();page.locator('#reviewDialog[open]').wait_for()
  assert 'apiKey' not in page.evaluate('window.nativeRequest')
  # Pending reviews survive reload and only resume against their original source.
  page.reload();page.locator('#openProjects').click();page.locator('#openTaskHistory').click();page.get_by_role('button',name='Resume review').click();page.locator('#reviewDialog[open]').wait_for();page.locator('#approveChanges').click()
  assert page.evaluate('Vynqode.getProject().files["sum.js"]')=='module.exports=(a,b)=>a+b+0;'
  stale=page.evaluate("async()=>{const job=(await VynqodeLibrary.jobs()).find(job=>job.proposal);try{await Vynqode.resumeReview(job);return false;}catch(error){return error.message;}}")
  assert 'differs' in stale,stale
  # Full approved repair loop with real QuickJS execution and an explicitly mocked model.
  page.evaluate("""()=>{Vynqode.openProject({name:'Device repair',files:{'sum.js':'module.exports=(a,b)=>a-b;','contract.test.cjs':"const assert=require('assert');assert.equal(require('./sum')(2,3),5);"}},'Device repair');window.quickRepairCalls=0;Vynqode.attachTestEngine({chat:{completions:{create:async()=>{window.quickRepairCalls++;return {choices:[{message:{content:JSON.stringify({summary:'Fix sum implementation',changes:[{path:'sum.js',content:'module.exports=(a,b)=>a+b;'}]})}}]};}}}},'Mock repair model');}""")
  page.locator('#openTests').click();page.locator('#testRuntime').select_option('quickjs');page.locator('#jsTestEntry').select_option('contract.test.cjs');assert page.locator('#executeTests').inner_text()=='Run JS tests'
  page.locator('#startRepair').click();page.locator('#reviewDialog[open]').wait_for();assert page.evaluate('Vynqode.getProject().files["sum.js"]')=='module.exports=(a,b)=>a-b;'
  page.locator('#approveChanges').click();page.wait_for_function("document.getElementById('statusMessage').textContent.includes('quickjs checks exited 0')")
  assert page.evaluate('window.quickRepairCalls')==1
  assert page.evaluate('Vynqode.getProject().files["contract.test.cjs"]')=="const assert=require('assert');assert.equal(require('./sum')(2,3),5);"
  # A native folder link must never save an unrelated project after a switch.
  page.evaluate("project=>{window.deviceSaves=0;window.VynqodeNative={available:true,chooseFolder:async()=>({id:'fixture-folder',project,readOnly:false,hasGit:false,omitted:[]}),saveFolder:async()=>{window.deviceSaves++;return {written:[],conflicts:[],partial:false};}};}",project)
  page.locator('#openProjects').click();page.locator('#openDeviceFolder').click();page.locator('#projectsDialog').wait_for(state='hidden')
  page.evaluate("()=>Vynqode.openProject({name:'Other project',files:{'app.js':'const other=1;'}},'Other project')")
  page.locator('#openProjects').click();page.locator('#saveDeviceFolder').click();page.wait_for_function("document.getElementById('deviceFolderStatus').textContent.includes('again')")
  assert page.evaluate('window.deviceSaves')==0
  page.locator('#closeProjects').click()
  page.set_viewport_size({'width':390,'height':844});page.locator('[data-section="editor"]').click();page.locator('#codeEditor').focus()
  page.locator('[data-insert="{}"]').click();assert '{}' in page.locator('#codeEditor').input_value()
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert not errors,errors
  print('QuickJS isolation/assertions/timeout, project search, offline Git commits, mock native provider, resumed review and mobile editing PASS')
  artifacts=Path(os.environ.get('VYNQODE_SCREENSHOT_DIR','/tmp/vynqode-android-draft'));artifacts.mkdir(parents=True,exist_ok=True)
  page.screenshot(path=str(artifacts/'mobile.png'))
  page.set_viewport_size({'width':1440,'height':960});page.screenshot(path=str(artifacts/'desktop.png'))
  # Upgrade a pre-existing v1 snapshot database without losing its project.
  migration=browser.new_page();migration.goto(f'http://127.0.0.1:{server.server_port}/')
  # Use an independent origin so an existing v2 connection cannot mask the migration.
  migration.goto(f'http://localhost:{server.server_port}/')
  migration.evaluate("project=>new Promise((resolve,reject)=>{const request=indexedDB.open('vynqode-library',1);request.onupgradeneeded=()=>request.result.createObjectStore('snapshots',{keyPath:'id'});request.onsuccess=()=>{const db=request.result,tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put({id:'v1-fixture',savedAt:'2026-01-01',project});tx.oncomplete=()=>{db.close();resolve();};};request.onerror=()=>reject(request.error);})",project)
  stored=migration.evaluate('()=>VynqodeLibrary.list()');assert stored[0]['id']=='v1-fixture' and stored[0]['project']['files']==files
  assert migration.evaluate('()=>VynqodeLibrary.jobs()')==[]
  print('Snapshot v1→v2 preservation, VM budgets/tampering, real QuickJS + mock-model approved repair, stale-review and folder-project-switch guards PASS')
  browser.close()
finally:server.shutdown()
