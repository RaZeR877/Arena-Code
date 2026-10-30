'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {spawn}=require('node:child_process');const net=require('node:net');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..');const core=require('../pages/browser-core.js');
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function until(fn,what){for(let i=0;i<100;i++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,70));}throw Error('Timed out: '+what);}
test('real localhost PTY and Inspector support interactive edits, breakpoints, stepping and guarded access',{timeout:35000},async()=>{
 const p=await port(),origin='http://127.0.0.1:'+p;const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:String(p),ARENA_HOSTED_MODE:'0',SERVER_ONLY_SECRET:'server-only-test-marker'},stdio:['ignore','pipe','pipe']});let logs='';child.stderr.on('data',b=>logs+=b);child.stdout.on('data',b=>logs+=b);let projectId;const sessions=[];
 const request=async(route,body,method=body?'POST':'GET',source=origin)=>{const response=await fetch(origin+route,{method,headers:{Origin:source,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};};
 try{
  await until(async()=>{try{return (await request('/api/ide/runtime')).status===200;}catch{return false;}},logs);
  assert.equal((await request('/api/ide/runtime',{},'POST','https://evil.example')).status,403);
  assert.equal((await request('/api/ide/runtime',{},'POST','http://localhost:'+p)).status,403);
  assert.equal((await fetch(origin+'/api/ide/runtime',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  const files={'main.cjs':'const seed = 4;\nconst result = seed + 3;\nconsole.log(result);\n'};
  const imported=await request('/api/projects/import-zip',{name:'runtime contract',archive:Buffer.from(core.zip(core.normalize({name:'runtime contract',files}))).toString('base64')});projectId=imported.data.project.id;
  const created=await request('/api/ide/runtime',{projectId,kind:'terminal'});assert.equal(created.status,201,JSON.stringify(created.data));const term=created.data.id;sessions.push(term);
  await request('/api/ide/runtime/'+term,{input:"printf 'from terminal' > changed.txt\nprintf 'TERMINAL_OK\\n'\n"});
  await until(async()=>{const r=await request('/api/ide/runtime/'+term);return r.data.output.includes('TERMINAL_OK')&&fs.existsSync(path.join(root,'data/projects',projectId,'changed.txt'));},'terminal write');
  assert.equal(fs.readFileSync(path.join(root,'data/projects',projectId,'changed.txt'),'utf8'),'from terminal');
  await request('/api/ide/runtime/'+term,{input:"printf '%s' \"${SERVER_ONLY_SECRET-unset}\" > environment.txt\n"});
  await until(async()=>fs.existsSync(path.join(root,'data/projects',projectId,'environment.txt')),'filtered environment');
  assert.equal(fs.readFileSync(path.join(root,'data/projects',projectId,'environment.txt'),'utf8'),'unset');
  const debug=await request('/api/ide/runtime',{projectId,kind:'debug',path:'main.cjs'});assert.equal(debug.status,201,JSON.stringify(debug.data));const id=debug.data.id;sessions.push(id);
  await until(async()=>{const r=await request('/api/ide/runtime/'+id);return r.data.paused&&r.data.frames.length;},'initial pause');
  assert.equal((await request('/api/ide/runtime/'+id,{action:'evaluate',expression:'process.exit()'})).status,400);
  assert.equal((await request('/api/ide/runtime/'+id,{action:'breakpoint',line:3})).status,200);
  await request('/api/ide/runtime/'+id,{action:'resume'});
  const paused=await until(async()=>{const r=await request('/api/ide/runtime/'+id);return r.data.paused&&r.data.frames[0]?.line===3&&r.data;},'line breakpoint');
  assert.ok(paused.locals.some(v=>v.name==='result'&&v.value==='7'),JSON.stringify(paused));
  assert.equal((await request('/api/ide/runtime/'+id,{action:'stepOver'})).status,200);
  await until(async()=>{const r=await request('/api/ide/runtime/'+id);return r.data.output.includes('7');},'stepped output');
 }finally{for(const id of sessions)await request('/api/ide/runtime/'+id,null,'DELETE').catch(()=>{});child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));if(projectId)fs.rmSync(path.join(root,'data/projects',projectId),{recursive:true,force:true});}
});
