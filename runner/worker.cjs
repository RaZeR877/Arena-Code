'use strict';
/* Private service for disposable Docker-backed npm workflows. Never publish this port to the Internet. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { parseZip } = require('../zip-utils.cjs');
const { createPreviewManager } = require('./preview.cjs');
const { streamHttp, bridgeWebSocket } = require('./preview-stream.cjs');

const PORT = Number.parseInt(process.env.PORT || '4311', 10);
const TOKEN = process.env.ARENA_RUNNER_TOKEN || '';
const DATA = path.resolve(process.env.ARENA_RUNNER_DATA || path.join(os.tmpdir(), 'arena-runner-data'));
const DOCKER = process.env.ARENA_DOCKER_BIN || 'docker';
const IMAGE = process.env.ARENA_DOCKER_IMAGE || 'node:22-alpine';
const PYTHON_IMAGE = process.env.ARENA_PYTHON_IMAGE || 'python:3.12-slim';
const MAX_BODY = 12 * 1024 * 1024;
const MAX_ARCHIVE = 8 * 1024 * 1024;
const MAX_FILES = 500;
const MAX_FILE = 5 * 1024 * 1024;
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_OUTPUT = 20_000;
const LSP_COMMANDS = Object.freeze({ python: ['pylsp','--stdio'], typescript: ['typescript-language-server','--stdio'] });
const LSP_ALLOWED_METHODS = new Set(['initialize','initialized','shutdown','exit','textDocument/didOpen','textDocument/didChange','textDocument/didClose','textDocument/completion','textDocument/hover','textDocument/definition','textDocument/references','textDocument/formatting','textDocument/rangeFormatting','textDocument/rename','textDocument/signatureHelp','textDocument/documentSymbol','textDocument/foldingRange','workspace/didChangeConfiguration','workspace/didChangeWatchedFiles','workspace/configuration']);
function loadLspImages() {
  let parsed = {}; try { parsed = JSON.parse(process.env.ARENA_LSP_IMAGES || '{}'); } catch { console.error('ARENA_LSP_IMAGES is invalid JSON; hosted LSP disabled.'); }
  const out = {};
  for (const [language, image] of Object.entries(parsed || {})) if (Object.hasOwn(LSP_COMMANDS, language) && typeof image === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,199}$/.test(image)) out[language] = image;
  return Object.freeze(out);
}
const LSP_IMAGES = loadLspImages();
const inFlight = new Set();
const lspSessions = new Map();
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });

function safeRelative(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 500 || raw.includes('\0')) throw new Error('Invalid archive path.');
  const p = raw.replace(/\\/g, '/');
  if (p.startsWith('/') || /^[a-z]:/i.test(p) || p.split('/').some(x => !x || x === '.' || x === '..' || x.length > 180)) throw new Error('Archive contains an unsafe path.');
  if (p.split('/').some(x => ['.git','node_modules','.next','dist','build','.cache','.arena-pydeps','.env','.npmrc','.pypirc','.git-credentials','id_rsa','id_ed25519','id_ecdsa'].includes(x) || x.startsWith('.env.') || /\.(?:pem|key)$/i.test(x))) throw new Error('Archive contains a reserved or secret-looking path.');
  return p;
}
function readJson(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0, settled = false; const parts = [];
    req.on('data', chunk => { if (settled) return; size += chunk.length; if (size > limit) { settled = true; reject(Object.assign(new Error('Request body too large.'), { status: 413 })); req.resume(); return; } parts.push(chunk); });
    req.on('end', () => { if (settled) return; settled = true; try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('Request must be valid JSON.'), { status: 400 })); } });
    req.on('error', e => { if (!settled) { settled = true; reject(e); } });
  });
}
function send(res, status, value) { const body = JSON.stringify(value); res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' }); res.end(body); }
function trim(s) { return String(s || '').slice(-MAX_OUTPUT); }
function fingerprint(entries) { const h = crypto.createHash('sha256'); for (const entry of entries.filter(e => ['package.json','package-lock.json','npm-shrinkwrap.json','requirements.txt','pyproject.toml'].includes(e.name)).sort((a,b)=>a.name.localeCompare(b.name))) { h.update(entry.name); h.update(entry.data); } return h.digest('hex').slice(0, 32); }
function unpack(archive, dir) {
  if (typeof archive !== 'string' || archive.length > Math.ceil(MAX_ARCHIVE * 4 / 3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(archive)) throw Object.assign(new Error('A base64 ZIP archive up to 8 MiB is required.'), { status: 400 });
  const bytes = Buffer.from(archive, 'base64'); if (!bytes.length || bytes.length > MAX_ARCHIVE) throw Object.assign(new Error('ZIP archive is too large.'), { status: 413 });
  let entries; try { entries = parseZip(bytes, { maxFiles: MAX_FILES, maxFileBytes: MAX_FILE, maxTotalBytes: MAX_BYTES }); } catch (e) { throw Object.assign(new Error(`Archive rejected: ${e.message}`), { status: 400 }); }
  const seen = new Set(), files = []; let total = 0;
  for (const entry of entries) { const name = safeRelative(entry.name); if (seen.has(name)) throw new Error('Archive contains duplicate paths.'); seen.add(name); total += entry.data.length; files.push({ name, data: entry.data }); }
  for (const name of seen) { const parts = name.split('/'); for (let i=1;i<parts.length;i++) if(seen.has(parts.slice(0,i).join('/'))) throw new Error('Archive has a file/directory path conflict.'); }
  for (const f of files) { const dest = path.resolve(dir, ...f.name.split('/')); if (!dest.startsWith(dir + path.sep)) throw new Error('Archive path escaped sandbox.'); fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o777 }); fs.writeFileSync(dest, f.data, { mode: 0o666, flag: 'wx' }); }
  chmodTree(dir);
  return files;
}
function chmodTree(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes:true })) { const p=path.join(dir,entry.name); try { fs.chmodSync(p, entry.isDirectory()?0o777:0o666); } catch {} if(entry.isDirectory()) chmodTree(p); } try { fs.chmodSync(dir,0o777); } catch {} }
function runDocker(args, { timeoutMs=90_000, cwd=DATA, maxOutput=MAX_OUTPUT }={}) {
  return new Promise(resolve => {
    let stdout='',stderr='',timedOut=false,done=false; let child;
    try { child=spawn(DOCKER,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']}); } catch(e) { resolve({code:127,stdout,stderr:e.message,timedOut}); return; }
    const timer=setTimeout(()=>{timedOut=true;try{child.kill('SIGTERM');}catch{};const kill=setTimeout(()=>{try{child.kill('SIGKILL');}catch{}},1000);kill.unref();},timeoutMs);timer.unref();
    child.stdout.on('data',c=>{stdout=(stdout+c.toString('utf8')).slice(-maxOutput);});child.stderr.on('data',c=>{stderr=trim(stderr+c.toString('utf8'));});
    child.on('error',e=>{if(done)return;done=true;clearTimeout(timer);resolve({code:127,stdout,stderr:stderr||e.message,timedOut});});
    child.on('close',code=>{if(done)return;done=true;clearTimeout(timer);resolve({code:code??1,stdout,stderr,timedOut});});
  });
}
const previewCapacity=Number(process.env.ARENA_PREVIEW_MAX_SESSIONS||4);
const previewTtl=Number(process.env.ARENA_PREVIEW_TTL_MS||900000);
const previewManager = createPreviewManager({runDocker,unpack,fingerprint,data:DATA,image:IMAGE,maxSessions:Number.isFinite(previewCapacity)?Math.max(1,Math.min(12,Math.floor(previewCapacity))):4,ttlMs:Number.isFinite(previewTtl)?Math.max(60000,Math.min(3600000,previewTtl)):900000});
function containerArgs({ workspace, action, cacheDir, targetPath }) {
  const python = action.startsWith('python-');
  const install = action === 'npm-install' || action === 'python-install';
  const image = python ? PYTHON_IMAGE : IMAGE;
  const args=['run','--rm','--init','--user','1000:1000','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=128','--memory=768m','--cpus=1','--read-only',`--network=${install?'bridge':'none'}`,'--tmpfs','/tmp:rw,nosuid,size=128m','--workdir','/workspace','--mount',`type=bind,src=${workspace},dst=/workspace,readonly`,'--env','HOME=/tmp','--env','npm_config_cache=/tmp/npm-cache'];
  const depPath = python ? 'python-deps' : 'node_modules';
  if (cacheDir && fs.existsSync(path.join(cacheDir, depPath))) {
    args.push('--mount',`type=bind,src=${path.join(cacheDir,depPath)},dst=/workspace/${python?'.arena-pydeps':'node_modules'},readonly`);
    if (python) args.push('--env','PYTHONPATH=/workspace/.arena-pydeps');
  }
  args.push(image);
  if (action === 'npm-install') args.push('sh','-lc',(fs.existsSync(path.join(workspace,'package-lock.json'))||fs.existsSync(path.join(workspace,'npm-shrinkwrap.json')) ? 'npm ci --ignore-scripts --no-audit --no-fund' : 'npm install --ignore-scripts --no-audit --no-fund'));
  else if (action === 'npm-build') args.push('sh','-lc','npm run build');
  else if (action === 'npm-test') args.push('sh','-lc','npm test');
  else if (action === 'node-check') args.push('node','--check',`/workspace/${targetPath}`);
  else if (action === 'python-check') args.push('python','-c','import ast,pathlib,sys; p=pathlib.Path(sys.argv[1]); ast.parse(p.read_text(encoding="utf-8"),filename=str(p)); print("Valid Python syntax.")',`/workspace/${targetPath}`);
  else if (action === 'python-test') args.push('python','-m','unittest','discover','-v');
  else if (action === 'python-install') args.push('python','-m','pip','install','--only-binary=:all:','--no-compile','--disable-pip-version-check','--no-cache-dir','-r','requirements.txt','--target','/workspace/python-deps');
  return args;
}
function copyChecked(source,destination) {
  let files=0,bytes=0; const root=fs.realpathSync(source);
  function visit(src,dst,depth=0) {
    if(depth>8)throw new Error('Dependency cache symlink depth exceeded.');const st=fs.lstatSync(src);
    if(st.isSymbolicLink()){const real=fs.realpathSync(src);if(!real.startsWith(root+path.sep)||!fs.statSync(real).isFile())throw new Error('Dependency cache contains an unsafe symlink.');return visit(real,dst,depth+1);}
    if(st.isDirectory()){fs.mkdirSync(dst,{recursive:true,mode:0o755});for(const name of fs.readdirSync(src))visit(path.join(src,name),path.join(dst,name),depth);try{fs.chmodSync(dst,0o755);}catch{}return;}
    if(!st.isFile())return;files++;bytes+=st.size;if(files>150_000||bytes>800*1024*1024)throw new Error('Dependency cache exceeds resource limits.');fs.mkdirSync(path.dirname(dst),{recursive:true,mode:0o755});fs.copyFileSync(src,dst);try{fs.chmodSync(dst,0o644);}catch{}
  }
  visit(source,destination);return {files,bytes};
}
async function execute(body) {
  const action=body.action; if(!['npm-install','npm-build','npm-test','node-check','python-install','python-test','python-check'].includes(action)) throw Object.assign(new Error('Supported actions: JavaScript syntax check; npm install/build/test; and Python dependency install, syntax check, or unittest.'),{status:400});
  if(typeof body.workspaceId!=='string'||!/^[a-f0-9-]{36}$/i.test(body.workspaceId))throw Object.assign(new Error('Invalid workspace ID.'),{status:400});
  if(inFlight.has(body.workspaceId))throw Object.assign(new Error('Another runner action is already active for this workspace.'),{status:409});
  inFlight.add(body.workspaceId); const root=fs.mkdtempSync(path.join(DATA,'job-')); const workspace=path.join(root,'workspace');const cacheBase=path.join(DATA,'dependencies',body.workspaceId);let entries=[],cacheKey='',cacheDir='';
  try {
    fs.mkdirSync(workspace,{recursive:true,mode:0o777});entries=unpack(body.archive,workspace);cacheKey=fingerprint(entries);cacheDir=path.join(cacheBase,cacheKey);
    const python=action.startsWith('python-');const install=action==='npm-install'||action==='python-install';
    if (action.startsWith('npm-') && !entries.some(e=>e.name==='package.json')) throw Object.assign(new Error('This action requires a package.json file at the project root.'),{status:400});
    if (action==='python-check') { const target=safeRelative(body.path||'');if(!/\.py$/i.test(target)||!entries.some(e=>e.name===target))throw Object.assign(new Error('python-check requires an existing .py file path in the project archive.'),{status:400}); }
    if (action==='node-check') { const target=safeRelative(body.path||'');if(!/\.(?:js|cjs|mjs)$/i.test(target)||!entries.some(e=>e.name===target))throw Object.assign(new Error('node-check requires an existing JavaScript file path in the project archive.'),{status:400}); }
    if (action==='python-install' && !entries.some(e=>e.name==='requirements.txt')) throw Object.assign(new Error('python-install requires a requirements.txt file at the project root.'),{status:400});
    if (action==='python-test' && !entries.some(e=>/^(?:test_.*\.py|.*_test\.py|tests\/)/.test(e.name))) throw Object.assign(new Error('No Python unittest files were found in the project archive.'),{status:400});
    let useCache=false;
    if(install) { fs.mkdirSync(cacheBase,{recursive:true,mode:0o755}); }
    else { const dep=python?'python-deps':'node_modules';useCache=fs.existsSync(path.join(cacheDir,dep))&&fs.statSync(path.join(cacheDir,dep)).isDirectory(); }
    const result=await runDocker(containerArgs({workspace,action,cacheDir:useCache?cacheDir:null,targetPath:['python-check','node-check'].includes(action)?safeRelative(body.path):''}),{timeoutMs:install?240_000:90_000,cwd:root});
    if(install&&result.code===0&&!result.timedOut) {
      const depName=python?'python-deps':'node_modules';const deps=path.join(workspace,depName);
      if(fs.existsSync(deps)&&fs.lstatSync(deps).isDirectory()&&!fs.lstatSync(deps).isSymbolicLink()) {
        const cacheTemp=path.join(cacheBase,`${cacheKey}.tmp-${crypto.randomBytes(4).toString('hex')}`);fs.rmSync(cacheTemp,{recursive:true,force:true});fs.mkdirSync(cacheTemp,{recursive:true,mode:0o755});
        try { const stats=copyChecked(deps,path.join(cacheTemp,depName));fs.chmodSync(cacheTemp,0o755);fs.rmSync(cacheDir,{recursive:true,force:true});fs.renameSync(cacheTemp,cacheDir);return {ok:true,backend:'docker',action,code:result.code,stdout:result.stdout,stderr:result.stderr,timedOut:result.timedOut,cacheKey,dependenciesCached:true,dependencyFiles:stats.files,dependencyBytes:stats.bytes}; }
        finally { fs.rmSync(cacheTemp,{recursive:true,force:true}); }
      }
    }
    return {ok:result.code===0,backend:'docker',action,code:result.code,stdout:result.stdout,stderr:result.stderr,timedOut:result.timedOut,cacheKey,dependenciesCached:useCache};
  } finally { fs.rmSync(root,{recursive:true,force:true}); inFlight.delete(body.workspaceId); }
}
function websocketFrame(data, opcode=1) {
  const payload=Buffer.isBuffer(data)?data:Buffer.from(String(data));let header;
  if(payload.length<126){header=Buffer.alloc(2);header[1]=payload.length;}
  else if(payload.length<=65535){header=Buffer.alloc(4);header[1]=126;header.writeUInt16BE(payload.length,2);}
  else{header=Buffer.alloc(10);header[1]=127;header.writeBigUInt64BE(BigInt(payload.length),2);}
  header[0]=0x80|opcode;return Buffer.concat([header,payload]);
}
function closeWebSocket(socket,code=1000,reason='') {
  if(!socket||socket.destroyed)return;const msg=Buffer.from(reason).subarray(0,100);const payload=Buffer.alloc(2+msg.length);payload.writeUInt16BE(code,0);msg.copy(payload,2);try{socket.write(websocketFrame(payload,8));}catch{}socket.end();
}
function parseWebSocketFrames(buffer,callback) {
  let offset=0;
  while(buffer.length-offset>=2){const start=offset;const b1=buffer[offset++],b2=buffer[offset++];const fin=Boolean(b1&0x80),opcode=b1&0x0f,masked=Boolean(b2&0x80),reserved=Boolean(b1&0x70);let length=b2&0x7f;
    if(!fin||reserved||!masked||![1,8,9,10].includes(opcode))return {remaining:Buffer.alloc(0),error:'Unsupported WebSocket frame.'};
    if(length===126){if(buffer.length-offset<2)return {remaining:buffer.subarray(start),error:null};length=buffer.readUInt16BE(offset);offset+=2;}
    else if(length===127){if(buffer.length-offset<8)return {remaining:buffer.subarray(start),error:null};const n=buffer.readBigUInt64BE(offset);offset+=8;if(n>2_000_000n)return {remaining:Buffer.alloc(0),error:'WebSocket frame too large.'};length=Number(n);}
    if(length>2_000_000)return {remaining:Buffer.alloc(0),error:'WebSocket frame too large.'};if([8,9,10].includes(opcode)&&length>125)return {remaining:Buffer.alloc(0),error:'WebSocket control frame too large.'};if(opcode===8&&length===1)return {remaining:Buffer.alloc(0),error:'Invalid WebSocket close frame.'};if(buffer.length-offset<4+length)return {remaining:buffer.subarray(start),error:null};
    const mask=buffer.subarray(offset,offset+4);offset+=4;const payload=Buffer.from(buffer.subarray(offset,offset+length));offset+=length;for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];callback(opcode,payload);
  }
  return {remaining:buffer.subarray(offset),error:null};
}
function writeLsp(session,message) {
  if(!session.child?.stdin?.writable)throw new Error('Language-server process is not writable.');
  const body=Buffer.from(JSON.stringify(message));if(body.length>2_000_000)throw new Error('Language-server message is too large.');
  session.child.stdin.write(Buffer.from(`Content-Length: ${body.length}\r\n\r\n`));session.child.stdin.write(body);
}
function touchLspSession(session) {
  clearTimeout(session.idleTimer);session.idleTimer=setTimeout(()=>disposeLspSession(session,'Language-server session expired after inactivity.',true),15*60*1000);session.idleTimer.unref();
}
function disposeLspSession(session,reason='Language-server session ended.',closeSocket=true) {
  if(!session||session.disposed)return;session.disposed=true;clearTimeout(session.idleTimer);lspSessions.delete(session.id);
  if(closeSocket&&session.socket&&!session.socket.destroyed){try{sessionSend(session,{jsonrpc:'2.0',method:'arena/lspLog',params:{message:reason}});}catch{}closeWebSocket(session.socket,1000,reason);}
  try{if(session.child&&session.child.exitCode===null){session.child.kill('SIGTERM');const kill=setTimeout(()=>{try{if(session.child.exitCode===null)session.child.kill('SIGKILL');}catch{}},1000);kill.unref();}}catch{}
  try{fs.rmSync(session.root,{recursive:true,force:true});}catch{}
}
function sessionSend(session,message) { if(session.socket&&!session.socket.destroyed)session.socket.write(websocketFrame(JSON.stringify(message))); }
function processLspOutput(session,chunk) {
  session.stdoutBuffer=Buffer.concat([session.stdoutBuffer,chunk]);if(session.stdoutBuffer.length>2_200_000){disposeLspSession(session,'Language server output exceeded the size limit.');return;}
  while(!session.disposed){const divider=session.stdoutBuffer.indexOf('\r\n\r\n');if(divider<0)break;const header=session.stdoutBuffer.subarray(0,divider).toString('ascii');const match=header.match(/Content-Length:\s*(\d+)/i);if(!match){disposeLspSession(session,'Invalid language-server protocol framing.');return;}const length=Number(match[1]),start=divider+4;if(!Number.isSafeInteger(length)||length<0||length>2_000_000){disposeLspSession(session,'Language-server message exceeds the size limit.');return;}if(session.stdoutBuffer.length<start+length)break;let message;try{message=JSON.parse(session.stdoutBuffer.subarray(start,start+length).toString('utf8'));}catch{disposeLspSession(session,'Language server returned invalid JSON.');return;}session.stdoutBuffer=session.stdoutBuffer.subarray(start+length);touchLspSession(session);sessionSend(session,message);}
}
async function createLspSession(body) {
  if(typeof body.workspaceId!=='string'||!/^[a-f0-9-]{36}$/i.test(body.workspaceId))throw Object.assign(new Error('Invalid workspace ID.'),{status:400});
  const language=body.language;if(!Object.hasOwn(LSP_IMAGES,language)||!Object.hasOwn(LSP_COMMANDS,language))throw Object.assign(new Error(`Hosted LSP is not configured for ${String(language||'this language')}.`),{status:503});
  const configuredLimit=Number(process.env.ARENA_LSP_MAX_SESSIONS||8);const sessionLimit=Number.isFinite(configuredLimit)&&configuredLimit>0?Math.min(20,Math.floor(configuredLimit)):8;if(lspSessions.size>=sessionLimit)throw Object.assign(new Error('Language-server capacity reached.'),{status:429});
  const id=crypto.randomBytes(24).toString('hex');const root=fs.mkdtempSync(path.join(DATA,'lsp-'));const workspace=path.join(root,'workspace');let child;
  try{
    fs.mkdirSync(workspace,{recursive:true,mode:0o700});const entries=unpack(body.archive,workspace);const imageName=LSP_IMAGES[language];
    const inspected=await runDocker(['image','inspect',imageName],{timeoutMs:10000,cwd:root});if(inspected.code!==0)throw Object.assign(new Error(`Configured LSP image ${imageName} is not available. Build/pull it before enabling ${language} support.`),{status:503});
    const args=['run','--rm','--init','-i','--user','1000:1000','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=128','--memory=768m','--cpus=1','--read-only','--network=none','--tmpfs','/tmp:rw,nosuid,size=128m','--mount',`type=bind,src=${workspace},dst=/workspace,readonly`,'--env','HOME=/tmp','--workdir','/workspace'];
    if(language==='typescript') { const cacheDir=path.join(DATA,'dependencies',body.workspaceId,fingerprint(entries));if(fs.existsSync(path.join(cacheDir,'node_modules')))args.push('--mount',`type=bind,src=${path.join(cacheDir,'node_modules')},dst=/workspace/node_modules,readonly`); }
    args.push(imageName,...LSP_COMMANDS[language]);
    child=spawn(DOCKER,args,{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
    const session={id,workspaceId:body.workspaceId,language,root,workspace,child,socket:null,stdoutBuffer:Buffer.alloc(0),websocketBuffer:Buffer.alloc(0),disposed:false,idleTimer:null};lspSessions.set(id,session);touchLspSession(session);
    child.stdout.on('data',chunk=>processLspOutput(session,chunk));
    child.stderr.on('data',chunk=>{const text=trim(chunk.toString('utf8'));if(text)sessionSend(session,{jsonrpc:'2.0',method:'arena/lspLog',params:{message:text.slice(-1000)}});});
    child.once('error',error=>{sessionSend(session,{jsonrpc:'2.0',method:'arena/lspError',params:{message:`Language server process failed: ${String(error.message).slice(0,300)}`}});disposeLspSession(session,'Language server failed to start.');});
    child.once('close',code=>{sessionSend(session,{jsonrpc:'2.0',method:'arena/lspExit',params:{code}});disposeLspSession(session,'Language server exited.',true);});
    await new Promise((resolve,reject)=>{if(child.pid){resolve();return;}child.once('spawn',resolve);child.once('error',reject);});
    return {sessionId:id,language,expiresInSeconds:900};
  }catch(error){try{if(child&&child.exitCode===null)child.kill('SIGTERM');}catch{}lspSessions.delete(id);fs.rmSync(root,{recursive:true,force:true});throw error;}
}
function handleLspUpgrade(req,socket,head,url) {
  if(req.method!=='GET'||req.headers.upgrade?.toLowerCase()!=='websocket'||req.headers['sec-websocket-version']!=='13'||!req.headers['sec-websocket-key']){socket.destroy();return;}
  if(!TOKEN||req.headers.authorization!==`Bearer ${TOKEN}`){socket.destroy();return;}
  const session=lspSessions.get(url.searchParams.get('sessionId')||'');if(!session||session.disposed||session.socket){socket.destroy();return;}
  const key=req.headers['sec-websocket-key'];const accept=crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);session.socket=socket;touchLspSession(session);
  const receive=(opcode,payload)=>{touchLspSession(session);if(opcode===8){closeWebSocket(socket);disposeLspSession(session);return;}if(opcode===9){if(!socket.destroyed)socket.write(websocketFrame(payload,10));return;}if(opcode!==1)return;let message;try{message=JSON.parse(payload.toString('utf8'));}catch{closeWebSocket(socket,1007,'Invalid JSON');disposeLspSession(session);return;}if(message.method&&(!LSP_ALLOWED_METHODS.has(message.method)||typeof message.method!=='string')){if(message.id!=null)sessionSend(session,{jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method is not permitted by Arena LSP bridge.'}});return;}if(!message.method&&message.id==null){closeWebSocket(socket,1007,'Invalid LSP message');disposeLspSession(session);return;}try{writeLsp(session,message);}catch{if(message.id!=null)sessionSend(session,{jsonrpc:'2.0',id:message.id,error:{code:-32000,message:'Language server is not writable.'}});}};
  socket.on('data',chunk=>{session.websocketBuffer=Buffer.concat([session.websocketBuffer,chunk]);if(session.websocketBuffer.length>2_100_000){closeWebSocket(socket,1009,'LSP WebSocket data too large');disposeLspSession(session);return;}const parsed=parseWebSocketFrames(session.websocketBuffer,receive);if(parsed.error){closeWebSocket(socket,1002,parsed.error);disposeLspSession(session);return;}session.websocketBuffer=parsed.remaining;});
  socket.on('error',()=>disposeLspSession(session,'WebSocket error.',false));socket.on('close',()=>disposeLspSession(session,'WebSocket closed.',false));
  if(head?.length)socket.unshift(head);
}

const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(req.method==='GET'&&url.pathname==='/health'){send(res,200,{ok:true,service:'arena-runner',backend:'docker',inFlight:inFlight.size,lspSessions:lspSessions.size,previews:previewManager.list().length,lspLanguages:Object.keys(LSP_IMAGES)});return;}
  if(!TOKEN||req.headers.authorization!==`Bearer ${TOKEN}`){send(res,401,{error:'Unauthorized.'});return;}
  const lspDelete = url.pathname.match(/^\/v1\/lsp-sessions\/([a-f0-9]{48})$/);
  if(req.method==='DELETE'&&lspDelete){const session=lspSessions.get(lspDelete[1]);if(session)disposeLspSession(session,'Language-server session cancelled.');send(res,200,{ok:true,removed:Boolean(session)});return;}
  const streamMatch=url.pathname.match(/^\/v1\/previews\/([a-f0-9]{40})\/raw$/);
  if(streamMatch&&(req.method==='GET'||req.method==='HEAD')){
    try { streamHttp({manager:previewManager,id:streamMatch[1],workspaceId:url.searchParams.get('workspaceId')||'',target:url.searchParams.get('path')||'/',port:url.searchParams.get('port'),method:req.method,req,res,docker:DOCKER}); }
    catch(e){send(res,e.status||502,{error:String(e.message).slice(0,250)});}return;
  }
  const previewMatch=url.pathname.match(/^\/v1\/previews\/([a-f0-9]{40})(?:\/content)?$/);
  if(previewMatch&&req.method==='DELETE'&&url.pathname.endsWith(previewMatch[1])){
    try{const workspaceId=url.searchParams.get('workspaceId')||'';if(!previewManager.get(previewMatch[1],workspaceId)){send(res,404,{error:'Preview not found.'});return;}send(res,200,{ok:true,stopped:await previewManager.stop(previewMatch[1])});}catch(e){send(res,e.status||502,{error:e.message});}return;
  }
  if(previewMatch&&req.method==='GET'&&url.pathname.endsWith(previewMatch[1])){
    try{const state=await previewManager.status(previewMatch[1],url.searchParams.get('workspaceId')||'');send(res,200,{ok:true,preview:state});}catch(e){send(res,e.status||502,{error:String(e.message).slice(0,300)});}return;
  }
  if(previewMatch&&req.method==='GET'&&url.pathname.endsWith('/content')){
    try{const value=await previewManager.content(previewMatch[1],url.searchParams.get('workspaceId')||'',url.searchParams.get('path')||'/');send(res,200,{ok:true,status:value.status,contentType:value.contentType,content:value.buffer.toString('base64')});}catch(e){send(res,e.status||502,{error:String(e.message).slice(0,300)});}return;
  }
  if(req.method==='POST'&&url.pathname==='/v1/previews'){
    try{const body=await readJson(req);if(inFlight.has(body.workspaceId)){send(res,409,{error:'Runner action already active for this workspace.'});return;}const session=await previewManager.start(body);send(res,201,{ok:true,preview:session});}catch(e){send(res,e.status||502,{error:String(e.message).slice(0,600)});}return;
  }
  if(req.method!=='POST'||!['/v1/run','/v1/lsp-sessions'].includes(url.pathname)){send(res,404,{error:'Not found.'});return;}
  try { const body=await readJson(req); if(url.pathname==='/v1/lsp-sessions'){const result=await createLspSession(body);send(res,201,result);return;} if(inFlight.size>=Number(process.env.ARENA_RUNNER_CONCURRENCY||2)){send(res,429,{error:'Runner is at capacity.'});return;} const result=await execute(body);send(res,200,result); }
  catch(e){send(res,e.status||500,{error:String(e.message||e).slice(0,1000)});}
});
server.on('upgrade',(req,socket,head)=>{let url;try{url=new URL(req.url,`http://${req.headers.host||'localhost'}`);}catch{socket.destroy();return;}const streamMatch=url.pathname.match(/^\/v1\/previews\/([a-f0-9]{40})\/ws$/);
  if(streamMatch){
    const reject=(status,message)=>{if(!socket.destroyed)socket.end(`HTTP/1.1 ${status} Rejected\r\nContent-Type: text/plain\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);};
    if(!TOKEN||req.headers.authorization!==`Bearer ${TOKEN}`){reject(401,'Unauthorized preview upgrade.');return;}
    if(req.method!=='GET'||req.headers.upgrade?.toLowerCase()!=='websocket'||req.headers['sec-websocket-version']!=='13'){reject(400,'Invalid WebSocket upgrade.');return;}
    try{bridgeWebSocket({manager:previewManager,id:streamMatch[1],workspaceId:url.searchParams.get('workspaceId')||'',target:url.searchParams.get('path')||'/',port:url.searchParams.get('port'),key:req.headers['sec-websocket-key'],protocol:req.headers['sec-websocket-protocol']||'',head,socket,docker:DOCKER});}
    catch(e){reject(e.status||502,String(e.message).slice(0,120));}return;
  }
  if(url.pathname!=='/v1/lsp'){socket.destroy();return;}handleLspUpgrade(req,socket,head,url);});
server.listen(PORT,'0.0.0.0',()=>{if(!TOKEN){console.error('ARENA_RUNNER_TOKEN is required.');process.exit(1);}console.log(`Arena isolated runner listening on :${PORT}; keep this service on a private network.`);});
let shuttingDown=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{
  if(shuttingDown)return;shuttingDown=true;
  for(const session of lspSessions.values())disposeLspSession(session,'Runner is shutting down.');
  const deadline=setTimeout(()=>process.exit(1),18000);deadline.unref();
  server.close();
  try{await previewManager.close();}catch(error){console.error('Could not clean up previews:',error.message);}
  clearTimeout(deadline);process.exit(0);
});
