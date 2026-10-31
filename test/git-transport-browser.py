"""Real Git HTTP clone/push/pull against a disposable loopback server.
Native HTTP delegation is mocked; this does not contact or validate GitHub/Android.
"""
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit
import subprocess,os,json,base64
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
def git(*args,cwd=None):return subprocess.check_output(['git',*args],cwd=cwd,stderr=subprocess.DEVNULL,text=True).strip()
with TemporaryDirectory(prefix='vynqode-git-http-') as temp:
 fixture=Path(temp);bare=fixture/'repo.git';seed=fixture/'seed';git('init','--bare','--initial-branch=main',str(bare));git('config','http.receivepack','true',cwd=bare);git('clone',str(bare),str(seed));git('config','user.name','Fixture',cwd=seed);git('config','user.email','fixture@example.test',cwd=seed)
 (seed/'app.js').write_text('const value=1;\n');git('add','.',cwd=seed);git('commit','-m','Initial fixture',cwd=seed);git('push','origin','main',cwd=seed)
 class Handler(SimpleHTTPRequestHandler):
  def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(root/'dist/pages'),**kwargs)
  def log_message(self,*args):pass
  def do_POST(self):
   if self.path!='/fixture-git':self.send_error(404);return
   body=json.loads(self.rfile.read(int(self.headers['Content-Length'])));url=urlsplit(body['url']);path=url.path.removeprefix('/fixture')
   if not path.startswith('/repo.git/') or '..' in path:self.send_error(400);return
   method=body.get('method','GET');content_type='application/x-git-receive-pack-request' if path.endswith('git-receive-pack') else 'application/x-git-upload-pack-request'
   result=subprocess.run(['git','http-backend'],input=base64.b64decode(body.get('body','')),capture_output=True,env={**os.environ,'GIT_PROJECT_ROOT':str(fixture),'GIT_HTTP_EXPORT_ALL':'1','PATH_INFO':path,'QUERY_STRING':url.query,'REQUEST_METHOD':method,'CONTENT_TYPE':content_type,'REMOTE_USER':'fixture'})
   header,_,data=result.stdout.partition(b'\r\n\r\n');headers={};status=200
   for line in header.decode().splitlines():
    name,_,value=line.partition(':');headers[name.lower()]=value.strip()
    if name.lower()=='status':status=int(value.strip().split()[0])
   response=json.dumps({'statusCode':status,'headers':headers,'body':base64.b64encode(data).decode()}).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(response)));self.end_headers();self.wfile.write(response)
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start()
 try:
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path='/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None,args=['--no-sandbox','--disable-dev-shm-usage']);page=browser.new_page();page.goto(f'http://127.0.0.1:{server.server_port}/')
   page.evaluate("""()=>{window.VynqodeNative={available:true,gitRequest:async body=>{const response=await fetch('/fixture-git',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw Error('Fixture HTTP failed');return response.json();}};}""")
   repo=page.evaluate("async()=>{const result=await VynqodeGit.clone('https://github.com/fixture/repo');return result.repo;}")
   assert page.evaluate('repo=>VynqodeGit.project(repo)',repo)['project']['files']['app.js']=='const value=1;\n'
   repo=page.evaluate("async repo=>{const project=(await VynqodeGit.project(repo)).project;project.files['app.js']='const value=2;\\n';await VynqodeGit.commit(repo,project,'Browser fixture commit',{name:'Fixture',email:'fixture@example.test'});const result=await VynqodeGit.push(repo);if(!result.ok)throw Error('Push failed');return repo;}",repo)
   assert 'Browser fixture commit' in git('log','-1','--format=%s',cwd=bare)
   git('pull','--ff-only',cwd=seed);(seed/'remote.js').write_text('const remote=true;\n');git('add','.',cwd=seed);git('commit','-m','Remote advance',cwd=seed);git('push','origin','main',cwd=seed)
   merged=page.evaluate("repo=>VynqodeGit.pull(repo,{name:'Fixture',email:'fixture@example.test'})",repo);repo=merged['repo'];assert merged['fastForward']
   assert page.evaluate('repo=>VynqodeGit.project(repo)',repo)['project']['files']['remote.js']=='const remote=true;\n'
   # A failed fetch must preserve committed local source and HEAD.
   preserved=page.evaluate('repo=>VynqodeGit.log(repo)',repo)[0]['oid']
   page.evaluate("()=>{const transport=VynqodeNative.gitRequest;window.goodTransport=transport;VynqodeNative.gitRequest=async()=>({statusCode:503,headers:{},body:btoa('fixture unavailable')});}")
   failure=page.evaluate("async repo=>{try{await VynqodeGit.pull(repo,{name:'Fixture',email:'fixture@example.test'});return false;}catch{return true;}}",repo);assert failure
   assert page.evaluate('repo=>VynqodeGit.log(repo)',repo)[0]['oid']==preserved
   page.evaluate('()=>{VynqodeNative.gitRequest=window.goodTransport;}')
   # Divergent remote/local commits exercise actual fetch + conflict resolution.
   repo=page.evaluate("async repo=>{const project=(await VynqodeGit.project(repo)).project;project.files['app.js']='const value=3;\\n';await VynqodeGit.commit(repo,project,'Local divergence',{name:'Fixture',email:'fixture@example.test'});return repo;}",repo)
   (seed/'app.js').write_text('const value=4;\n');git('add','.',cwd=seed);git('commit','-m','Remote divergence',cwd=seed);git('push','origin','main',cwd=seed)
   merged=page.evaluate("repo=>VynqodeGit.pull(repo,{name:'Fixture',email:'fixture@example.test'})",repo);assert merged['conflicts']==['app.js'];repo=merged['repo']
   repo.pop('merge',None) # Recover ancestry from the Git journal, even with stale app metadata.
   page.reload();page.evaluate("""()=>{window.VynqodeNative={available:true,gitRequest:async body=>(await fetch('/fixture-git',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json()};}""")
   repo=page.evaluate("async repo=>{const project=(await VynqodeGit.project(repo)).project;project.files['app.js']='const value=5;\\n';await VynqodeGit.commit(repo,project,'Resolved pull',{name:'Fixture',email:'fixture@example.test'});const result=await VynqodeGit.push(repo);if(!result.ok)throw Error('Resolved push failed');return repo;}",repo)
   assert len(git('show','-s','--format=%P','HEAD',cwd=bare).split())==2
   print('Actual Git HTTP via mocked native bridge: clone, pack guard, push, remote fast-forward pull, divergent pull conflict, reload + two-parent resolution/push PASS')
   browser.close()
 finally:server.shutdown()
