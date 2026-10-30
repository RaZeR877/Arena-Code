'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');
const net=require('node:net');const path=require('node:path');const {spawn}=require('node:child_process');
async function freePort(){const s=net.createServer();await new Promise(ok=>s.listen(0,'127.0.0.1',ok));const p=s.address().port;await new Promise(ok=>s.close(ok));return p;}
async function mockServer(){const server=http.createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part.toString();const body=JSON.parse(raw);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'simulated backend response: '+body.messages.at(-1).content}}]}));});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));return server;}
test('local Node provider bridge routes approved server-side requests and denies cross-origin calls', {timeout:25000},async()=>{
 const provider=await mockServer();const backendPort=await freePort();
 const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(backendPort),HOST:'127.0.0.1',VYNQODE_CUSTOM_API_KEY:'placeholder-secret-do-not-display',VYNQODE_CUSTOM_API_BASE_URL:`http://127.0.0.1:${provider.address().port}/v1/`,VYNQODE_CUSTOM_MODELS:'fake-model'},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',d=>logs+=d.toString());child.stderr.on('data',d=>logs+=d.toString());
 const base=`http://127.0.0.1:${backendPort}`;
 try {
  let response;for(let i=0;i<60;i++){try{response=await fetch(`${base}/api/ide/providers`);if(response.ok)break;}catch{}await new Promise(r=>setTimeout(r,90));}
  assert.ok(response?.ok,'local server did not respond: '+logs);
  const listed=await response.json();const custom=listed.providers.find(x=>x.id==='custom');
  assert.ok(custom?.configured);assert.deepEqual(custom.models,['fake-model']);assert.doesNotMatch(JSON.stringify(listed),/placeholder-secret-do-not-display/);
  const body={provider:'custom',model:'fake-model',messages:[{role:'user',content:'hello project'}]};
  const good=await fetch(`${base}/api/ide/complete`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(body)});
  assert.equal(good.status,200,await good.text().catch(()=>''));
  const again=await fetch(`${base}/api/ide/complete`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(body)});
  assert.equal((await again.json()).text,'simulated backend response: hello project');
  const rejected=await fetch(`${base}/api/ide/complete`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:JSON.stringify(body)});
  assert.equal(rejected.status,403);
  const unknown=await fetch(`${base}/api/ide/complete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,model:'unapproved-model'})});
  assert.equal(unknown.status,400);
 } finally {child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,1800).unref();});await new Promise(ok=>provider.close(ok));}
});
