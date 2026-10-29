'use strict';
// Hosted preview control: private runner only. No host ports, outbound network, or user shell commands.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { makeZip } = require('../zip-utils.cjs');
const PREVIEW_PORT = 4173;
const MAX_RESPONSE = 384 * 1024;
const DEFAULT_TTL = 15 * 60 * 1000;
const SAFE_CONTENT_TYPES = /^(?:text\/|application\/(?:javascript|json|wasm|xml|octet-stream)|image\/|font\/|audio\/|video\/)/i;
const PROBE_SCRIPT = `const http=require('node:http');const target=process.argv[1]||'/';const max=${MAX_RESPONSE};let done=false;const end=v=>{if(!done){done=true;console.log(JSON.stringify(v));}};const req=http.get({hostname:'127.0.0.1',port:${PREVIEW_PORT},path:target,timeout:5000,headers:{'accept':'*/*','user-agent':'Arena-Preview/1.0'}},res=>{let bytes=0,parts=[];res.on('data',b=>{bytes+=b.length;if(bytes>max){req.destroy();end({error:'Preview response exceeded 384 KiB.',status:413});return;}parts.push(b);});res.on('end',()=>end({status:res.statusCode||502,contentType:String(res.headers['content-type']||'application/octet-stream').slice(0,128),content:Buffer.concat(parts).toString('base64')}));});req.on('timeout',()=>req.destroy());req.on('error',e=>end({error:'Preview server is not ready: '+e.message,status:502}));`;
function previewPath(value) {
  if(typeof value!=='string'||value.length>1800||value.includes('\0')||value.includes('\\')||value.includes('#'))throw Object.assign(new Error('Invalid preview request path.'),{status:400});
  const raw=value.startsWith('/')?value:'/'+value;
  // Reject dot segments before URL normalization; no access to other routes or arbitrary ports.
  if(raw.split('?')[0].split('/').some(p=>p==='..'||p==='.'||/%2e/i.test(p)||/%2f|%5c/i.test(p)))throw Object.assign(new Error('Preview path traversal rejected.'),{status:400});
  return raw;
}
const ALLOWED_PORTS = new Set([3000, 4173, 5173, 8000, 8080]);
function previewPort(value) {
  const port = value === undefined || value === null || value === '' ? 4173 : Number(value);
  if (!Number.isInteger(port) || !ALLOWED_PORTS.has(port)) throw Object.assign(new Error('Preview port must be one of 3000, 4173, 5173, 8000, or 8080.'), {status:400});
  return port;
}
function previewScript(pkg,script) {
  if(!['dev','start','preview'].includes(script)||!pkg||typeof pkg!=='object'||Array.isArray(pkg)||!pkg.scripts||typeof pkg.scripts[script]!=='string'||!pkg.scripts[script].trim())throw Object.assign(new Error('Choose an existing dev, start, or preview script.'),{status:400});
  return script;
}
function createPreviewManager({runDocker,unpack,fingerprint,data,image,maxSessions=4,ttlMs=DEFAULT_TTL}) {
  const previews=new Map(), byWorkspace=new Map();
  async function stop(id) {
    const session=previews.get(id);if(!session)return false;
    previews.delete(id);if(byWorkspace.get(session.workspaceId)===id)byWorkspace.delete(session.workspaceId);
    try{await runDocker(['rm','-f',session.containerName],{timeoutMs:12000});}finally{fs.rmSync(session.root,{recursive:true,force:true});}
    return true;
  }
  async function start(body) {
    const workspaceId=body.workspaceId;
    if(typeof workspaceId!=='string'||!/^[a-f0-9-]{36}$/i.test(workspaceId))throw Object.assign(new Error('Invalid workspace ID.'),{status:400});
    if(byWorkspace.has(workspaceId))await stop(byWorkspace.get(workspaceId));
    if(previews.size>=maxSessions)throw Object.assign(new Error('Preview capacity reached.'),{status:429});
    const root=fs.mkdtempSync(path.join(data,'preview-')), workspace=path.join(root,'workspace');
    let name='';
    try {
      fs.mkdirSync(workspace,{recursive:true,mode:0o777});
      const entries=unpack(body.archive,workspace);
      const pkgEntry=entries.find(e=>e.name==='package.json');if(!pkgEntry)throw Object.assign(new Error('A package.json with a startable script is required.'),{status:400});
      let pkg;try{pkg=JSON.parse(pkgEntry.data.toString('utf8'));}catch{throw Object.assign(new Error('package.json is invalid JSON.'),{status:400});}
      const script=previewScript(pkg,body.script);const port=previewPort(body.port);
      const id=crypto.randomBytes(20).toString('hex');name=`arena-prev-${id}`;
      const args=['run','--detach','--rm','--init','--name',name,'--user','1000:1000','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=96','--memory=512m','--memory-swap=512m','--cpus=1','--read-only','--network=none','--tmpfs','/tmp:rw,nosuid,nodev,size=64m','--workdir','/workspace','--mount',`type=bind,src=${workspace},dst=/workspace,readonly`,'--env',`PORT=${port}`,'--env',`ARENA_PREVIEW_BASE=/api/projects/${workspaceId}/preview/`,'--env','HOST=127.0.0.1','--env','HOME=/tmp'];
      const depDir=path.join(data,'dependencies',workspaceId,fingerprint(entries),'node_modules');
      if(fs.existsSync(depDir)&&fs.statSync(depDir).isDirectory())args.push('--mount',`type=bind,src=${depDir},dst=/workspace/node_modules,readonly`);
      args.push(image,'sh','-lc',`npm run ${script}${script==='start'?'':` -- --host 127.0.0.1 --port ${port}`}`);
      const launch=await runDocker(args,{timeoutMs:18000,cwd:root});
      if(launch.code!==0)throw Object.assign(new Error(`Cannot start isolated preview: ${launch.stderr||launch.stdout||'Docker failed.'}`.slice(0,600)),{status:503});
      const startedAt=Date.now(),expiresAt=startedAt+ttlMs;
      const session={id,workspaceId,root,containerName:name,script,port,startedAt,expiresAt};previews.set(id,session);byWorkspace.set(workspaceId,id);
      return {id,workspaceId,script,port,startedAt:new Date(startedAt).toISOString(),expiresAt:new Date(expiresAt).toISOString()};
    }catch(error){if(name)await runDocker(['rm','-f',name],{timeoutMs:10000}).catch(()=>{});fs.rmSync(root,{recursive:true,force:true});throw error;}
  }
  function get(id,workspaceId){const s=previews.get(id);return s&&s.workspaceId===workspaceId?s:null;}
  async function status(id,workspaceId) {
    const s=get(id,workspaceId);if(!s)throw Object.assign(new Error('Preview not found.'),{status:404});
    if(Date.now()>s.expiresAt){await stop(id);throw Object.assign(new Error('Preview expired.'),{status:410});}
    const inspected=await runDocker(['inspect','--format','{{.State.Running}}',s.containerName],{timeoutMs:7000,maxOutput:1000});
    if(inspected.code!==0||inspected.stdout.trim()==='false'){
      await stop(id);throw Object.assign(new Error('Preview process has exited. Check the npm script and startup logs.'),{status:410});
    }
    const logs=await runDocker(['logs','--tail','60',s.containerName],{timeoutMs:7000,maxOutput:12000});
    return {id:s.id,workspaceId:s.workspaceId,status:'running',script:s.script,port:s.port,expiresAt:new Date(s.expiresAt).toISOString(),output:((logs.stdout||'')+'\n'+(logs.stderr||'')).trim().slice(-10000)};
  }
  async function content(id,workspaceId,requestPath) {
    const s=get(id,workspaceId);if(!s)throw Object.assign(new Error('Preview session not found.'),{status:404});
    if(Date.now()>s.expiresAt){await stop(id);throw Object.assign(new Error('Preview session expired.'),{status:410});}
    const target=previewPath(requestPath);
    const response=await runDocker(['exec','--user','1000:1000',s.containerName,'node','-e',PROBE_SCRIPT,target],{timeoutMs:8000,maxOutput:Math.ceil(MAX_RESPONSE*4/3)+2048});
    if(response.code!==0)throw Object.assign(new Error('Preview is not responding. Start it again or inspect the development logs.'),{status:502});
    let parsed;try{parsed=JSON.parse(response.stdout.trim());}catch{throw Object.assign(new Error('Preview returned an invalid response.'),{status:502});}
    if(parsed.error)throw Object.assign(new Error(parsed.error),{status:parsed.status===413?413:502});
    const buffer=Buffer.from(parsed.content||'','base64');if(buffer.length>MAX_RESPONSE)throw Object.assign(new Error('Preview asset exceeds the response limit.'),{status:413});
    const contentType=typeof parsed.contentType==='string'&&SAFE_CONTENT_TYPES.test(parsed.contentType)?parsed.contentType:'application/octet-stream';
    return {status:Math.max(200,Math.min(599,Number(parsed.status)||502)),contentType,buffer};
  }
  const timer=setInterval(()=>{for(const [id,s] of previews)if(Date.now()>s.expiresAt)stop(id).catch(()=>{});},30_000);timer.unref();
  async function close(){clearInterval(timer);await Promise.all([...previews.keys()].map(stop));}
  function list(){return [...previews.values()].map(({id,workspaceId,script,port,startedAt,expiresAt})=>({id,workspaceId,script,port,startedAt,expiresAt}));}
  return {start,stop,content,status,get,list,close};
}
module.exports={createPreviewManager,previewPath,previewPort,previewScript,PROBE_SCRIPT};
