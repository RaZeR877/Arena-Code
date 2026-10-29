'use strict';
// One-request-at-a-time bridge into a network-isolated preview container. Neither
// its HTTP nor its WebSocket service gets a published Docker port.
const { spawn } = require('node:child_process');
const { previewPath, previewPort } = require('./preview.cjs');
const MAX_ASSET = 16 * 1024 * 1024;
const MAX_WS_BYTES = 32 * 1024 * 1024;
const META_PREFIX = 'ARENA_PREVIEW_V1 ';
// The probe executes *inside* the container. stdout is a small JSON header and
// then raw body bytes. No base64, no buffering of whole assets in the runner.
const HTTP_PROBE = String.raw`
const http=require('node:http');
const target=process.argv[1],port=Number(process.argv[2]),method=process.argv[3];
let begun=false;
function meta(value){if(begun)return;begun=true;process.stdout.write('ARENA_PREVIEW_V1 '+JSON.stringify(value)+'\n');}
const request=http.request({hostname:'127.0.0.1',port,path:target,method,timeout:10000,headers:{'accept':'*/*','user-agent':'Arena-Preview/2'}},response=>{
 meta({status:response.statusCode||502,type:String(response.headers['content-type']||'application/octet-stream').slice(0,180)});
 if(method==='HEAD'){response.resume();return;}
 let total=0;response.on('data',part=>{total+=part.length;if(total>16777216){response.destroy();process.exitCode=1;return;}if(!process.stdout.write(part))response.pause();});
 process.stdout.on('drain',()=>response.resume());response.on('end',()=>{});
});
request.on('timeout',()=>request.destroy(new Error('Preview request timed out')));
request.on('error',error=>{meta({status:502,error:'Preview unavailable: '+String(error.message).slice(0,120)});process.exitCode=1;});request.end();
`;
const WS_PROBE = String.raw`
const net=require('node:net');
const [target,port,key,protocol]=process.argv.slice(1);
let connected=false;
const socket=net.connect({host:'127.0.0.1',port:Number(port)});
socket.setTimeout(30000,()=>socket.destroy());
socket.on('connect',()=>{
 connected=true;socket.setTimeout(0);
 const extra=protocol?'Sec-WebSocket-Protocol: '+protocol+'\r\n':'';
 socket.write('GET '+target+' HTTP/1.1\r\nHost: 127.0.0.1:'+port+'\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: '+key+'\r\nSec-WebSocket-Version: 13\r\n'+extra+'\r\n');
 process.stdin.pipe(socket);socket.pipe(process.stdout);
});
socket.on('error',()=>{if(!connected)process.stdout.write('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');});
socket.on('close',()=>process.exit());
process.stdin.on('error',()=>socket.destroy());
`;
const SAFE_TYPES=/^(?:text\/|application\/(?:javascript|json|wasm|xml|octet-stream)|image\/|font\/|audio\/|video\/)/i;
function safeType(value){return typeof value==='string'&&value.length<=180&&/^[\x20-\x7e]+$/.test(value)&&SAFE_TYPES.test(value)?value:'application/octet-stream';}
function resolveSession(manager,id,workspaceId,port) {
  const session=manager.get(id,workspaceId);
  if(!session)throw Object.assign(new Error('Preview session not found.'),{status:404});
  if(Date.now()>session.expiresAt)throw Object.assign(new Error('Preview expired.'),{status:410});
  return {session,port:previewPort(port)};
}
function streamHttp({manager,id,workspaceId,target,port,method,req,res,docker='docker',spawnProcess=spawn}) {
  const {session,port:allowed}=resolveSession(manager,id,workspaceId,port);
  const checked=previewPath(target);
  if(!['GET','HEAD'].includes(method))throw Object.assign(new Error('Preview method not allowed.'),{status:405});
  const args=['exec','--user','1000:1000',session.containerName,'node','-e',HTTP_PROBE,checked,String(allowed),method];
  const child=spawnProcess(docker,args,{stdio:['ignore','pipe','pipe'],windowsHide:true});
  let prefix=Buffer.alloc(0),headers=false,bytes=0,done=false;
  const timeout=setTimeout(()=>child.kill('SIGKILL'),35_000);timeout.unref();
  const cleanup=()=>{clearTimeout(timeout);if(child.exitCode===null&&!child.killed)child.kill('SIGTERM');};
  req.once('aborted',cleanup);
  res.once('close',()=>{if(!res.writableEnded)cleanup();});
  child.stdout.on('data',chunk=>{
    if(done)return;
    if(!headers){prefix=Buffer.concat([prefix,chunk]);const at=prefix.indexOf(10);
      if(at<0){if(prefix.length>2048){done=true;res.writeHead(502);res.end('Preview header too long.');cleanup();}return;}
      let info;try{const text=prefix.subarray(0,at).toString('utf8');if(!text.startsWith(META_PREFIX))throw Error();info=JSON.parse(text.slice(META_PREFIX.length));}catch{done=true;res.writeHead(502);res.end('Invalid preview response.');cleanup();return;}
      const status=Number(info.status);if(!Number.isInteger(status)||status<200||status>599){done=true;res.writeHead(502);res.end('Invalid preview status.');cleanup();return;}
      const type=safeType(info.type);
      res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});headers=true;
      if(info.error){done=true;res.end(String(info.error).slice(0,200));cleanup();return;}
      chunk=prefix.subarray(at+1);prefix=null;
    }
    bytes+=chunk.length;if(bytes>MAX_ASSET){done=true;res.destroy(new Error('Preview asset size limit exceeded.'));cleanup();return;}
    if(method!=='HEAD'&&chunk.length&&!res.write(chunk))child.stdout.pause();
  });
  res.on('drain',()=>child.stdout.resume());
  child.on('close',code=>{
    if(done)return;done=true;clearTimeout(timeout);
    if(code!==0){if(!res.headersSent){res.writeHead(502);res.end('Preview probe failed.');}else res.destroy(new Error('Preview probe exited before completion.'));return;}
    if(!res.headersSent){res.writeHead(502);res.end('Preview did not return HTTP headers.');}else res.end();
  });
  child.on('error',()=>{if(!done){done=true;if(!res.headersSent){res.writeHead(502);res.end('Preview Docker exec unavailable.');}else res.destroy();}});
  child.stderr.on('data',()=>{}); // do not expose process internals in the response
  return child;
}
function bridgeWebSocket({manager,id,workspaceId,target,port,key,protocol='',head,socket,docker='docker',spawnProcess=spawn}) {
  const {session,port:allowed}=resolveSession(manager,id,workspaceId,port);
  const checked=previewPath(target);
  if(!/^[A-Za-z0-9+/]{22}==$/.test(key))throw Object.assign(new Error('Invalid WebSocket key.'),{status:400});
  if(typeof protocol!=='string'||protocol.length>150||protocol&&!/^[A-Za-z0-9._, -]+$/.test(protocol))throw Object.assign(new Error('Invalid WebSocket protocol.'),{status:400});
  const args=['exec','-i','--user','1000:1000',session.containerName,'node','-e',WS_PROBE,checked,String(allowed),key,protocol];
  const child=spawnProcess(docker,args,{stdio:['pipe','pipe','pipe'],windowsHide:true});
  const end=()=>{try{child.kill('SIGTERM');}catch{};socket.destroy();};
  let read=0,written=0;
  child.stdout.on('data',part=>{read+=part.length;if(read>MAX_WS_BYTES)end();});
  socket.on('data',part=>{written+=part.length;if(written>MAX_WS_BYTES)end();});
  child.on('error',end);child.on('close',()=>socket.end());socket.on('close',()=>child.kill('SIGTERM'));
  const timer=setTimeout(end,15*60_000);timer.unref();socket.once('close',()=>clearTimeout(timer));
  if(head?.length)child.stdin.write(head);
  child.stdout.pipe(socket);socket.pipe(child.stdin);socket.resume();
  return child;
}
module.exports={MAX_ASSET,HTTP_PROBE,WS_PROBE,safeType,resolveSession,streamHttp,bridgeWebSocket};
