"""Real browser Git branch/diff/merge contracts; no model, credentials or network remote."""
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
  page=browser.new_page();page.goto(f'http://127.0.0.1:{server.server_port}/')
  result=page.evaluate(r"""async()=>{
   const g=VynqodeGit,who={name:'Fixture',email:'fixture@example.test'},base={name:'Branches',files:{'app.js':'const value=1;\n','other.js':'const other=1;\n'}};
   let repo=await g.init(base);await g.commit(repo,base,'Initial',who);await g.createBranch(repo,'feature');await g.checkout(repo,'feature');
   const feature={...base,files:{...base.files,'app.js':'const value=2;\n'}};const diff=await g.diff(repo,feature);if(diff.length!==1||diff[0].path!=='app.js')throw Error('Diff did not identify modified file');
   await g.commit(repo,feature,'Feature',who);await g.checkout(repo,'main');
   const main={...base,files:{...base.files,'app.js':'const value=3;\n'}};await g.commit(repo,main,'Main',who);
   let merged=await g.merge(repo,'feature',who);if(merged.conflicts[0]!=='app.js'||!repo.merge)throw Error('Expected text conflict');
   const pending=await g.project(repo);if(!pending.project.files['app.js'].includes('<<<<<<<'))throw Error('No conflict markers');
   let blocked=false;try{await g.checkout(repo,'feature');}catch{blocked=true;}if(!blocked)throw Error('Branch switch accepted during merge');
   blocked=false;try{await g.commit(repo,pending.project,'Unresolved',who);}catch{blocked=true;}if(!blocked)throw Error('Unresolved markers accepted');
   await g.abortMerge(repo);if((await g.project(repo)).project.files['app.js']!==main.files['app.js'])throw Error('Abort lost main source');
   merged=await g.merge(repo,'feature',who);const resolved={...main,files:{...main.files,'app.js':'const value=4;\n'}};await g.commit(repo,resolved,'Resolve both branches',who);
   const log=await g.log(repo);if(log[0].commit.parent.length!==2)throw Error('Merge ancestry lost');
   await g.createBranch(repo,'independent');await g.checkout(repo,'independent');await g.commit(repo,{...resolved,files:{...resolved.files,'new.js':'const added=true;'}},'Independent',who);await g.checkout(repo,'main');
   merged=await g.merge(repo,'independent',who);if(!merged.fastForward||(await g.project(repo)).project.files['new.js']!=='const added=true;')throw Error('Fast-forward failed');
   const branches=await g.branches(repo);if(!branches.local.some(name=>name.startsWith('recovery/')))throw Error('Missing recovery reference');
   await VynqodeLibrary.putRepository(repo);return {repo,branches};
  }""")
  page.locator('#openProjects').click();page.locator('#openGit').click();page.locator('#gitBranch option').first.wait_for(state='attached');assert page.locator('#gitBranch').input_value()=='main'
  page.locator('#gitDiff').click();page.locator('#gitDiffResults details').first.wait_for()
  page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  print('Actual Git: branches, editor diff, conflicting merge/abort, marker rejection, two-parent resolution, fast-forward, recovery refs and mobile Git UI PASS')
  browser.close()
finally:server.shutdown()
