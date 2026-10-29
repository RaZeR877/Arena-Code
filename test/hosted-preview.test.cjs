'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const net=require('node:net');
const crypto=require('node:crypto');
const Module=require('node:module');
const {parseZip}=require('../zip-utils.cjs');
const workId=crypto.randomUUID(),userId=crypto.randomUUID(),previewId='f'.repeat(40);
function listen(server){return new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));}
function close(server){return new Promise(resolve=>server.close(resolve));}
function writeJson(res,code,obj){res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(obj));}
test('hosted app routes an authenticated project through a private preview runner and back',async t=>{
  let role='editor',calls=[];
  class FakePool {
    async query(sql){
      if(sql.includes('arena_sessions s JOIN arena_users'))return {rows:[{id:userId,email:'dev@example.test',name:'Dev'}]};
      if(sql.includes('arena_workspaces w JOIN arena_workspace_members'))return {rows:[{id:workId,name:'E2E',owner_id:userId,revision:1,role,files:{'package.json':{encoding:'utf8',content:'{"scripts":{"start":"node server.js"}}'},'server.js':{encoding:'utf8',content:'console.log("test")'}}}]};
      if(sql.includes('INSERT INTO arena_usage_daily'))return {rowCount:1};
      throw new Error(`Unexpected fake DB query: ${sql.slice(0,80)}`);
    }
    async end(){}
  }
  const oldLoad=Module._load;Module._load=function(name,...args){if(name==='pg')return {Pool:FakePool};return oldLoad.call(this,name,...args);};
  const oldUrl=process.env.ARENA_RUNNER_URL,oldToken=process.env.ARENA_RUNNER_TOKEN;
  const runner=http.createServer(async(req,res)=>{
    calls.push({method:req.method,path:req.url,auth:req.headers.authorization});
    if(req.headers.authorization!=='Bearer test-token'){writeJson(res,401,{error:'unauthorized'});return;}
    const parsed=new URL(req.url,'http://localhost');
    if(req.method==='POST'&&parsed.pathname==='/v1/previews'){
      let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);
      assert.equal(body.workspaceId,workId);assert.equal(body.script,'start');
      assert.ok(parseZip(Buffer.from(body.archive,'base64')).some(x=>x.name==='server.js'));
      writeJson(res,201,{ok:true,preview:{id:previewId,script:'start',expiresAt:new Date(Date.now()+900000).toISOString()}});return;
    }
    if(req.method==='GET'&&parsed.pathname===`/v1/previews/${previewId}`){writeJson(res,200,{ok:true,preview:{status:'running',output:'server ready',expiresAt:new Date(Date.now()+900000).toISOString()}});return;}
    if(req.method==='GET'&&parsed.pathname===`/v1/previews/${previewId}/raw`){
      const target=parsed.searchParams.get('path');
      if(target==='/bundle.js'){
        res.writeHead(200,{'content-type':'application/javascript'});
        const chunk=Buffer.alloc(256*1024,120);
        for(let i=0;i<5;i++)res.write(chunk);
        res.end();return;
      }
      assert.equal(target,'/index.html');res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<h1>Isolated preview</h1>');return;
    }
    if(req.method==='DELETE'&&parsed.pathname===`/v1/previews/${previewId}`){writeJson(res,200,{ok:true,stopped:true});return;}
    writeJson(res,404,{error:'runner path not found'});
  });
  runner.on('upgrade',(req,socket)=>{
    const parsed=new URL(req.url,'http://localhost');
    calls.push({method:'UPGRADE',path:req.url,auth:req.headers.authorization});
    if(req.headers.authorization!=='Bearer test-token'||parsed.pathname!==`/v1/previews/${previewId}/ws`){socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;}
    assert.equal(parsed.searchParams.get('path'),'/hmr');
    assert.equal(parsed.searchParams.get('port'),'5173');
    const key=req.headers['sec-websocket-key'];
    const accept=crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.write(Buffer.concat([Buffer.from([0x81,13]),Buffer.from('mock-hmr-live')]));
  });
  const runnerUrl=await listen(runner);
  process.env.ARENA_RUNNER_URL=runnerUrl;process.env.ARENA_RUNNER_TOKEN='test-token';
  let app;
  try{app=require('../hosted/hosted.cjs').createHostedApp({databaseUrl:'postgres://test/test'});}finally{Module._load=oldLoad;}
  const server=http.createServer((req,res)=>app.handle(req,res,new URL(req.url,'http://localhost')));
  server.on('upgrade',(req,socket,head)=>app.handlePreviewUpgrade(req,socket,head,new URL(req.url,'http://localhost')));

  const sockets=new Set();for(const srv of [server,runner])srv.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  const base=await listen(server);
  t.after(async()=>{for(const socket of sockets)socket.destroy();await close(server);await close(runner);await app.close();if(oldUrl===undefined)delete process.env.ARENA_RUNNER_URL;else process.env.ARENA_RUNNER_URL=oldUrl;if(oldToken===undefined)delete process.env.ARENA_RUNNER_TOKEN;else process.env.ARENA_RUNNER_TOKEN=oldToken;Module._load=oldLoad;});
  const req=(p,opts={})=>fetch(base+p,{...opts,headers:{cookie:'arena_session='+'a'.repeat(64),...opts.headers}});
  const unauth=await fetch(`${base}/api/projects/${workId}/preview/index.html`);assert.equal(unauth.status,401);
  role='viewer';
  const forbidden=await req(`/api/projects/${workId}/process`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'start',script:'start'})});
  assert.equal(forbidden.status,403);
  role='editor';
  const started=await req(`/api/projects/${workId}/process`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'start',script:'start'})});
  assert.equal(started.status,201,await started.clone().text());const startedJson=await started.json();assert.equal(startedJson.process.id,previewId);
  const active=await req(`/api/projects/${workId}/process`);assert.equal(active.status,200);assert.match((await active.json()).processes[0].output,/server ready/);
  const html=await req(`/api/projects/${workId}/preview/index.html`);assert.equal(html.status,200);assert.match(await html.text(),/Isolated preview/);assert.match(html.headers.get('content-security-policy'),/sandbox allow-scripts/);
  const bundle=await req(`/api/projects/${workId}/preview/bundle.js`);
  assert.equal(bundle.status,200);
  assert.equal(bundle.headers.get('content-type'),'application/javascript');
  assert.equal((await bundle.arrayBuffer()).byteLength,5*256*1024,'asset must stream across app and runner rather than hit the former 384 KiB limit');
  const refusedPort=await req(`/api/projects/${workId}/preview/index.html?__arena_port=22`);assert.equal(refusedPort.status,400);
  async function webSocketHandshake({cookie=true,origin}={}) {
    return await new Promise((resolve,reject)=>{
      const url=new URL(base),socket=net.createConnection(Number(url.port),'127.0.0.1');
      let buffer=Buffer.alloc(0);const timer=setTimeout(()=>{socket.destroy();reject(new Error('Preview WS handshake timed out'));},5000);
      socket.once('connect',()=>{
        const key=crypto.randomBytes(16).toString('base64');
        socket.write(`GET /api/projects/${workId}/preview/hmr?__arena_port=5173 HTTP/1.1\r\nHost: 127.0.0.1:${url.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n${cookie?`Cookie: arena_session=${'a'.repeat(64)}\r\n`:''}${origin?`Origin: ${origin}\r\n`:''}\r\n`);
      });
      socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);const text=buffer.toString('latin1');if(!text.includes('\r\n\r\n'))return;
        const status=text.slice(0,text.indexOf('\r\n'));
        if(status.includes('101')&&!text.includes('mock-hmr-live'))return;
        clearTimeout(timer);socket.destroy();resolve({status,text});
      });
      socket.once('error',error=>{clearTimeout(timer);reject(error);});
    });
  }
  const anonWs=await webSocketHandshake({cookie:false});assert.match(anonWs.status,/401/);
  const badOriginWs=await webSocketHandshake({origin:'https://attacker.example'});assert.match(badOriginWs.status,/403/);
  const validWs=await webSocketHandshake({origin:base});
  assert.match(validWs.status,/101/);assert.match(validWs.text,/mock-hmr-live/);
  const stopped=await req(`/api/projects/${workId}/process`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'stop',processId:previewId})});assert.equal(stopped.status,200);
  const after=await req(`/api/projects/${workId}/preview/index.html`);assert.equal(after.status,404);
  assert.ok(calls.every(c=>c.auth==='Bearer test-token'));
});
