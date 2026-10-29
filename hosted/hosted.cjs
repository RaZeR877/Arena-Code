'use strict';
/* Self-hosted multi-user API. Local mode intentionally has no pg dependency; this module is loaded only in hosted mode. */
const crypto = require('node:crypto');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { Readable } = require('node:stream');
const { previewPort } = require('../runner/preview.cjs');
const { safeType } = require('../runner/preview-stream.cjs');
const { makeZip, parseZip } = require('../zip-utils.cjs');

const MAX_BODY = 12 * 1024 * 1024;
const MAX_FILE = 5 * 1024 * 1024;
const MAX_FILES = 500;
const MAX_PROJECT_BYTES = 25 * 1024 * 1024;
const SESSION_DAYS = 14;
const MAX_USER_WORKSPACES = Math.max(1, Math.min(1000, Number(process.env.ARENA_MAX_USER_WORKSPACES || 20) || 20));
const MAX_USER_CHAT_PER_DAY = Math.max(0, Math.min(100000, Number(process.env.ARENA_MAX_USER_CHAT_PER_DAY || 50) || 0));
const MAX_USER_RUNS_PER_DAY = Math.max(0, Math.min(100000, Number(process.env.ARENA_MAX_USER_RUNS_PER_DAY || 100) || 0));
const MAX_USER_DEPLOYS_PER_DAY = Math.max(0, Math.min(100000, Number(process.env.ARENA_MAX_USER_DEPLOYS_PER_DAY || 10) || 0));
function quotaAllowed(used,limit) { return limit === 0 || Number(used) < limit; }

const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
const AI_MODELS = [...new Set((process.env.AI_MODELS || 'openai/gpt-4.1').split(',').map(s=>s.trim()).filter(s=>/^[A-Za-z0-9][A-Za-z0-9._:/+\-]{0,119}$/.test(s)))].slice(0,12);
const CHAT_TIMEOUT_MS = 60_000;
const SECRET_NAMES = new Set(['.npmrc','.pypirc','.git-credentials','id_rsa','id_ed25519','id_ecdsa']);
const IGNORED = new Set(['node_modules','.git','.next','dist','build','.cache','.arena-project.json']);

