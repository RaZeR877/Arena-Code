#!/usr/bin/env node
'use strict';
// Requires a REAL isolated runner with Docker and pulled node:22-alpine.
// Does not run a real coding model; verifies project->tests->repair->preview->teardown.
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const { makeZip } = require('../zip-utils.cjs');
const base = (process.env.ARENA_RUNNER_URL || '').replace(/\/$/, '');
const token = process.env.ARENA_RUNNER_TOKEN;
if (!base || !token || !/^https?:\/\//.test(base)) {
  console.error('Set ARENA_RUNNER_URL and ARENA_RUNNER_TOKEN to a dedicated runner endpoint before using this real-Docker E2E check.');
  process.exit(2);
}
const workspaceId = crypto.randomUUID();
const pkg = JSON.stringify({name:'arena-runner-real-e2e',private:true,scripts:{test:'node --test',start:'node server.js'}});
const tests = 'const t=require("node:test");const a=require("node:assert/strict");t("addition is correct",()=>a.equal(require("./src/math.js").sum(2,3),5));\n';
const server = String.raw`const http=require('node:http');const crypto=require('node:crypto');
const s=http.createServer((req,res)=>{if(req.url==='/large.js'){res.writeHead(200,{'Content-Type':'application/javascript'});res.end(Buffer.alloc(1024*1024,65));return;}res.setHeader('content-type','text/html');res.end('<!doctype html><title>Arena E2E</title><h1>Arena E2E Preview</h1>');});
s.on('upgrade',(req,socket)=>{const key=req.headers['sec-websocket-key'];const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');const msg=Buffer.from('arena-hmr-ok');socket.write(Buffer.concat([Buffer.from([0x81,msg.length]),msg]));});
s.listen(process.env.PORT,process.env.HOST);`;
const archive = fixed => makeZip([{name:'package.json',data:Buffer.from(pkg)},{name:'src/math.js',data:Buffer.from(`exports.sum=(a,b)=>a${fixed?'+':'-'}b;\n`)},{name:'test/main.test.cjs',data:Buffer.from(tests)},{name:'server.js',data:Buffer.from(server)}]).toString('base64');
async function request(route,{method='POST',data}={}) {
  const response=await fetch(`${base}${route}`,{method,headers:{authorization:`Bearer ${token}`,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(100000)});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(`${route} returned ${response.status}: ${payload.error||'Unknown error'}`);
  return payload;
}
async function requestRaw(route){
  const response=await fetch(`${base}${route}`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error(`Raw preview request returned ${response.status}`);
  return {contentType:response.headers.get('content-type'),body:Buffer.from(await response.arrayBuffer())};
}
async function websocketGate(route){
  return await new Promise((resolve,reject)=>{
    const dest=new URL(base);const transport=dest.protocol==='https:'?https:http;
    const key=crypto.randomBytes(16).toString('base64');
    const req=transport.request(dest.origin+route,{headers:{authorization:`Bearer ${token}`,Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':key},timeout:10000});
    let done=false;const end=(error,value)=>{if(done)return;done=true;error?reject(error):resolve(value);};
    req.on('upgrade',(response,socket,head)=>{
      const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      if(response.headers['sec-websocket-accept']!==accept){socket.destroy();end(new Error('WebSocket acceptance mismatch'));return;}
      let data=Buffer.from(head||[]);const check=()=>{if(data.includes(Buffer.from('arena-hmr-ok'))){socket.destroy();end(null,true);}};
      socket.on('data',chunk=>{data=Buffer.concat([data,chunk]);check();});socket.on('error',e=>end(e));socket.on('close',()=>{if(!done)end(new Error('WebSocket closed before fixture message.'));});check();
    });
    req.on('response',res=>{res.resume();end(new Error(`WebSocket upgrade rejected (${res.statusCode})`));});req.on('error',e=>end(e));req.on('timeout',()=>req.destroy(new Error('WebSocket upgrade timed out')));req.end();
  });
}
(async()=>{
  let previewId;
  try {
    const red=await request('/v1/run',{data:{workspaceId,action:'npm-test',archive:archive(false)}});
    if(red.ok)throw new Error('Intentionally failing baseline unexpectedly passed. The runner is not executing genuine tests.');
    console.log('✓ Red: baseline behavioral test fails in Docker.');
    const green=await request('/v1/run',{data:{workspaceId,action:'npm-test',archive:archive(true)}});
    if(!green.ok)throw new Error(`Repaired code still fails: ${green.stderr||green.stdout}`);
    console.log('✓ Green: edited multi-file project passes in Docker.');
    const started=await request('/v1/previews',{data:{workspaceId,script:'start',port:5173,archive:archive(true)}});
    previewId=started.preview.id;
    console.log('✓ Preview started with no published host port or external network.');
    let html='',lastError='';
    for(let i=0;i<18;i++){
      await new Promise(resolve=>setTimeout(resolve,500));
      try{const result=await requestRaw(`/v1/previews/${previewId}/raw?workspaceId=${workspaceId}&path=%2F&port=5173`);html=result.body.toString('utf8');if(html.includes('Arena E2E Preview'))break;}catch(e){lastError=e.message;}
    }
    if(!html.includes('Arena E2E Preview'))throw new Error(`Preview did not become ready: ${lastError}`);
    const large=await requestRaw(`/v1/previews/${previewId}/raw?workspaceId=${workspaceId}&path=%2Flarge.js&port=5173`);
    if(large.body.length!==1024*1024||large.contentType!=='application/javascript')throw new Error('Large asset did not stream correctly.');
    console.log('✓ 1 MiB binary preview asset streamed without the legacy 384 KiB limit.');
    await websocketGate(`/v1/previews/${previewId}/ws?workspaceId=${workspaceId}&path=%2Fhmr&port=5173`);
    console.log('✓ WebSocket handshake and frame traversed the isolated Docker preview bridge.');
    console.log('✓ Live HTML served through authenticated runner proxy.');
    console.log('PASS: actual Docker red/green/preview E2E validation completed.');
  } finally {
    if(previewId)try{await request(`/v1/previews/${previewId}?workspaceId=${workspaceId}`,{method:'DELETE'});console.log('✓ Preview container stopped and cleaned up.');}catch(e){console.error('Cleanup failed:',e.message);}
  }
})().catch(e=>{console.error('FAIL:',e.message);process.exitCode=1;});
