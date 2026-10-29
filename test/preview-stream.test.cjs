'use strict';
// This test executes the actual nested Node preview bridge against a real HTTP
// and WebSocket target, using a fake Docker exec that launches Node locally.
// It proves the protocol; Docker isolation must still be verified on a VM.
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const net=require('node:net');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {streamHttp,bridgeWebSocket}=require('../runner/preview-stream.cjs');
function listen(server,port=0){return new Promise((resolve,reject)=>server.once('error',reject).listen(port,'127.0.0.1',()=>resolve(server.address().port)));}
function close(server){return new Promise(resolve=>server.close(resolve));}
const spawnAsNode=(docker,args,options)=>{
  const at=args.indexOf('node');
  assert.ok(at>0);
  assert.equal(args[at+1],'-e');
  return spawn(process.execPath,args.slice(at+1),{...options,stdio:options.stdio});
};
async function pickPreviewPort(server){
  for(const port of [5173,4173,3000,8000,8080]){
    try{return await listen(server,port);}catch(e){if(e.code!=='EADDRINUSE')throw e;server.removeAllListeners('error');}
  }
  throw new Error('Could not bind a port from the preview allowlist');
}
test('preview protocol streams 1 MiB and tunnels a real WebSocket handshake and frame',async t=>{
  const target=http.createServer((req,res)=>{
    if(req.url==='/large.js'){
      res.writeHead(200,{'Content-Type':'application/javascript'});
      const chunk=Buffer.alloc(256*1024,0x42);for(let i=0;i<4;i++)res.write(chunk);res.end();return;
    }
    res.writeHead(200,{'Content-Type':'text/html'});res.end('<h1>Running</h1>');
  });
  target.on('upgrade',(req,socket)=>{
    assert.equal(req.url,'/hmr');
    const key=req.headers['sec-websocket-key'];
    const accept=crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const bytes=Buffer.from('real-hmr-ok');socket.write(Buffer.concat([Buffer.from([0x81,bytes.length]),bytes]));
  });
  const port=await pickPreviewPort(target);
  const fakeSession={workspaceId:crypto.randomUUID(),expiresAt:Date.now()+60_000,containerName:'fake-preview'};
  const manager={get:(id,workspaceId)=>id==='a'.repeat(40)&&workspaceId===fakeSession.workspaceId?fakeSession:null};
  const proxy=http.createServer((req,res)=>{
    try{streamHttp({manager,id:'a'.repeat(40),workspaceId:fakeSession.workspaceId,target:req.url,port,method:req.method,req,res,spawnProcess:spawnAsNode});}
    catch(error){res.writeHead(error.status||502);res.end(error.message);}
  });
  proxy.on('upgrade',(req,socket,head)=>{
    bridgeWebSocket({manager,id:'a'.repeat(40),workspaceId:fakeSession.workspaceId,target:req.url,port,key:req.headers['sec-websocket-key'],protocol:'',head,socket,spawnProcess:spawnAsNode});
  });
  const activeSockets=new Set();for(const server of [target,proxy])server.on('connection',socket=>{activeSockets.add(socket);socket.once('close',()=>activeSockets.delete(socket));});
  const proxyPort=await listen(proxy);
  t.after(async()=>{for(const sock of activeSockets)sock.destroy();await close(proxy);await close(target);});
  const page=await fetch(`http://127.0.0.1:${proxyPort}/`);
  assert.equal(page.status,200);assert.equal(await page.text(),'<h1>Running</h1>');
  const response=await fetch(`http://127.0.0.1:${proxyPort}/large.js`);
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/javascript');
  const body=Buffer.from(await response.arrayBuffer());assert.equal(body.length,1024*1024);assert.equal(body[body.length-1],0x42);
  const key=crypto.randomBytes(16).toString('base64');
  const socket=net.createConnection(proxyPort,'127.0.0.1');
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
  const ws=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.destroy();reject(Error('WebSocket bridge timed out'));},5000);
    let buffer=Buffer.alloc(0);
    socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);const text=buffer.toString('latin1');if(text.includes('101 Switching Protocols')&&text.includes('real-hmr-ok')){clearTimeout(timer);socket.destroy();resolve(text);}});
    socket.write(`GET /hmr HTTP/1.1\r\nHost: 127.0.0.1:${proxyPort}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  });
  assert.match(ws,/101 Switching Protocols/);
  assert.match(ws,/real-hmr-ok/);
});