function safeProjectPath(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 500 || raw.includes('\0')) throw Object.assign(new Error('A valid relative path is required.'),{status:400});
  const value = raw.replace(/\\/g,'/');
  if (value.startsWith('/') || /^[a-z]:/i.test(value)) throw Object.assign(new Error('Absolute paths are not allowed.'),{status:400});
  const pieces = value.split('/');
  if (pieces.some(p=>!p || p==='.' || p==='..' || p.length>180)) throw Object.assign(new Error('Path contains an invalid segment.'),{status:400});
  if (pieces.some(p=>IGNORED.has(p) || p==='.env' || p.startsWith('.env.') || SECRET_NAMES.has(p.toLowerCase()) || /\.(?:pem|key)$/i.test(p))) throw Object.assign(new Error('This path is reserved or may contain secrets.'),{status:400});
  return pieces.join('/');
}
function parseCookies(header='') { const out={}; for (const part of header.split(';')) { const at=part.indexOf('='); if(at<1)continue; try{out[part.slice(0,at).trim()]=decodeURIComponent(part.slice(at+1).trim());}catch{} } return out; }
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function passwordHash(password,salt=crypto.randomBytes(16).toString('hex')) { return new Promise((resolve,reject)=>crypto.scrypt(password,salt,64,(error,key)=>error?reject(error):resolve({salt,hash:key.toString('hex')}))); }
function safeEqual(a,b) { try { const aa=Buffer.from(a,'hex'),bb=Buffer.from(b,'hex'); return aa.length===bb.length && crypto.timingSafeEqual(aa,bb); } catch { return false; } }
function sendJson(res,status,data,headers={}) { const body=JSON.stringify(data); res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}); res.end(body); }
function fail(res,status,error,code) { sendJson(res,status,{error:String(error||'Request failed').slice(0,1000),...(code?{code}:{})}); }
function readBody(req,limit=MAX_BODY) { return new Promise((resolve,reject)=>{let size=0,done=false;const parts=[];req.on('data',b=>{if(done)return;size+=b.length;if(size>limit){done=true;reject(Object.assign(new Error('Request body is too large.'),{status:413}));req.resume();return;}parts.push(b);});req.on('end',()=>{if(done)return;done=true;try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')||'{}'));}catch{reject(Object.assign(new Error('Body must be valid JSON.'),{status:400}));}});req.on('error',e=>{if(!done){done=true;reject(e);}});}); }
function safeName(s) { return String(s||'Untitled project').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/\s+/g,' ').trim().slice(0,80)||'Untitled project'; }
function bytesFor(file) { if(file.encoding==='base64')return Buffer.from(file.content,'base64').length; return Buffer.byteLength(file.content||'','utf8'); }
function validateFileContent(body) {
  if (!body || typeof body.content !== 'string') throw Object.assign(new Error('File content is required.'),{status:400});
  let file;
  if (body.encoding === 'base64') { if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.content)) throw Object.assign(new Error('Invalid base64 file content.'),{status:400}); file={encoding:'base64',content:body.content}; }
  else file={encoding:'utf8',content:body.content};
  file.size=bytesFor(file); file.updatedAt=new Date().toISOString();
  if(file.size>MAX_FILE)throw Object.assign(new Error(`File exceeds the ${MAX_FILE} byte limit.`),{status:413});
  return file;
}
function listFiles(files) {
  const out=new Map(); let total=0;
  for(const [name,file] of Object.entries(files||{})) { const p=safeProjectPath(name); if(p!==name)continue; const size=bytesFor(file); total+=size; out.set(p,{path:p,type:'file',size,modifiedAt:file.updatedAt||null}); const parts=p.split('/'); for(let i=1;i<parts.length;i++){const dir=parts.slice(0,i).join('/');if(!out.has(dir))out.set(dir,{path:dir,type:'directory'});} }
  return {files:[...out.values()].sort((a,b)=>a.path.localeCompare(b.path)),total};
}
function decodeFile(file) { return file.encoding==='base64'?Buffer.from(file.content,'base64'):Buffer.from(file.content||'','utf8'); }
function archiveFiles(files) { const entries=[]; for(const [name,file] of Object.entries(files||{})){const p=safeProjectPath(name);entries.push({name:p,data:decodeFile(file)});} return makeZip(entries,{maxFiles:MAX_FILES,maxBytes:MAX_PROJECT_BYTES}); }
function encodeArchive(archive) {
  if(typeof archive!=='string'||archive.length>Math.ceil(8*1024*1024*4/3)||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(archive))throw Object.assign(new Error('Provide a valid base64 ZIP archive up to 8 MB.'),{status:400});
  const buf=Buffer.from(archive,'base64');if(!buf.length||buf.length>8*1024*1024)throw Object.assign(new Error('ZIP archive must be between 1 byte and 8 MB.'),{status:413});
  const entries=parseZip(buf,{maxFiles:MAX_FILES,maxFileBytes:MAX_FILE,maxTotalBytes:MAX_PROJECT_BYTES});const files={};let total=0;
  for(const entry of entries){const p=safeProjectPath(entry.name);if(Object.hasOwn(files,p))throw Object.assign(new Error(`Duplicate archive path: ${p}`),{status:400});total+=entry.data.length;if(total>MAX_PROJECT_BYTES)throw Object.assign(new Error('Expanded archive is too large.'),{status:413});const binary=/\.(?:png|jpe?g|gif|webp|avif|bmp|ico|pdf|mp4|webm|mp3|wav|ogg|woff2?|ttf|otf|wasm|bin|sqlite|db)$/i.test(p)||entry.data.includes(0);files[p]={encoding:binary?'base64':'utf8',content:binary?entry.data.toString('base64'):entry.data.toString('utf8'),size:entry.data.length,updatedAt:new Date().toISOString()};}
  for(const p of Object.keys(files)){const parts=p.split('/');for(let i=1;i<parts.length;i++)if(Object.hasOwn(files,parts.slice(0,i).join('/')))throw Object.assign(new Error('Archive has a file/directory path conflict.'),{status:400});}
  return files;
}

function createHostedApp(options={}) {
  const databaseUrl=options.databaseUrl||process.env.DATABASE_URL;
  if(!databaseUrl)throw new Error('ARENA_HOSTED_MODE=1 requires DATABASE_URL.');
  let Pool; try { ({Pool}=require('pg')); } catch { throw new Error('Hosted mode requires the pg package. Run npm install before enabling ARENA_HOSTED_MODE=1.'); }
  const pool=new Pool({connectionString:databaseUrl,max:Number(process.env.PG_POOL_SIZE||10),connectionTimeoutMillis:7000,idleTimeoutMillis:30000,ssl:process.env.DATABASE_SSL==='1'?{rejectUnauthorized:process.env.DATABASE_SSL_REJECT_UNAUTHORIZED!=='0'}:undefined});
  const allowSignup=process.env.ARENA_ALLOW_SIGNUP!=='0';
  const cookieName='arena_session';
  const secureCookie=process.env.ARENA_COOKIE_SECURE==='1'||(process.env.NODE_ENV==='production'&&process.env.ARENA_COOKIE_SECURE!=='0');
  const originExpected=process.env.PUBLIC_ORIGIN||'';
  const lspLanguages=[...new Set((process.env.ARENA_LSP_LANGUAGES||'').split(',').map(s=>s.trim()).filter(s=>['python','typescript'].includes(s)))];
  const limits=new Map();
  const activePreviews=new Map(); // Workspace-to-preview routing. The runner is the authority for session TTL.
  async function init() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS arena_users (
        id uuid PRIMARY KEY, email text NOT NULL UNIQUE, display_name varchar(80) NOT NULL,
        password_salt text NOT NULL, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS arena_sessions (
        token_hash char(64) PRIMARY KEY, user_id uuid NOT NULL REFERENCES arena_users(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS arena_sessions_expiry_idx ON arena_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS arena_workspaces (
        id uuid PRIMARY KEY, name varchar(80) NOT NULL, owner_id uuid NOT NULL REFERENCES arena_users(id) ON DELETE CASCADE,
        files jsonb NOT NULL DEFAULT '{}'::jsonb, revision integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS arena_workspace_members (
        workspace_id uuid NOT NULL REFERENCES arena_workspaces(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES arena_users(id) ON DELETE CASCADE,
        role text NOT NULL CHECK(role IN ('owner','editor','viewer')), created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(workspace_id,user_id)
      );
      CREATE TABLE IF NOT EXISTS arena_file_history (
        id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES arena_workspaces(id) ON DELETE CASCADE,
        file_path text NOT NULL, encoding text NOT NULL, content text NOT NULL, size integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS arena_file_history_idx ON arena_file_history(workspace_id,file_path,created_at DESC);
      CREATE TABLE IF NOT EXISTS arena_usage_daily (
        user_id uuid NOT NULL REFERENCES arena_users(id) ON DELETE CASCADE,
        day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
        kind text NOT NULL CHECK (kind IN ('chat','run','deploy')),
        count integer NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id,day,kind)
      );
      CREATE TABLE IF NOT EXISTS arena_deployments (
        id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES arena_workspaces(id) ON DELETE CASCADE,
        requested_by uuid NOT NULL REFERENCES arena_users(id) ON DELETE CASCADE, provider text NOT NULL,
        status text NOT NULL, target_url text, message text, created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  }
  async function userForRequest(req) {
    const token=parseCookies(req.headers.cookie||'')[cookieName]; if(!token || !/^[a-f0-9]{64}$/.test(token))return null;
    const result=await pool.query('SELECT u.id,u.email,u.display_name AS name FROM arena_sessions s JOIN arena_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()', [sha(token)]);
    return result.rows[0]||null;
  }
  async function createSession(res,userId) {
    const token=crypto.randomBytes(32).toString('hex');const expiry=new Date(Date.now()+SESSION_DAYS*86400000);
    await pool.query('INSERT INTO arena_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)',[sha(token),userId,expiry]);
    const cookie=`${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS*86400}${secureCookie?'; Secure':''}`;
    res.setHeader('Set-Cookie',cookie);
  }
  async function canAccess(workspaceId,userId,write=false) {
    const r=await pool.query('SELECT w.id,w.name,w.owner_id,w.files,w.revision,w.created_at,w.updated_at,m.role FROM arena_workspaces w JOIN arena_workspace_members m ON m.workspace_id=w.id WHERE w.id=$1 AND m.user_id=$2',[workspaceId,userId]);
    const row=r.rows[0];if(!row)return null;if(write&&!['owner','editor'].includes(row.role))return {denied:true};return row;
  }
  async function lockedWorkspace(client,workspaceId,userId,write=true) {
    const r=await client.query('SELECT w.id,w.name,w.owner_id,w.files,w.revision,w.created_at,w.updated_at,m.role FROM arena_workspaces w JOIN arena_workspace_members m ON m.workspace_id=w.id WHERE w.id=$1 AND m.user_id=$2 FOR UPDATE OF w',[workspaceId,userId]);
    const row=r.rows[0];if(!row)return null;if(write&&!['owner','editor'].includes(row.role))return {denied:true};return row;
  }
  function projectSummary(row) { return {id:row.id,name:row.name,createdAt:row.created_at,updatedAt:row.updated_at,fileCount:Object.keys(row.files||{}).length,revision:row.revision,role:row.role||'owner'}; }
  async function addHistory(client,id,p,file) {
    if(!file || typeof file.content!=='string')return;
    await client.query('INSERT INTO arena_file_history(id,workspace_id,file_path,encoding,content,size) VALUES($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),id,p,file.encoding||'utf8',file.content,bytesFor(file)]);
    await client.query('DELETE FROM arena_file_history WHERE id IN (SELECT id FROM arena_file_history WHERE workspace_id=$1 AND file_path=$2 ORDER BY created_at DESC OFFSET 10)',[id,p]);
  }
  async function consumeQuota(userId,kind,maxCount) {
    if (maxCount === 0) return true;
    const r=await pool.query(`INSERT INTO arena_usage_daily(user_id,day,kind,count)
      VALUES ($1,(now() AT TIME ZONE 'UTC')::date,$2,1)
      ON CONFLICT (user_id,day,kind) DO UPDATE SET count=arena_usage_daily.count+1
      WHERE arena_usage_daily.count < $3 RETURNING count`,[userId,kind,maxCount]);
    return r.rowCount===1;
  }
  async function checkWorkspaceQuota(client,userId) {
    const r=await client.query('SELECT count(*)::integer AS total FROM arena_workspaces WHERE owner_id=$1',[userId]);
    return quotaAllowed(r.rows[0].total,MAX_USER_WORKSPACES);
  }
  async function runnerCall(action,workspace,extra={}) {
    const runnerUrl=process.env.ARENA_RUNNER_URL;const token=process.env.ARENA_RUNNER_TOKEN;
    if(!runnerUrl||!token)throw Object.assign(new Error('Hosted execution is disabled. Configure ARENA_RUNNER_URL and ARENA_RUNNER_TOKEN for a dedicated isolated runner.'),{status:503});
    const archiveBuffer=archiveFiles(workspace.files);
    if(archiveBuffer.length>8*1024*1024)throw Object.assign(new Error('This hosted runner accepts ZIP archives up to 8 MiB compressed. Reduce the project size or exclude generated assets.'),{status:413});
    const archive=archiveBuffer.toString('base64');
    const response=await fetch(`${runnerUrl.replace(/\/$/,'')}/v1/run`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action,workspaceId:workspace.id,archive,...extra}),signal:AbortSignal.timeout(action==='npm-install'?240000:90000)});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(data.error||`Runner failed (${response.status}).`),{status:502});return data;
  }
  function resolvePreviewTarget(url, rawPath, active) {
    let target;
    try {
      const decoded=decodeURIComponent(rawPath||'index.html');
      if(decoded.length>1200||decoded.includes('\\')||decoded.includes('\0')||decoded.includes('#')||decoded.split('/').some(p=>p==='..'||p==='.'||/%2e|%2f|%5c/i.test(p)))throw Error('Invalid path');
      const params=new URLSearchParams(url.searchParams);
      const requestedPort=params.get('__arena_port');params.delete('__arena_port');
      const port=previewPort(requestedPort===null?(active.port||4173):requestedPort);
      target='/'+decoded+(params.size?'?'+params.toString():'');
      return {target,port};
    } catch { throw Object.assign(new Error('Invalid preview path or port.'),{status:400}); }
  }
  async function streamHostedPreview(req,res,id,active,target,port) {
    const runnerUrl=process.env.ARENA_RUNNER_URL, token=process.env.ARENA_RUNNER_TOKEN;
    if(!runnerUrl||!token)throw Object.assign(new Error('Isolated preview runner is not configured.'),{status:503});
    const url=new URL(`/v1/previews/${active.id}/raw`,runnerUrl);
    url.searchParams.set('workspaceId',id);url.searchParams.set('path',target);url.searchParams.set('port',String(port));
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),45_000);timeout.unref();
    const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.once('close',disconnect);
    try {
      const upstream=await fetch(url,{method:req.method,headers:{Authorization:`Bearer ${token}`},signal:controller.signal});
      const contentType=String(upstream.headers.get('content-type')||'application/octet-stream');
      if(upstream.status>=400&&contentType.includes('application/json')){
        const error=await upstream.json().catch(()=>({}));throw Object.assign(new Error(String(error.error||'Preview runner unavailable.').slice(0,300)),{status:upstream.status});
      }
      const contentMime=safeType(contentType);
      res.writeHead(upstream.status,{
        'Content-Type':contentMime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"sandbox allow-scripts allow-forms; default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; frame-ancestors 'self'",
        'Referrer-Policy':'no-referrer',
      });
      if(req.method==='HEAD'||!upstream.body){res.end();return;}
      await new Promise((resolve,reject)=>{
        const input=Readable.fromWeb(upstream.body);input.on('error',reject);res.on('error',reject);res.on('finish',resolve);input.pipe(res);
      });
    } finally {clearTimeout(timeout);res.removeListener('close',disconnect);}
  }
  async function previewRunner(method,endpoint,body) {
    const base=process.env.ARENA_RUNNER_URL,token=process.env.ARENA_RUNNER_TOKEN;
    if(!base||!token)throw Object.assign(new Error('The dedicated preview runner is not configured.'),{status:503});
    const response=await fetch(`${base.replace(/\/$/,'')}${endpoint}`,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(String(data.error||`Preview runner responded ${response.status}`).slice(0,400)),{status:[400,404,409,410,413,429,503].includes(response.status)?response.status:502});
    return data;
  }
  function rejectLspUpgrade(socket,status,message) {
    if(socket.destroyed||socket.writableEnded)return;
    const body=JSON.stringify({error:String(message||'Language-server connection refused.').slice(0,500)});
    const phrase=({400:'Bad Request',401:'Unauthorized',403:'Forbidden',404:'Not Found',413:'Payload Too Large',429:'Too Many Requests',502:'Bad Gateway',503:'Service Unavailable'})[status]||'Bad Gateway';
    try{socket.end(`HTTP/1.1 ${status} ${phrase}\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\nCache-Control: no-store\r\n\r\n${body}`);}catch{socket.destroy();}
  }
  async function handleLspUpgrade(req,socket,head,url) {
    socket.pause();let sessionId='';
    const cancelSession=async()=>{if(!sessionId)return;try{const base=new URL(process.env.ARENA_RUNNER_URL);await fetch(new URL(`/v1/lsp-sessions/${sessionId}`,base),{method:'DELETE',headers:{Authorization:`Bearer ${process.env.ARENA_RUNNER_TOKEN}`},signal:AbortSignal.timeout(3000)});}catch{}};
    try {
      const origin=req.headers.origin;
      if(origin){let parsed;try{parsed=new URL(origin);}catch{rejectLspUpgrade(socket,403,'Invalid origin.');return;}if(originExpected?parsed.origin!==originExpected:parsed.host!==req.headers.host){rejectLspUpgrade(socket,403,'Cross-origin language-server requests are not allowed.');return;}}
      const key=req.headers['sec-websocket-key'];if(req.method!=='GET'||req.headers.upgrade?.toLowerCase()!=='websocket'||req.headers['sec-websocket-version']!=='13'||typeof key!=='string'||!/^[A-Za-z0-9+/]{22}==?$/.test(key)){rejectLspUpgrade(socket,400,'Invalid WebSocket handshake.');return;}
      const runnerUrl=process.env.ARENA_RUNNER_URL,runnerToken=process.env.ARENA_RUNNER_TOKEN;
      if(!runnerUrl||!runnerToken){rejectLspUpgrade(socket,503,'Hosted language-server runner is not configured.');return;}
      const language=url.searchParams.get('language')||'';const id=url.searchParams.get('projectId')||'';
      if(!lspLanguages.includes(language)){rejectLspUpgrade(socket,503,`Hosted language server is not enabled for ${language||'this language'}.`);return;}
      if(!/^[a-f0-9-]{36}$/i.test(id)){rejectLspUpgrade(socket,400,'Invalid workspace ID.');return;}
      const user=await userForRequest(req);if(!user){rejectLspUpgrade(socket,401,'Sign in to use hosted language services.');return;}
      const workspace=await canAccess(id,user.id,false);if(!workspace){rejectLspUpgrade(socket,404,'Workspace not found.');return;}
      const runner=new URL(runnerUrl);if(!['http:','https:'].includes(runner.protocol)){rejectLspUpgrade(socket,503,'Runner URL must use HTTP(S).');return;}
      const createUrl=new URL('/v1/lsp-sessions',runner);
      const archiveBuffer=archiveFiles(workspace.files);
      if(archiveBuffer.length>8*1024*1024){rejectLspUpgrade(socket,413,'This hosted language-server runner accepts workspace archives up to 8 MiB compressed.');return;}
      let createdResponse,created;
      try{createdResponse=await fetch(createUrl,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${runnerToken}`},body:JSON.stringify({workspaceId:id,language,archive:archiveBuffer.toString('base64')}),signal:AbortSignal.timeout(15_000)});created=await createdResponse.json().catch(()=>({}));}
      catch{rejectLspUpgrade(socket,502,'Could not create an isolated language-server session.');return;}
      if(!createdResponse.ok||typeof created.sessionId!=='string'||!/^[a-f0-9]{48}$/.test(created.sessionId)){rejectLspUpgrade(socket,createdResponse.status===503?503:502,created.error||'Language-server runner refused the session.');return;}
      sessionId=created.sessionId;
      const transport=runner.protocol==='https:'?https:http;
      const proxy=transport.request({protocol:runner.protocol,hostname:runner.hostname,port:runner.port||undefined,method:'GET',path:`/v1/lsp?sessionId=${encodeURIComponent(sessionId)}`,headers:{Host:runner.host,Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Key':key,'Sec-WebSocket-Version':'13',Authorization:`Bearer ${runnerToken}`},timeout:10_000});
      let upgraded=false;
      proxy.on('upgrade',(response,upstream,upstreamHead)=>{
        upgraded=true;if(socket.destroyed){upstream.destroy();cancelSession();return;}
        const accept=crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        if(head?.length)upstream.write(head);if(upstreamHead?.length)socket.write(upstreamHead);
        socket.pipe(upstream);upstream.pipe(socket);socket.resume();
        socket.once('close',()=>{upstream.destroy();cancelSession();});upstream.once('close',()=>{socket.destroy();cancelSession();});
      });
      proxy.on('response',response=>{let text='';response.setEncoding('utf8');response.on('data',chunk=>text=(text+chunk).slice(-1000));response.on('end',()=>{if(!upgraded){rejectLspUpgrade(socket,502,`Language-server runner rejected the WebSocket (${response.statusCode}). ${text}`);cancelSession();}});});
      proxy.on('timeout',()=>proxy.destroy(new Error('Runner upgrade timed out.')));
      proxy.on('error',()=>{if(!upgraded)rejectLspUpgrade(socket,502,'Could not connect to the isolated language-server worker.');cancelSession();});
      proxy.end();
    } catch(error) { rejectLspUpgrade(socket,502,'Could not initialize the language-server session.');await cancelSession(); }
  }
  async function handlePreviewUpgrade(req,socket,head,url) {
    const reject=(status,message)=>rejectLspUpgrade(socket,status,message);
    const match=url.pathname.match(/^\/api\/projects\/([a-f0-9-]{36})\/preview(?:\/(.*))?$/i);
    if(!match){reject(404,'Preview not found.');return;}
    if(req.method!=='GET'||req.headers.upgrade?.toLowerCase()!=='websocket'||req.headers['sec-websocket-version']!=='13'||typeof req.headers['sec-websocket-key']!=='string'){
      reject(400,'Invalid WebSocket handshake.');return;
    }
    if(req.headers.origin){try{const origin=new URL(req.headers.origin);if(originExpected?origin.origin!==originExpected:origin.host!==req.headers.host){reject(403,'Cross-origin preview upgrade denied.');return;}}catch{reject(403,'Invalid WebSocket origin.');return;}}
    const user=await userForRequest(req);if(!user){reject(401,'Sign in to use hosted previews.');return;}
    const workspace=await canAccess(match[1],user.id,false);if(!workspace){reject(404,'Workspace not found.');return;}
    const active=activePreviews.get(match[1]);if(!active){reject(404,'Start the preview first.');return;}
    let target,port;try{({target,port}=resolvePreviewTarget(url,match[2],active));}catch(error){reject(error.status||400,error.message);return;}
    const runnerUrl=process.env.ARENA_RUNNER_URL,runnerToken=process.env.ARENA_RUNNER_TOKEN;
    if(!runnerUrl||!runnerToken){reject(503,'Private preview runner is unavailable.');return;}
    const runner=new URL(runnerUrl);const transport=runner.protocol==='https:'?https:http;
    if(!['http:','https:'].includes(runner.protocol)){reject(503,'Runner URL is invalid.');return;}
    const key=req.headers['sec-websocket-key'];
    const destination=new URL(`/v1/previews/${active.id}/ws`,runner);
    destination.searchParams.set('workspaceId',match[1]);destination.searchParams.set('path',target);destination.searchParams.set('port',String(port));
    const protocol=typeof req.headers['sec-websocket-protocol']==='string'?req.headers['sec-websocket-protocol']:'';
    const headers={Host:runner.host,Upgrade:'websocket',Connection:'Upgrade','Sec-WebSocket-Key':key,'Sec-WebSocket-Version':'13',Authorization:`Bearer ${runnerToken}`};
    if(protocol)headers['Sec-WebSocket-Protocol']=protocol;
    const proxy=transport.request(destination,{method:'GET',headers,timeout:10000});
    let upgraded=false;
    proxy.on('upgrade',(response,upstream,upstreamHead)=>{
      const expected=crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
      if(response.headers['sec-websocket-accept']!==expected){reject(502,'Invalid preview WebSocket accept header.');upstream.destroy();return;}
      upgraded=true;
      const selected=String(response.headers['sec-websocket-protocol']||'');
      if(selected&&(!protocol.split(',').map(s=>s.trim()).includes(selected)||!/^[A-Za-z0-9._-]{1,100}$/.test(selected))){reject(502,'Invalid preview WebSocket subprotocol.');upstream.destroy();return;}
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${expected}\r\n${selected?`Sec-WebSocket-Protocol: ${selected}\r\n`:''}\r\n`);
      if(head?.length)upstream.write(head);if(upstreamHead?.length)socket.write(upstreamHead);
      socket.pipe(upstream);upstream.pipe(socket);socket.resume();
      socket.once('close',()=>upstream.destroy());upstream.once('close',()=>socket.destroy());
    });
    proxy.on('response',response=>{response.resume();if(!upgraded)reject(response.statusCode||502,'Preview WebSocket upgrade was rejected.');});
    proxy.on('timeout',()=>proxy.destroy(new Error('Preview WebSocket timed out.')));
    proxy.on('error',()=>{if(!upgraded)reject(502,'Private preview WebSocket unavailable.');else socket.destroy();});
    socket.once('close',()=>proxy.destroy());proxy.end();
  }
  async function handle(req,res,url) {
    if(!url.pathname.startsWith('/api/'))return false;
    const origin=req.headers.origin;
    if(origin){try{const parsed=new URL(origin);if(originExpected ? parsed.origin!==originExpected : parsed.host!==req.headers.host){fail(res,403,'Cross-origin API requests are not allowed.');return true;}}catch{fail(res,403,'Invalid request origin.');return true;}}
    const ip=req.socket.remoteAddress||'unknown';const now=Date.now();const limit=limits.get(ip)||{start:now,count:0};if(now-limit.start>60000){limit.start=now;limit.count=0;}limit.count++;limits.set(ip,limit);if(limit.count>900){fail(res,429,'Rate limit exceeded.','RATE_LIMITED');return true;}
    try {
      if(url.pathname==='/api/health/live'&&req.method==='GET'){sendJson(res,200,{status:'live'});return true;}
      if(url.pathname==='/api/health/ready'&&req.method==='GET'){
        try{await pool.query('SELECT 1');sendJson(res,200,{status:'ready',database:'connected'});}catch{fail(res,503,'Database unavailable.');}return true;
      }
      if(url.pathname==='/api/status'&&req.method==='GET') { const runner=Boolean(process.env.ARENA_RUNNER_URL&&process.env.ARENA_RUNNER_TOKEN);sendJson(res,200,{hostedMode:true,demo:!process.env.AI_API_KEY,providerConfigured:Boolean(process.env.AI_API_KEY),executionBackend:runner?'remote-runner':'disabled',runnerConfigured:runner,deploymentConfigured:Boolean(process.env.ARENA_DEPLOY_WEBHOOK_URL&&process.env.ARENA_DEPLOY_WEBHOOK_TOKEN),models:(process.env.AI_MODELS||'openai/gpt-4.1').split(',').map(s=>s.trim()).filter(Boolean),workspaceStorage:'postgresql',localOnlyRecommended:false,lspServers:runner?lspLanguages:[],limits:{maxFileBytes:MAX_FILE,maxFiles:MAX_FILES,maxProjectBytes:MAX_PROJECT_BYTES},features:{hostedAuth:true,cloudWorkspaces:true,workspaceSharing:true,fileHistory:true,remoteRunner:runner,isolatedPreviews:runner,deploymentWebhook:Boolean(process.env.ARENA_DEPLOY_WEBHOOK_URL&&process.env.ARENA_DEPLOY_WEBHOOK_TOKEN),monacoEditor:true,hostedLanguageServer:Boolean(runner&&lspLanguages.length>0)}});return true; }
      if(url.pathname==='/api/lsp/status'&&req.method==='GET'){const enabled=Boolean(process.env.ARENA_RUNNER_URL&&process.env.ARENA_RUNNER_TOKEN);sendJson(res,200,{servers:Object.fromEntries((enabled?lspLanguages:[]).map(language=>[language,true])),instructions:enabled&&lspLanguages.length?'Language-server sessions are launched in network-isolated containers by the dedicated runner. Configure ARENA_LSP_LANGUAGES in the app and matching ARENA_LSP_IMAGES on the runner.':'Hosted language servers are disabled until the administrator configures a dedicated runner and language-server images.'});return true;}
      if(url.pathname==='/api/auth/register'&&req.method==='POST') {
        if(!allowSignup){fail(res,403,'Public registration is disabled. Ask the administrator for an account.');return true;}
        const body=await readBody(req,16*1024);const email=String(body.email||'').trim().toLowerCase();const name=String(body.name||email.split('@')[0]||'Developer').trim().slice(0,80);const password=typeof body.password==='string'?body.password:'';
        if(!/^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)||email.length>254){fail(res,400,'Enter a valid email address.');return true;}if(password.length<12||password.length>1024){fail(res,400,'Password must be at least 12 characters.');return true;}if(!name){fail(res,400,'Display name is required.');return true;}
        const hashed=await passwordHash(password);const id=crypto.randomUUID();const client=await pool.connect();let user;
        try{await client.query('BEGIN');const r=await client.query('INSERT INTO arena_users(id,email,display_name,password_salt,password_hash) VALUES($1,$2,$3,$4,$5) RETURNING id,email,display_name AS name',[id,email,name,hashed.salt,hashed.hash]);user=r.rows[0];await client.query('COMMIT');}catch(error){await client.query('ROLLBACK').catch(()=>{});if(error.code==='23505'){fail(res,409,'An account with this email already exists.');return true;}throw error;}finally{client.release();}
        // Only the hash of this high-entropy session token is persisted.
        await createSession(res,id);sendJson(res,201,{user});return true;
      }
      if(url.pathname==='/api/auth/login'&&req.method==='POST') {
        const body=await readBody(req,16*1024);const email=String(body.email||'').trim().toLowerCase();const password=typeof body.password==='string'?body.password:'';
        const r=await pool.query('SELECT id,email,display_name AS name,password_salt,password_hash FROM arena_users WHERE email=$1',[email]);const row=r.rows[0];if(!row){await passwordHash('constant-time login fallback');fail(res,401,'Email or password is incorrect.');return true;}const candidate=await passwordHash(password,row.password_salt);if(!safeEqual(candidate.hash,row.password_hash)){fail(res,401,'Email or password is incorrect.');return true;}
        await pool.query('DELETE FROM arena_sessions WHERE user_id=$1',[row.id]);await createSession(res,row.id);sendJson(res,200,{user:{id:row.id,email:row.email,name:row.name}});return true;
      }
      if(url.pathname==='/api/auth/logout'&&req.method==='POST') {const token=parseCookies(req.headers.cookie||'')[cookieName];if(token)await pool.query('DELETE FROM arena_sessions WHERE token_hash=$1',[sha(token)]);res.setHeader('Set-Cookie',`${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie?'; Secure':''}`);sendJson(res,200,{ok:true});return true;}
      if(url.pathname==='/api/auth/me'&&req.method==='GET') {const user=await userForRequest(req);if(!user){fail(res,401,'Sign in to continue.','AUTH_REQUIRED');return true;}sendJson(res,200,{user});return true;}
      const user=await userForRequest(req);if(!user){fail(res,401,'Sign in to use hosted workspaces.','AUTH_REQUIRED');return true;}
      if(url.pathname==='/api/usage'&&req.method==='GET') {
        const usage=await pool.query("SELECT kind,count FROM arena_usage_daily WHERE user_id=$1 AND day=(now() AT TIME ZONE 'UTC')::date",[user.id]);
        const owned=await pool.query('SELECT count(*)::integer AS total FROM arena_workspaces WHERE owner_id=$1',[user.id]);
        sendJson(res,200,{date:new Date().toISOString().slice(0,10),counts:Object.fromEntries(usage.rows.map(r=>[r.kind,r.count])),ownedWorkspaces:owned.rows[0].total,limits:{workspaces:MAX_USER_WORKSPACES,chatPerDay:MAX_USER_CHAT_PER_DAY,runsPerDay:MAX_USER_RUNS_PER_DAY,deploysPerDay:MAX_USER_DEPLOYS_PER_DAY}});return true;
      }
      if(url.pathname==='/api/chat'&&req.method==='POST') {
        const body=await readBody(req,2*1024*1024);const apiKey=process.env.AI_API_KEY||'';
        if(!apiKey){sendJson(res,200,{demo:true,reason:'NO_PROVIDER_CONFIGURED'});return true;}
        if(!Array.isArray(body.messages)||body.messages.length<1||body.messages.length>40){fail(res,400,'Messages must be an array with 1–40 entries.');return true;}
        const messages=[];let total=0;for(const item of body.messages){if(!item||!['system','user','assistant'].includes(item.role)||typeof item.content!=='string'||item.content.length>80_000){fail(res,400,'A message has an invalid role or content.');return true;}total+=item.content.length;if(total>180_000){fail(res,413,'Conversation context is too large.');return true;}messages.push({role:item.role,content:item.content});}
        const model=typeof body.model==='string'&&AI_MODELS.includes(body.model)?body.model:AI_MODELS[0];
        if(!await consumeQuota(user.id,'chat',MAX_USER_CHAT_PER_DAY)){fail(res,429,'Daily AI request quota reached.','QUOTA_EXCEEDED');return true;}
        try{const response=await fetch(`${AI_BASE_URL}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'system',content:'You are Arena Code, a practical coding assistant. Be accurate and clearly state uncertainty. For a web artifact, give complete code in a fenced code block. Never claim code was tested unless it actually was.'},...messages],max_tokens:5000}),signal:AbortSignal.timeout(CHAT_TIMEOUT_MS)});const payload=await response.json().catch(()=>({}));if(!response.ok){fail(res,response.status>=500?502:400,`AI provider request failed (${response.status}). ${String(payload.error?.message||'Check provider configuration.').slice(0,500)}`,'PROVIDER_ERROR');return true;}const text=payload.choices?.[0]?.message?.content;if(typeof text!=='string'){fail(res,502,'AI provider returned an unexpected response.','INVALID_PROVIDER_RESPONSE');return true;}sendJson(res,200,{text,demo:false,model});}
        catch(error){fail(res,error.name==='TimeoutError'?504:502,error.name==='TimeoutError'?'AI provider request timed out.':'Could not reach the configured AI provider.','PROVIDER_UNAVAILABLE');}return true;
      }
      if(url.pathname==='/api/projects'&&req.method==='GET') {const r=await pool.query('SELECT w.*,m.role FROM arena_workspaces w JOIN arena_workspace_members m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.updated_at DESC LIMIT 200',[user.id]);sendJson(res,200,{projects:r.rows.map(projectSummary)});return true;}
      if(url.pathname==='/api/projects'&&req.method==='POST') {const body=await readBody(req,16*1024);const id=crypto.randomUUID();const name=safeName(body.name);const files={'README.md':{encoding:'utf8',content:`# ${name}\n\nCreated with Arena Code.\n`,size:Buffer.byteLength(`# ${name}\n\nCreated with Arena Code.\n`),updatedAt:new Date().toISOString()}};const client=await pool.connect();try{await client.query('BEGIN');if(!await checkWorkspaceQuota(client,user.id)){await client.query('ROLLBACK');fail(res,429,'Workspace quota reached.','QUOTA_EXCEEDED');return true;}const r=await client.query('INSERT INTO arena_workspaces(id,name,owner_id,files) VALUES($1,$2,$3,$4::jsonb) RETURNING *',[id,name,user.id,JSON.stringify(files)]);await client.query('INSERT INTO arena_workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)',[id,user.id,'owner']);await client.query('COMMIT');sendJson(res,201,{project:projectSummary({...r.rows[0],role:'owner'})});}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}return true;}
      if(url.pathname==='/api/projects/import-zip'&&req.method==='POST') {const body=await readBody(req,Math.ceil(8*1024*1024*4/3)+32*1024);const files=encodeArchive(body.archive);if(Object.keys(files).length>MAX_FILES){fail(res,413,'Archive contains too many files.');return true;}const id=crypto.randomUUID(),name=safeName(body.name);const count=await pool.query('SELECT count(*)::integer AS total FROM arena_workspaces WHERE owner_id=$1',[user.id]);if(!quotaAllowed(count.rows[0].total,MAX_USER_WORKSPACES)){fail(res,429,'Workspace quota reached.','QUOTA_EXCEEDED');return true;}const r=await pool.query('INSERT INTO arena_workspaces(id,name,owner_id,files) VALUES($1,$2,$3,$4::jsonb) RETURNING *',[id,name,user.id,JSON.stringify(files)]);await pool.query('INSERT INTO arena_workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)',[id,user.id,'owner']);sendJson(res,201,{project:projectSummary({...r.rows[0],role:'owner'}),importedFiles:Object.keys(files).length,importedBytes:Object.values(files).reduce((n,f)=>n+f.size,0)});return true;}
      const previewMatch=url.pathname.match(/^\/api\/projects\/([a-f0-9-]{36})\/preview(?:\/(.*))?$/i);
      if(previewMatch&&(req.method==='GET'||req.method==='HEAD')){
        const workspace=await canAccess(previewMatch[1],user.id,false);
        if(!workspace){fail(res,404,'Workspace not found.');return true;}
        const active=activePreviews.get(previewMatch[1]);
        if(!active){fail(res,404,'No active preview. Start the project first.');return true;}
        try {
          const {target,port}=resolvePreviewTarget(url,previewMatch[2],active);
          await streamHostedPreview(req,res,previewMatch[1],active,target,port);
        } catch(error) {
          if([404,410].includes(error.status))activePreviews.delete(previewMatch[1]);
          if(res.headersSent)res.destroy();else fail(res,error.status||502,String(error.message||'Preview failed.').slice(0,250));
        }
        return true;
      }
      const assetMatch=url.pathname.match(/^\/api\/projects\/([a-f0-9-]{36})\/assets\/(.+)$/i);
      if(assetMatch&&(req.method==='GET'||req.method==='HEAD')){const assetProject=await canAccess(assetMatch[1],user.id,false);if(!assetProject){fail(res,404,'Workspace not found.');return true;}let assetPath;try{assetPath=safeProjectPath(decodeURIComponent(assetMatch[2]));}catch(e){fail(res,e.status||400,e.message);return true;}const asset=assetProject.files?.[assetPath];if(!asset){fail(res,404,'Asset not found.');return true;}const buffer=decodeFile(asset);const mime=({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.wasm':'application/wasm','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8'}[path.extname(assetPath).toLowerCase()]||'application/octet-stream');res.writeHead(200,{'Content-Type':mime,'Content-Length':buffer.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});if(req.method==='HEAD')res.end();else res.end(buffer);return true;}
      const match=url.pathname.match(/^\/api\/projects\/([a-f0-9-]{36})(?:\/(files|file|archive\.zip|history|git|run|process|shares|deployments|deploy))?$/i);
      if(!match){fail(res,404,'API route not found.');return true;}
      const id=match[1],suffix=match[2]||'';const write=['PUT','DELETE','POST'].includes(req.method);const ws=await canAccess(id,user.id,write && ['file','history','run','process','git','deploy'].includes(suffix));if(!ws){fail(res,404,'Workspace not found.');return true;}if(ws.denied){fail(res,403,'You have viewer access and cannot modify this workspace.','READ_ONLY_ROLE');return true;}
      if(!suffix&&req.method==='GET'){sendJson(res,200,{project:projectSummary(ws)});return true;}
      if(suffix==='files'&&req.method==='GET'){const listing=listFiles(ws.files);sendJson(res,200,{project:projectSummary(ws),files:listing.files});return true;}
      if(suffix==='file'&&req.method==='GET'){let p;try{p=safeProjectPath(url.searchParams.get('path')||'');}catch(e){fail(res,e.status||400,e.message);return true;}const f=ws.files?.[p];if(!f){fail(res,404,'File not found.');return true;}sendJson(res,200,{path:p,encoding:f.encoding||'utf8',content:f.content,size:bytesFor(f),modifiedAt:f.updatedAt||null,revision:ws.revision});return true;}
      if(suffix==='file'&&req.method==='PUT'){const body=await readBody(req,Math.ceil(MAX_FILE*4/3)+32*1024);let p,file;try{p=safeProjectPath(body.path);file=validateFileContent(body);}catch(e){fail(res,e.status||400,e.message);return true;}const client=await pool.connect();try{await client.query('BEGIN');const locked=await lockedWorkspace(client,id,user.id,true);if(!locked||locked.denied){await client.query('ROLLBACK');fail(res,locked?.denied?403:404,locked?.denied?'Workspace is read-only.':'Workspace not found.');return true;}if(Number.isInteger(body.expectedRevision)&&body.expectedRevision!==Number(locked.revision)){await client.query('ROLLBACK');sendJson(res,409,{error:'Workspace changed since you loaded it. Refresh and reconcile the latest file before saving.',currentRevision:Number(locked.revision)});return true;}const files={...(locked.files||{})};if(files[p])await addHistory(client,id,p,files[p]);files[p]=file;const listing=listFiles(files);if(Object.keys(files).length>MAX_FILES||listing.total>MAX_PROJECT_BYTES){await client.query('ROLLBACK');fail(res,413,'Workspace exceeds file-count or storage limits.');return true;}const updated=await client.query('UPDATE arena_workspaces SET files=$2::jsonb,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING revision',[id,JSON.stringify(files)]);await client.query('COMMIT');sendJson(res,200,{ok:true,path:p,size:file.size,revision:Number(updated.rows[0].revision)});}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}return true;}
      if(suffix==='file'&&req.method==='DELETE'){let p;try{p=safeProjectPath(url.searchParams.get('path')||'');}catch(e){fail(res,e.status||400,e.message);return true;}const client=await pool.connect();try{await client.query('BEGIN');const locked=await lockedWorkspace(client,id,user.id,true);if(!locked||locked.denied){await client.query('ROLLBACK');fail(res,locked?.denied?403:404,'Workspace not found or read-only.');return true;}if(Number.isInteger(Number(url.searchParams.get('expectedRevision')))&&url.searchParams.has('expectedRevision')&&Number(url.searchParams.get('expectedRevision'))!==Number(locked.revision)){await client.query('ROLLBACK');sendJson(res,409,{error:'Workspace changed since you loaded it. Refresh before deleting.',currentRevision:Number(locked.revision)});return true;}const files={...(locked.files||{})};if(!files[p]){await client.query('ROLLBACK');fail(res,404,'File not found.');return true;}await addHistory(client,id,p,files[p]);delete files[p];const updated=await client.query('UPDATE arena_workspaces SET files=$2::jsonb,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING revision',[id,JSON.stringify(files)]);await client.query('COMMIT');sendJson(res,200,{ok:true,path:p,revision:Number(updated.rows[0].revision)});}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}return true;}
      if(suffix==='archive.zip'&&(req.method==='GET'||req.method==='HEAD')){const archive=archiveFiles(ws.files);res.writeHead(200,{'Content-Type':'application/zip','Content-Length':archive.length,'Content-Disposition':`attachment; filename="${safeName(ws.name).replace(/[^A-Za-z0-9_-]+/g,'-')||'arena-project'}.zip"`,'Cache-Control':'no-store'});if(req.method==='HEAD')res.end();else res.end(archive);return true;}
      if(suffix==='history'&&req.method==='GET'){let p;try{p=safeProjectPath(url.searchParams.get('path')||'');}catch(e){fail(res,e.status||400,e.message);return true;}const r=await pool.query('SELECT id,created_at,size FROM arena_file_history WHERE workspace_id=$1 AND file_path=$2 ORDER BY created_at DESC LIMIT 10',[id,p]);sendJson(res,200,{versions:r.rows.map(x=>({id:x.id,createdAt:x.created_at,size:x.size}))});return true;}
      if(suffix==='history'&&req.method==='POST'){const body=await readBody(req,16*1024);let p;try{p=safeProjectPath(body.path);}catch(e){fail(res,e.status||400,e.message);return true;}const client=await pool.connect();try{await client.query('BEGIN');const locked=await lockedWorkspace(client,id,user.id,true);if(!locked||locked.denied){await client.query('ROLLBACK');fail(res,403,'Workspace is read-only.');return true;}if(Number.isInteger(body.expectedRevision)&&body.expectedRevision!==Number(locked.revision)){await client.query('ROLLBACK');sendJson(res,409,{error:'Workspace changed since you loaded it. Refresh before restoring history.',currentRevision:Number(locked.revision)});return true;}const version=await client.query('SELECT * FROM arena_file_history WHERE workspace_id=$1 AND file_path=$2 AND id=$3',[id,p,body.versionId]);if(!version.rows[0]){await client.query('ROLLBACK');fail(res,404,'File history version not found.');return true;}const files={...(locked.files||{})};if(files[p])await addHistory(client,id,p,files[p]);const row=version.rows[0];files[p]={encoding:row.encoding,content:row.content,size:row.size,updatedAt:new Date().toISOString()};const updated=await client.query('UPDATE arena_workspaces SET files=$2::jsonb,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING revision',[id,JSON.stringify(files)]);await client.query('COMMIT');sendJson(res,200,{ok:true,path:p,restoredVersion:row.id,revision:Number(updated.rows[0].revision)});}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}return true;}
      if(suffix==='shares'&&req.method==='GET'){if(ws.role!=='owner'){fail(res,403,'Only the workspace owner can manage sharing.');return true;}const r=await pool.query('SELECT u.id,u.email,u.display_name AS name,m.role,m.created_at AS joined_at FROM arena_workspace_members m JOIN arena_users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY CASE m.role WHEN \'owner\' THEN 0 WHEN \'editor\' THEN 1 ELSE 2 END,u.email',[id]);sendJson(res,200,{members:r.rows});return true;}
      if(suffix==='shares'&&req.method==='POST'){if(ws.role!=='owner'){fail(res,403,'Only the workspace owner can share a workspace.');return true;}const body=await readBody(req,16*1024);const email=String(body.email||'').trim().toLowerCase();const role=body.role==='viewer'?'viewer':'editor';if(email===user.email.toLowerCase()){fail(res,400,'The owner already has access.');return true;}const target=await pool.query('SELECT id FROM arena_users WHERE email=$1',[email]);if(!target.rows[0]){fail(res,404,'That email must register an Arena account before you can add it.');return true;}await pool.query(`INSERT INTO arena_workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=CASE WHEN arena_workspace_members.role='owner' THEN 'owner' ELSE EXCLUDED.role END`,[id,target.rows[0].id,role]);sendJson(res,200,{ok:true,email,role});return true;}
      if(suffix==='shares'&&req.method==='DELETE'){if(ws.role!=='owner'){fail(res,403,'Only the workspace owner can remove members.');return true;}const userId=url.searchParams.get('userId')||'';const result=await pool.query("DELETE FROM arena_workspace_members WHERE workspace_id=$1 AND user_id=$2 AND role<>'owner'",[id,userId]);sendJson(res,200,{ok:true,removed:result.rowCount});return true;}
      if(suffix==='deployments'&&req.method==='GET'){const r=await pool.query('SELECT id,provider,status,target_url AS "targetUrl",message,created_at AS "createdAt" FROM arena_deployments WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 20',[id]);sendJson(res,200,{deployments:r.rows});return true;}
      if(suffix==='deploy'&&req.method==='POST'){if(ws.role!=='owner'){fail(res,403,'Only the workspace owner may deploy.');return true;}const webhook=process.env.ARENA_DEPLOY_WEBHOOK_URL,token=process.env.ARENA_DEPLOY_WEBHOOK_TOKEN;if(!webhook||!token){fail(res,503,'No deployment adapter is configured. Configure an administrator-owned ARENA_DEPLOY_WEBHOOK_URL and ARENA_DEPLOY_WEBHOOK_TOKEN.');return true;}const body=await readBody(req,16*1024);if(!await consumeQuota(user.id,'deploy',MAX_USER_DEPLOYS_PER_DAY)){fail(res,429,'Daily deployment quota reached.','QUOTA_EXCEEDED');return true;}const idDeploy=crypto.randomUUID();const archive=archiveFiles(ws.files).toString('base64');await pool.query("INSERT INTO arena_deployments(id,workspace_id,requested_by,provider,status,message) VALUES($1,$2,$3,'webhook','running','Deployment request queued')",[idDeploy,id,user.id]);let response,data;try{response=await fetch(webhook,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({deploymentId:idDeploy,workspaceId:id,workspaceName:ws.name,revision:ws.revision,archive,requestedBy:user.email,options:body.options||{}}),signal:AbortSignal.timeout(120000)});data=await response.json().catch(()=>({message:'Deployment adapter returned a non-JSON result.'}));if(!response.ok)throw new Error(data.error||`Deployment adapter responded ${response.status}.`);await pool.query("UPDATE arena_deployments SET status='succeeded',target_url=$2,message=$3 WHERE id=$1",[idDeploy,typeof data.url==='string'?data.url:null,String(data.message||'Deployment completed').slice(0,1000)]);sendJson(res,200,{ok:true,deployment:{id:idDeploy,status:'succeeded',url:typeof data.url==='string'?data.url:null,message:data.message||'Deployment completed'}});}catch(e){await pool.query("UPDATE arena_deployments SET status='failed',message=$2 WHERE id=$1",[idDeploy,String(e.message||e).slice(0,1000)]);fail(res,502,`Deployment adapter failed: ${String(e.message||e).slice(0,500)}`);}return true;}
      if(suffix==='run'&&req.method==='POST'){const body=await readBody(req,16*1024);if(body.action==='json-check'){let p;try{p=safeProjectPath(body.path||'');}catch(e){fail(res,e.status||400,e.message);return true;}const file=ws.files?.[p];if(!file||file.encoding==='base64'){fail(res,400,'Syntax checks require an editable text file.');return true;}if(!/\.json$/i.test(p)){fail(res,400,'json-check only accepts .json files.');return true;}try{JSON.parse(file.content);sendJson(res,200,{ok:true,code:0,stdout:'Valid JSON.\n',stderr:'',timedOut:false});}catch(e){sendJson(res,200,{ok:false,code:1,stdout:'',stderr:`${e.message}\n`,timedOut:false});}return true;}if(!['node-check','python-check','python-test','python-install','npm-test','npm-build','npm-install'].includes(body.action)){fail(res,400,'Hosted runner supports Node syntax checks, Python checks/tests/dependency install, and npm build/test/install.');return true;}let extra={};if(['node-check','python-check'].includes(body.action)){let p;try{p=safeProjectPath(body.path||'');}catch(e){fail(res,e.status||400,e.message);return true;}const file=ws.files?.[p];if(!file||file.encoding==='base64'){fail(res,400,'Syntax checks require an editable text file.');return true;}if(body.action==='node-check'&&!/\.(?:js|cjs|mjs)$/i.test(p)){fail(res,400,'node-check only accepts JavaScript files.');return true;}if(body.action==='python-check'&&!/\.py$/i.test(p)){fail(res,400,'python-check only accepts Python files.');return true;}extra.path=p;}if(!await consumeQuota(user.id,'run',MAX_USER_RUNS_PER_DAY)){fail(res,429,'Daily execution quota reached.','QUOTA_EXCEEDED');return true;}try{const r=await runnerCall(body.action,ws,extra);sendJson(res,200,{...r,backend:'remote-runner',action:body.action});}catch(e){fail(res,e.status||502,e.message); }return true;}
      if(suffix==='process'&&(req.method==='GET'||req.method==='POST')){
        const active=activePreviews.get(id);
        if(req.method==='GET'){
          if(!active){sendJson(res,200,{processes:[]});return true;}
          try{const info=(await previewRunner('GET',`/v1/previews/${active.id}?workspaceId=${encodeURIComponent(id)}`)).preview;
            sendJson(res,200,{processes:[{id:active.id,status:info.status,script:active.script,previewUrl:`/api/projects/${id}/preview/index.html`,port:active.port||4173,expiresAt:info.expiresAt,output:info.output||'Preview is running.'}]});
          }catch(e){if([404,410].includes(e.status)){activePreviews.delete(id);sendJson(res,200,{processes:[]});}else throw e;}
          return true;
        }
        const body=await readBody(req,16*1024);
        if(body.action==='stop'){
          if(!active){sendJson(res,200,{ok:true,process:{status:'stopped'}});return true;}
          if(body.processId&&body.processId!==active.id){fail(res,404,'Preview session not found.');return true;}
          await previewRunner('DELETE',`/v1/previews/${active.id}?workspaceId=${encodeURIComponent(id)}`);
          activePreviews.delete(id);sendJson(res,200,{ok:true,process:{id:active.id,script:active.script,status:'stopped'}});return true;
        }
        if(body.action!=='start'||!['dev','start','preview'].includes(body.script)){fail(res,400,'Choose start with an existing dev, start, or preview npm script.');return true;}
        if(!await consumeQuota(user.id,'run',MAX_USER_RUNS_PER_DAY)){fail(res,429,'Daily execution quota reached.','QUOTA_EXCEEDED');return true;}
        const archive=archiveFiles(ws.files);
        if(archive.length>8*1024*1024){fail(res,413,'Project archive exceeds 8 MiB.');return true;}
        const result=await previewRunner('POST','/v1/previews',{workspaceId:id,script:body.script,port:previewPort(body.port),archive:archive.toString('base64')});
        const session=result.preview;activePreviews.set(id,session);
        sendJson(res,201,{ok:true,process:{id:session.id,script:session.script,status:'running',previewUrl:`/api/projects/${id}/preview/index.html`,port:session.port||4173,expiresAt:session.expiresAt,output:'Preview is starting in an isolated Docker container. Allow a moment for the application to listen on 127.0.0.1:4173.'}});return true;
      }
      if(suffix==='git'&&req.method==='POST'){fail(res,503,'Cloud Git integration is not configured. Use a connected Git provider or export the project archive.');return true;}
      if(suffix==='deployments'&&req.method==='POST'){fail(res,405,'Use the /deploy endpoint to create a deployment.');return true;}
      fail(res,405,'Method not allowed.');return true;
    } catch(error) { if(res.headersSent){res.destroy();return true;} fail(res,error.status||500,error.status?error.message:'Hosted API internal error.');return true; }
  }
  return {init,handle,handleLspUpgrade,handlePreviewUpgrade,close:async()=>{await pool.end();}};
}
module.exports={createHostedApp,safeProjectPath,parseCookies,passwordHash,sha,validateFileContent,listFiles,quotaAllowed};
