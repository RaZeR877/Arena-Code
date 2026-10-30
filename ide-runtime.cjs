'use strict';
// Local trusted-code tools only. Never enabled in hosted or remotely bound mode.
const crypto=require('node:crypto');
const WebSocket=require('ws');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const LOOPBACK=new Set(['127.0.0.1','localhost','::1','[::1]']);
function allowed(req,host){
 if(!LOOPBACK.has(host)||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return false;
 try{const target=new URL('http://'+req.headers.host);if(!LOOPBACK.has(target.hostname))return false;
  if(req.headers.origin){const origin=new URL(req.headers.origin);return LOOPBACK.has(origin.hostname)&&origin.host===target.host&&origin.protocol==='http:';}
  return req.method==='GET'&&req.headers['sec-fetch-site']!=='cross-site';
 }catch{return false;}
}
function createRuntime({host,projectDir,resolveFile,readBody,json}){
 const sessions=new Map();
 let ptyFactory;try{ptyFactory=require('node-pty');}catch{}
 function dispose(s){if(!s)return;s.exited=true;try{s.pty?.kill();}catch{}try{s.child?.kill('SIGKILL');}catch{}try{s.ws?.close();}catch{}for(const p of s.pending?.values()||[])p.reject(Error('Debugger stopped'));s.pending?.clear();sessions.delete(s.id);}
 const gc=setInterval(()=>{for(const s of sessions.values())if(Date.now()-s.touched>15*60*1000)dispose(s);},30000);gc.unref();
 function base(kind){if(sessions.size>=3)throw Error('Stop an existing session before starting another');return {id:crypto.randomUUID(),kind,touched:Date.now(),output:'',offset:0,exited:false};}
 function append(s,text){s.output+=text;if(s.output.length>262144){const excess=s.output.length-262144;s.output=s.output.slice(excess);s.offset+=excess;}}
 function env(){return {PATH:process.env.PATH||'',HOME:process.env.HOME||'',USERPROFILE:process.env.USERPROFILE||'',SYSTEMROOT:process.env.SYSTEMROOT||'',TEMP:process.env.TEMP||'/tmp',TERM:'xterm-256color',LANG:'C.UTF-8'};}
 function call(s,method,params={}){return new Promise((resolve,reject)=>{if(s.ws?.readyState!==1)return reject(Error('Debugger is disconnected'));const id=++s.sequence;const timer=setTimeout(()=>{s.pending.delete(id);reject(Error('Debugger request timed out'));},5000);s.pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});s.ws.send(JSON.stringify({id,method,params}));});}
 async function connect(s,url){
  s.pending=new Map();s.sequence=0;s.frames=[];s.paused=false;s.ws=new WebSocket(url);
  s.ws.addEventListener('message',event=>{const msg=JSON.parse(String(event.data));if(msg.id){const p=s.pending.get(msg.id);s.pending.delete(msg.id);if(msg.error)p?.reject(Error(msg.error.message));else p?.resolve(msg.result);}
   if(msg.method==='Debugger.paused'){s.paused=true;s.frames=msg.params.callFrames.slice(0,12);}
   if(msg.method==='Debugger.resumed'){s.paused=false;s.frames=[];}
  });
  await new Promise((resolve,reject)=>{s.ws.addEventListener('open',resolve,{once:true});s.ws.addEventListener('error',()=>reject(Error('Cannot connect to Node Inspector')),{once:true});});
  await call(s,'Runtime.enable');await call(s,'Debugger.enable');await call(s,'Runtime.runIfWaitingForDebugger');
 }
 async function startDebug(dir,relative){
  const file=resolveFile(dir,relative);if(!/\.[cm]?js$/i.test(file))throw Error('Choose a JavaScript file for Node debugging');
  const s=base('debug');s.file=file;s.pending=new Map();sessions.set(s.id,s);
  try{
   s.child=spawn(process.execPath,['--inspect-brk=127.0.0.1:0',file],{cwd:projectDir(dir),env:env(),stdio:['ignore','pipe','pipe']});
   const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Node Inspector did not start')),8000);
    s.child.once('error',e=>{clearTimeout(timer);reject(e);});s.child.stderr.on('data',b=>{append(s,String(b));const match=s.output.match(/ws:\/\/127\.0\.0\.1:\d+\/[\w-]+/);if(match){clearTimeout(timer);resolve(match[0]);}});
    s.child.stdout.on('data',b=>append(s,String(b)));s.child.once('exit',()=>{s.exited=true;clearTimeout(timer);reject(Error('Debug process exited before connection'));});
   });
   await connect(s,url);return s;
  }catch(e){dispose(s);throw e;}
 }
 async function handle(req,res,url){
  if(!url.pathname.startsWith('/api/ide/runtime'))return false;
  if(!allowed(req,host)){json(res,403,{error:'Runtime tools require the same-origin localhost Node app'});return true;}
  try{
   if(url.pathname==='/api/ide/runtime'&&req.method==='GET'){json(res,200,{terminal:Boolean(ptyFactory),debugger:true,scope:'trusted host code',idleMinutes:15});return true;}
   if(url.pathname==='/api/ide/runtime'&&req.method==='POST'){
    const body=await readBody(req,16384);const dir=projectDir(body.projectId);if(!fs.statSync(dir).isDirectory())throw Error('Project snapshot not found');let s;
    if(body.kind==='terminal'){
     if(!ptyFactory)throw Error('PTY support is not installed on this host. Install a C++ build toolchain and reinstall optional dependencies.');
     s=base('terminal');const shell=process.platform==='win32'?'powershell.exe':'/bin/sh';
     s.pty=ptyFactory.spawn(shell,[],{name:'xterm-256color',cols:80,rows:24,cwd:dir,env:env()});
     s.pty.onData(data=>append(s,data));s.pty.onExit(()=>{s.exited=true;});sessions.set(s.id,s);
    }else if(body.kind==='debug')s=await startDebug(body.projectId,body.path);else throw Error('Unknown runtime kind');
    json(res,201,{id:s.id,kind:s.kind});return true;
   }
   const match=url.pathname.match(/^\/api\/ide\/runtime\/([a-f0-9-]+)$/);const s=match&&sessions.get(match[1]);if(!s){json(res,404,{error:'Runtime session not found or expired'});return true;}s.touched=Date.now();
   if(req.method==='DELETE'){dispose(s);json(res,200,{stopped:true});return true;}
   if(req.method==='GET'){
    const requested=Number(url.searchParams.get('cursor'))||0;const offset=Math.max(s.offset,requested);const response={kind:s.kind,output:s.output.slice(offset-s.offset),cursor:s.offset+s.output.length,reset:requested<s.offset,exited:s.exited};
    if(s.kind==='debug'){
     response.paused=s.paused;response.frames=s.frames.map(f=>({name:f.functionName||'(anonymous)',url:f.url,line:f.location.lineNumber+1,column:f.location.columnNumber+1}));response.locals=[];
     if(s.paused&&!s.exited){const local=s.frames[0]?.scopeChain.find(scope=>scope.type==='local');if(local){try{const props=await call(s,'Runtime.getProperties',{objectId:local.object.objectId,ownProperties:true,generatePreview:false});response.locals=(props.result||[]).slice(0,40).map(p=>({name:p.name,value:String(p.value?.value??p.value?.description??'(unavailable)').slice(0,200)}));}catch{response.locals=[];}}}
    }
    json(res,200,response);return true;
   }
   if(req.method==='POST'){
    const body=await readBody(req,16384);
    if(s.kind==='terminal'){
     if(s.exited)throw Error('Terminal process has exited');
     if(typeof body.input==='string'&&body.input.length<=8192)s.pty.write(body.input);
     if(Number.isInteger(body.cols)&&Number.isInteger(body.rows))s.pty.resize(Math.max(20,Math.min(300,body.cols)),Math.max(5,Math.min(100,body.rows)));
    }else{
     const methods={resume:'Debugger.resume',pause:'Debugger.pause',stepOver:'Debugger.stepOver',stepInto:'Debugger.stepInto',stepOut:'Debugger.stepOut'};
     if(body.action==='breakpoint'){if(!Number.isInteger(body.line)||body.line<1)throw Error('Breakpoint requires a positive line number');await call(s,'Debugger.setBreakpointByUrl',{lineNumber:body.line-1,url:pathToFileURL(s.file).href});}
     else if(methods[body.action])await call(s,methods[body.action]);else throw Error('Unsupported debugger action');
    }
    json(res,200,{ok:true});return true;
   }
   json(res,405,{error:'Method not allowed'});
  }catch(e){json(res,400,{error:String(e.message).slice(0,300)});}return true;
 }
 return {handle,dispose(){clearInterval(gc);for(const s of [...sessions.values()])dispose(s);}};
}
module.exports={createRuntime,allowed};
