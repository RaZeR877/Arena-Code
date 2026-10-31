"""Phone editing acceptance: real touch-enabled Chromium, not physical Android IME."""
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
from playwright.sync_api import sync_playwright
import json
root=Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(root/'dist/pages')));Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page(viewport={'width':360,'height':800},is_mobile=True,has_touch=True,device_scale_factor=2);errors=[];page.on('pageerror',lambda error:errors.append(str(error)));page.on('dialog',lambda dialog:dialog.accept())
  page.goto(f'http://127.0.0.1:{server.server_port}/');page.wait_for_function("VynqodeEditor.engine==='phone'")
  source='const emoji = \"😀\";\nconst value = 1;\nfunction greet(name) {\n  return "Hello " + name;\n}\n'
  project={'name':'Phone fixture','files':{'src/main.js':source,'second.js':'let other = 2;\n','preview.html':'<!doctype html><p>Phone preview</p>'}}
  page.evaluate('project=>Vynqode.openProject(project)',project)
  editor=page.locator('#phoneEditor .cm-content');assert editor.is_visible();assert page.locator('#phoneEditor .cm-line span[class]').count()>0
  assert page.locator('#projectName').inner_text()=='Phone fixture';assert 'App storage' in page.locator('#phoneSaveStatus').inner_text()
  page.evaluate('length=>VynqodeEditor.select(0,length)',len(source.encode('utf-16-le'))//2);page.locator('[data-insert="  "]').tap();assert 'function greet' in page.locator('#codeEditor').input_value();assert page.locator('#codeEditor').input_value().startswith('  const emoji');page.locator('#editUndo').tap();assert page.locator('#codeEditor').input_value()==source
  offset=source.index('😀');page.evaluate('offset=>VynqodeEditor.select(offset+2,0)',offset);page.locator('#caretLeft').tap();assert page.evaluate('VynqodeEditor.position().start')==offset
  editor.tap();page.keyboard.press('Control+End');page.keyboard.type('// phone edit')
  assert page.evaluate('Vynqode.isDirty()');assert 'Unsaved' in page.locator('#phoneSaveStatus').inner_text()
  page.locator('#editUndo').tap();assert page.locator('#codeEditor').input_value()==source
  page.locator('#editRedo').tap();assert page.locator('#codeEditor').input_value().endswith('// phone edit')
  page.locator('#saveFile').tap();assert page.evaluate('Vynqode.getProject().files["src/main.js"]').endswith('// phone edit')
  page.locator('#editUndo').tap();assert page.locator('#codeEditor').input_value()==source # history survives Save
  page.locator('#editRedo').tap();page.locator('#saveFile').tap()
  page.locator('button[data-section="files"]').tap();page.locator('[data-file="second.js"]').tap();assert page.locator('#phoneEditor .cm-content').is_visible();assert page.evaluate('Vynqode.getCurrentFile()')=='second.js'
  editor.tap();page.keyboard.press('Control+End');page.keyboard.type('// second edit');page.locator('#saveFile').tap()
  page.evaluate('()=>Vynqode.switchFile("src/main.js")');page.locator('#editUndo').tap();assert page.locator('#codeEditor').input_value()==source
  # Mode switches preserve the selected range in both directions.
  page.evaluate('()=>VynqodeEditor.select(7,5)');page.locator('#phoneMore').tap();page.locator('#phoneEngineAction').tap();page.wait_for_function('VynqodeEditor.enabled')
  assert page.evaluate('VynqodeEditor.position().start')==7;assert page.evaluate('VynqodeEditor.position().end')==12
  page.locator('#phoneMore').tap();page.locator('#phoneEngineAction').tap();page.wait_for_function("VynqodeEditor.engine==='phone'");assert page.evaluate('VynqodeEditor.position().start')==7;assert page.evaluate('VynqodeEditor.position().end')==12
  page.locator('#saveFile').tap();page.reload();page.wait_for_function("VynqodeEditor.engine==='phone'");assert page.evaluate('Vynqode.getCurrentFile()')=='src/main.js';assert page.evaluate('VynqodeEditor.position().start')==7
  page.locator('#runPreview').tap();assert page.locator('#runPreview').inner_text()=='Edit code';page.locator('#runPreview').tap();assert page.locator('#phoneEditor').is_visible()
  # Every visible primary phone action fits and has a 48px touch target.
  for width,height in [(360,800),(320,760),(360,400),(390,320),(915,400)]:
   page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(80)
   metrics=page.evaluate('''()=>({editor:document.getElementById('phoneEditor').getBoundingClientRect().height,width:document.documentElement.scrollWidth,controls:['editUndo','editRedo','caretLeft','caretRight','mobileComplete','phoneMore','saveFile','runPreview'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,w:r.width,h:r.height,left:r.left,right:r.right};})})''')
   assert metrics['width']<=width,metrics
   assert metrics['editor']>=(200 if height==400 else 140 if height==320 else 400),metrics
   for control in metrics['controls']:assert control['w']>=48 and control['h']>=48 and control['left']>=0 and control['right']<=width,control
  page.set_viewport_size({'width':360,'height':800});page.locator('#phoneMore').tap();assert page.evaluate('VynqodePhone.back()');assert not page.locator('#phoneMenu').is_visible()
  # Real snapshot persistence: automatic checkpoints deduplicate/rotate without deleting manual or referenced snapshots.
  result=page.evaluate('''async()=>{const library=VynqodeLibrary,manual=[];for(let i=0;i<25;i++)manual.push(await library.save({name:'Manual '+i,files:{'a.js':'const manual='+i+';'}}));let limit=false;try{await library.save({name:'Over limit',files:{}});}catch{limit=true;}if(!limit)throw Error('Manual snapshot limit changed');const job=await library.createJob({name:'Protected',files:{'a.js':'const protectedValue=1;'}},'task','fixture');for(let i=0;i<35;i++)await library.checkpoint({name:'Recovery',files:{'a.js':'const value='+i+';'}});const rows=await library.list();return {manual:manual.every(id=>rows.some(row=>row.id===id)),protected:rows.some(row=>row.id===job.snapshotId),automatic:rows.filter(row=>row.kind==='auto').length};}''')
  assert result['manual'] and result['protected'] and result['automatic']<=9,result
  # Primary Save writes a linked native folder explicitly (native transport mocked here).
  page.evaluate('project=>{window.folderWrites=[];window.VynqodeNative={available:true,chooseFolder:async()=>({id:"fixture",project,omitted:[],readOnly:false,hasGit:false}),saveFolder:async request=>{folderWrites.push(request);return {written:["src/main.js"],conflicts:[],partial:false};}};}',project)
  page.locator('#openProjects').tap();page.locator('#openDeviceFolder').tap();page.locator('#projectsDialog').wait_for(state='hidden');assert page.locator('#saveFile').inner_text()=='Save file'
  editor.tap();page.keyboard.press('Control+End');page.keyboard.type('// device edit');page.locator('#saveFile').tap();page.wait_for_function('folderWrites.length===1');assert page.evaluate('folderWrites[0].files["src/main.js"]').endswith('// device edit');assert 'Saved' in page.locator('#phoneSaveStatus').inner_text()
  page.evaluate('()=>{VynqodeNative.saveFolder=async()=>({written:[],conflicts:["src/main.js"],partial:false});}')
  editor.tap();page.keyboard.press('Control+End');page.keyboard.type(' // retained after conflict');page.locator('#saveFile').tap();page.locator('#phoneNotice[open]').wait_for();assert 'Conflicts' in page.locator('#phoneNoticeText').inner_text();assert page.evaluate('Vynqode.getProject().files["src/main.js"]').endswith('// retained after conflict');assert page.evaluate('VynqodePhone.back()')
  page.evaluate('project=>{VynqodeNative.chooseFolder=async()=>({id:"readonly",project,omitted:[],readOnly:true,hasGit:false});}',project)
  page.locator('#openProjects').tap();page.locator('#openDeviceFolder').tap();page.locator('#projectsDialog').wait_for(state='hidden');assert page.locator('#saveFile').inner_text()=='Save in app';assert 'Read-only' in page.locator('#phoneSaveStatus').inner_text();page.locator('#saveFile').tap();assert page.evaluate('folderWrites.length')==1
  assert not errors,errors
  artifacts=root/'test-results';artifacts.mkdir(exist_ok=True);page.screenshot(path=str(artifacts/'phone-editor.png'));page.set_viewport_size({'width':360,'height':400});page.screenshot(path=str(artifacts/'phone-editor-compact.png'))
  print('Touch editor syntax, typing/undo/redo/save, per-file history, selection/engine/reload, file navigation, 48px controls, 200px+ compact editor, checkpoint retention and explicit native-folder Save routing PASS')
  browser.close()
finally:server.shutdown()
