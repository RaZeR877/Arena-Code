'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');const net=require('node:net');const path=require('node:path');const {spawn}=require('node:child_process');
const providers=require('../ai-providers.cjs'),client=require('../public/cloud-bridge.js');
async function freePort(){const s=net.createServer();await new Promise(ok=>s.listen(0,'127.0.0.1',ok));const p=s.address().port;await new Promise(ok=>s.close(ok));return p;}
test('session keys are in-memory, not in any provider discovery payload',()=>{
  const key='test-only-fake-key-0NE001';
  assert.equal(providers.configured('openai',{}),false);
  assert.equal(providers.setSessionKey('openai',key).configured,true);
  assert.equal(providers.effectiveEnv({}).OPENAI_API_KEY,key);
  assert.doesNotMatch(JSON.stringify(providers.listProviders(providers.effectiveEnv({}))),/test-only-fake-key/);
  assert.throws(()=>providers.setSessionKey('ollama',key),/server configuration/);
  assert.throws(()=>providers.setSessionKey('openai','bad\nsecret'),/Invalid API key/);
  assert.equal(providers.removeSessionKey('openai'),true);
  assert.equal(providers.effectiveEnv({}).OPENAI_API_KEY,undefined);
});
test('browser sends a key only to same-origin local session endpoint',async()=>{
  let seen;const fake=async(url,init)=>{seen={url,init};return new Response(JSON.stringify({ok:true}),{status:200})};
  await client.setSessionKey('openai','fake-session-key-ABC',fake);
  assert.equal(seen.url,'./api/ide/credentials');assert.equal(seen.init.credentials,'same-origin');
  assert.equal(seen.init.method,'POST');assert.equal(JSON.parse(seen.init.body).provider,'openai');
  assert.ok(!('Authorization' in seen.init.headers));
  await client.clearSessionKey('openai',fake);assert.equal(seen.init.method,'DELETE');assert.ok(!('apiKey' in JSON.parse(seen.init.body)));
});
test('localhost HTTP credential write requires same origin and is not persistent', {timeout:25000},async()=>{
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',OPENAI_API_KEY:'',ARENA_ALLOW_REMOTE:''},stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
  const post=(method,body,origin=base)=>fetch(base+'/api/ide/credentials',{method,headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
  try {
    let response;for(let i=0;i<80;i++){try{response=await fetch(base+'/api/ide/providers');if(response.ok)break;}catch{}await new Promise(r=>setTimeout(r,80));}
    assert.ok(response?.ok,log);
    const initial=await response.json();assert.equal(initial.providers.find(p=>p.id==='openai').configured,false);
    assert.equal((await post('POST',{provider:'openai',apiKey:'fake-key-do-not-leak'},'https://evil.example')).status,403);
    assert.equal((await post('POST',{provider:'openai',apiKey:'fake-key-do-not-leak'},null)).status,403);
    const good=await post('POST',{provider:'openai',apiKey:'fake-key-do-not-leak'});
    assert.equal(good.status,200,await good.text().catch(()=>''));
    const configured=await (await fetch(base+'/api/ide/providers')).json();
    assert.equal(configured.providers.find(p=>p.id==='openai').configured,true);
    assert.doesNotMatch(JSON.stringify(configured),/fake-key-do-not-leak/);
    const gone=await post('DELETE',{provider:'openai'});assert.equal(gone.status,200);
    const removed=await (await fetch(base+'/api/ide/providers')).json();
    assert.equal(removed.providers.find(p=>p.id==='openai').configured,false);
  } finally {child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,1800).unref()});}
});
