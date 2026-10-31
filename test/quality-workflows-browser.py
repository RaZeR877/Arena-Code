"""Real edit/diagnostic/functional test execution. Model responses are explicit fixtures."""
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(root/'dist/pages')));Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page(viewport={'width':1440,'height':960});errors=[];page.on('pageerror',lambda error:errors.append(str(error)+'\n'+error.stack));page.on('dialog',lambda dialog:dialog.accept());page.goto(f'http://127.0.0.1:{server.server_port}/')
  project={'name':'Quality workflows','files':{'app.js':'const needle=1;','other.js':'const needle=2;','config.json':'{"enabled":true}'}}
  page.evaluate('project=>Vynqode.openProject(project)',project)
  page.keyboard.press('Control+Shift+f');page.locator('#projectSearchQuery').fill('needle');page.locator('#projectReplaceText').fill('renamed');page.locator('#projectReplaceReview').click();assert page.locator('#projectReplacePreview details').count()==2
  assert page.evaluate('Vynqode.getProject().files["app.js"]')=='const needle=1;'
  page.locator('#projectReplaceApply').click();assert page.evaluate('Vynqode.getProject().files["other.js"]')=='const renamed=2;'
  page.locator('#undoChange').click();assert page.evaluate('Vynqode.getProject().files["other.js"]')=='const needle=2;'
  page.locator('#agentContext').click();page.locator('#contextFiles label',has_text='other.js').locator('input').check();assert page.evaluate('VynqodeWorkspaceUI.contextPaths()')==['other.js'];page.locator('#closeContext').click()
  page.evaluate('project=>Vynqode.openProject(project)',{'name':'Other','files':{'config.json':'{"enabled":true}'}})
  assert page.evaluate('VynqodeWorkspaceUI.contextPaths()')==[]
  page.locator('#editorOptions').click();page.locator('#editorFontSize').select_option('18');page.locator('#editorWordWrap').check();page.locator('#formatCurrentFile').click();assert '  \"enabled\": true' in page.locator('#codeEditor').input_value();page.locator('#closeEditorSettings').click();page.locator('#saveFile').click();page.reload();assert page.locator('#codeEditor').evaluate('(el)=>getComputedStyle(el).fontSize')=='18px'
  # Actual syntax diagnostics and navigation.
  page.evaluate('()=>Vynqode.openProject({name:"Diagnostics",files:{"bad.js":"const broken = ;","other.js":"const valid = 1;"}})')
  page.locator('#editorOptions').click();page.locator('#editorShowProblems').click();page.locator('#problemsResults button').first.click();assert 'bad.js' in page.locator('#fileBadge').inner_text()
  # Real bundled language worker sees types across relative project modules.
  page.evaluate(r"""()=>Vynqode.openProject({name:'Language service',files:{'main.js':"const {double}=require('./lib'); double('wrong');",'lib.js':"/** @param {number} n */ exports.double=n=>n*2;"}})""")
  page.locator('[data-file="main.js"]').click();page.locator('#toggleSmartEditor').click();page.wait_for_function('VynqodeEditor.enabled')
  diagnostics=page.evaluate("async()=>{const model=monaco.editor.getModels().find(model=>model.uri.path.endsWith('/main.js'));const factory=await monaco.languages.typescript.getJavaScriptWorker();const worker=await factory(model.uri);return worker.getSemanticDiagnostics(model.uri.toString());}")
  assert any(issue['code']==2345 for issue in diagnostics),diagnostics
  page.locator('#toggleSmartEditor').click()
  # Actual QuickJS red/green contracts with a mock model, without editing the user project.
  result=page.evaluate(r"""async()=>{const before=JSON.stringify(Vynqode.getProject());let calls=0;const engine={chat:{completions:{create:async({messages})=>{calls++;const task=messages[1].content;let changes;if(task.includes('Fix sum.js'))changes=[{path:'sum.js',content:'module.exports=(a,b)=>a+b;'}];else if(task.includes('Both implementations'))changes=[{path:'multiply.js',content:'module.exports=(a,b)=>a*b;'},{path:'rectangle.js',content:"module.exports=(w,h)=>require('./multiply')(w,h);"}];else changes=[{path:'config.js',content:"exports.load=(env,defaults)=>({...defaults,port:/^[0-9]+$/.test(env.PORT||'')?Number(env.PORT):defaults.port,debug:/^(true|false)$/i.test(env.DEBUG||'')?env.DEBUG.toLowerCase()==='true':defaults.debug});"}];return {choices:[{message:{content:JSON.stringify({summary:'Fixture model solution',changes})}}]};}}}};const report=await ArenaAIWorkflow.evaluateFunctional(engine,(...args)=>VynqodePlayground.run(...args));if(before!==JSON.stringify(Vynqode.getProject()))throw Error('Evaluation modified user project');return {report,calls};}""")
  assert result['report']['passed']==3 and result['calls']==3,result
  page.set_viewport_size({'width':390,'height':400});page.evaluate('()=>Vynqode.setSection("editor")');page.wait_for_function("VynqodeEditor.engine==='phone'");assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert page.locator('.workspace-footer').bounding_box()['y']<400
  page.evaluate("()=>{const view=VynqodeEditor.phoneView;if(!view)throw Error('Touch editor unavailable');const text='const personName=42; per';view.dispatch({changes:{from:0,to:view.state.doc.length,insert:text},selection:{anchor:text.length}});}");page.locator('#mobileComplete').click();page.locator('.cm-tooltip-autocomplete').wait_for();assert 'personName' in page.locator('.cm-tooltip-autocomplete').inner_text();page.keyboard.press('Escape')
  page.evaluate("()=>{window.VynqodeNative={available:true,openCompanion:async()=>{window.companionOpened=true;return {opened:true};}};}")
  page.locator('#phoneMore').click();page.locator('[data-phone-action="openRuntime"]').click();assert page.locator('#nativeCompanion').is_visible();assert page.locator('.runtime-columns').is_hidden();page.locator('#companionOpen').click();page.wait_for_function('window.companionOpened===true');page.locator('#closeRuntime').click()
  while page.locator('.close-file-tab').count():page.locator('.close-file-tab').first.click()
  page.locator('#mobileComplete').click();assert 'Open a source file' in page.locator('#statusMessage').inner_text()
  assert not errors,errors
  print('Reviewed multi-file replacement/undo, context pins/reset, persisted editor settings, diagnostics navigation, 3 actual QuickJS red/green tasks with mock model, short mobile viewport PASS')
  browser.close()
finally:server.shutdown()
