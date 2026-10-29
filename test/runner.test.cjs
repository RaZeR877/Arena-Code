'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { makeZip } = require('../zip-utils.cjs');

const root = path.resolve(__dirname, '..');
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
function request(base, pathName, options = {}) { return fetch(`${base}${pathName}`, options); }
async function ready(child, base) {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(`Runner exited early (${child.exitCode}).`);
    try { const response = await request(base, '/health'); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error('Runner did not become ready.');
}

function socketReader(socket) {
  let buffer=Buffer.alloc(0); const waiters=[];
  function drain(){for(let i=0;i<waiters.length;i++){const w=waiters[i];let result;try{result=w.parse(buffer);}catch(error){waiters.splice(i,1);clearTimeout(w.timer);w.reject(error);i--;continue;}if(!result)continue;buffer=buffer.subarray(result.bytes);waiters.splice(i,1);clearTimeout(w.timer);w.resolve(result.value);i--;}}
  socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);drain();});
  return {read(parse,timeoutMs=5000){return new Promise((resolve,reject)=>{const w={parse,resolve,reject,timer:null};w.timer=setTimeout(()=>{const i=waiters.indexOf(w);if(i>=0)waiters.splice(i,1);reject(new Error('Timed out reading WebSocket data.'));},timeoutMs);waiters.push(w);drain();});}};
}
function parseHttpHeaders(buffer){const end=buffer.indexOf('\r\n\r\n');return end<0?null:{bytes:end+4,value:buffer.subarray(0,end+4).toString('ascii')};}
function parseWsServerFrame(buffer){if(buffer.length<2)return null;const opcode=buffer[0]&15;if(opcode!==1&&opcode!==8)return null;let length=buffer[1]&127,offset=2;if(length===126){if(buffer.length<4)return null;length=buffer.readUInt16BE(2);offset=4;}else if(length===127){if(buffer.length<10)return null;const n=buffer.readBigUInt64BE(2);if(n>2_000_000n)throw new Error('Oversized server frame');length=Number(n);offset=10;}if(buffer.length<offset+length)return null;return {bytes:offset+length,value:{opcode,text:buffer.subarray(offset,offset+length).toString('utf8')}};}
function maskWsText(value){const payload=Buffer.from(JSON.stringify(value)),mask=crypto.randomBytes(4);let header;if(payload.length<126)header=Buffer.from([0x81,0x80|payload.length]);else if(payload.length<65536){header=Buffer.alloc(4);header[0]=0x81;header[1]=0xfe;header.writeUInt16BE(payload.length,2);}else throw new Error('Test frame too large');const masked=Buffer.alloc(payload.length);for(let i=0;i<payload.length;i++)masked[i]=payload[i]^mask[i%4];return Buffer.concat([header,mask,masked]);}

 test('isolated runner validates auth, syntax checks, npm cache and network restrictions', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-runner-test-'));
  const docker = path.join(temp, process.platform === 'win32' ? 'fake-docker.cmd' : 'fake-docker');
  const logPath = path.join(temp, 'docker-calls.jsonl');
  const fakeDocker = fs.readFileSync(path.join(root, 'test', 'fixtures', 'fake-docker.cjs'), 'utf8');
  fs.writeFileSync(docker, fakeDocker, { mode: 0o700 });
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(root, 'runner', 'worker.cjs')], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ARENA_RUNNER_TOKEN: 'runner-test-token', ARENA_DOCKER_BIN: docker, ARENA_RUNNER_DATA: path.join(temp, 'runner-data'), ARENA_LSP_IMAGES: JSON.stringify({python:'fake-python-lsp:latest'}), MOCK_DOCKER_LOG: logPath }, stdio: ['ignore','pipe','pipe'] });
  let logs = ''; child.stdout.on('data', c => logs += c); child.stderr.on('data', c => logs += c);
  t.after(async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 2000))]); } fs.rmSync(temp,{recursive:true,force:true}); });
  await ready(child, base);
  const workspaceId = crypto.randomUUID();
  const authMissing = await request(base, '/v1/run', { method:'POST', headers:{'content-type':'application/json'}, body:'{}' });
  assert.equal(authMissing.status, 401);
  const disabledLsp = await request(base, '/v1/lsp-sessions', {method:'POST',headers:{'content-type':'application/json',authorization:'Bearer runner-test-token'},body:JSON.stringify({workspaceId:crypto.randomUUID(),language:'typescript',archive:makeZip([{name:'main.ts',data:Buffer.from('const value = 1;')}]).toString('base64')})});
  assert.equal(disabledLsp.status, 503, 'hosted LSP must fail closed when a language image is not configured');
  const lspId = crypto.randomUUID();
  const lspStarted = await request(base, '/v1/lsp-sessions', {method:'POST',headers:{'content-type':'application/json',authorization:'Bearer runner-test-token'},body:JSON.stringify({workspaceId:lspId,language:'python',archive:makeZip([{name:'main.py',data:Buffer.from('print(1)')}]).toString('base64')})});
  assert.equal(lspStarted.status,201); const lspSession=await lspStarted.json(); assert.match(lspSession.sessionId,/^[a-f0-9]{48}$/);
  const lspSocket=net.createConnection(port,'127.0.0.1');t.after(()=>{try{lspSocket.destroy();}catch{}});await new Promise((resolve,reject)=>{lspSocket.once('connect',resolve);lspSocket.once('error',reject);});
  const lspReader=socketReader(lspSocket),wsKey=crypto.randomBytes(16).toString('base64');
  lspSocket.write(`GET /v1/lsp?sessionId=${lspSession.sessionId} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${wsKey}\r\nAuthorization: Bearer runner-test-token\r\n\r\n`);
  const upgrade=await lspReader.read(parseHttpHeaders);assert.match(upgrade,/HTTP\/1\.1 101 Switching Protocols/);
  lspSocket.write(maskWsText({jsonrpc:'2.0',id:29,method:'initialize',params:{}}));
  const initialized=await lspReader.read(parseWsServerFrame);assert.equal(initialized.opcode,1);assert.equal(JSON.parse(initialized.text).id,29);
  lspSocket.end();

  const nodeArchive = makeZip([{name:'src/main.js',data:Buffer.from('const value = 1;\n')},{name:'package.json',data:Buffer.from('{"scripts":{"test":"node -e \\\"process.exit(0)\\\""}}')}]).toString('base64');
  const nodeCheck = await request(base, '/v1/run', {method:'POST',headers:{'content-type':'application/json',authorization:'Bearer runner-test-token'},body:JSON.stringify({workspaceId,archive:nodeArchive,action:'node-check',path:'src/main.js'})});
  assert.equal(nodeCheck.status,200); assert.equal((await nodeCheck.json()).ok,true);
  const install = await request(base, '/v1/run', {method:'POST',headers:{'content-type':'application/json',authorization:'Bearer runner-test-token'},body:JSON.stringify({workspaceId,archive:nodeArchive,action:'npm-install'})});
  const installed = await install.json(); assert.equal(install.status,200); assert.equal(installed.ok,true); assert.equal(installed.dependenciesCached,true);
  const testRun = await request(base, '/v1/run', {method:'POST',headers:{'content-type':'application/json',authorization:'Bearer runner-test-token'},body:JSON.stringify({workspaceId,archive:nodeArchive,action:'npm-test'})});
  assert.equal(testRun.status,200); assert.equal((await testRun.json()).ok,true);

  const pyId = crypto.randomUUID();
  const pyArchive = makeZip([{name:'src/main.py',data:Buffer.from('def value(): return 42\n')},{name:'tests/test_main.py',data:Buffer.from('import unittest\nclass T(unittest.TestCase):\n def test_ok(self): self.assertTrue(True)\n')}]).toString('base64');
  const pythonCheck = await request(base, '/v1/run', {method:'POST',headers:{'content-type':'application/json',authorization:'Bearer runner-test-token'},body:JSON.stringify({workspaceId:pyId,archive:pyArchive,action:'python-check',path:'src/main.py'})});
  assert.equal(pythonCheck.status,200); assert.equal((await pythonCheck.json()).ok,true);
  const pythonTest = await request(base, '/v1/run', {method:'POST',headers:{'content-type':'application/json',authorization:'Bearer runner-test-token'},body:JSON.stringify({workspaceId:pyId,archive:pyArchive,action:'python-test'})});
  assert.equal(pythonTest.status,200); assert.equal((await pythonTest.json()).ok,true);
  const previewArchive = makeZip([
    {name:'package.json',data:Buffer.from(JSON.stringify({scripts:{start:'node index.js'}}))},
    {name:'index.js',data:Buffer.from('require("node:http").createServer((req,res)=>res.end("ok")).listen(process.env.PORT,process.env.HOST);')}
  ]).toString('base64');
  const previewLaunch = await request(base,'/v1/previews',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer runner-test-token'},body:JSON.stringify({workspaceId,script:'start',archive:previewArchive})});
  assert.equal(previewLaunch.status,201,'preview startup failed');
  // A second launch is intentionally not required: the preview must remain stable until stop/TTL.
  const started=await previewLaunch.json().catch(()=>null);
  assert.ok(started?.preview?.id && /^[a-f0-9]{40}$/.test(started.preview.id));
  const previewId=started.preview.id;
  const previewSocket=net.createConnection(port,'127.0.0.1');
  t.after(()=>previewSocket.destroy());
  await new Promise((resolve,reject)=>{previewSocket.once('connect',resolve);previewSocket.once('error',reject);});
  const previewReader=socketReader(previewSocket),previewKey=crypto.randomBytes(16).toString('base64');
  previewSocket.write(`GET /v1/previews/${previewId}/ws?workspaceId=${workspaceId}&path=%2Fhmr&port=5173 HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${previewKey}\r\nAuthorization: Bearer runner-test-token\r\n\r\n`);
  const previewUpgrade=await previewReader.read(parseHttpHeaders);
  assert.match(previewUpgrade,/101 Switching Protocols/);
  const previewFrame=await previewReader.read(parseWsServerFrame);
  assert.equal(previewFrame.text,'mock-hmr-live');
  previewSocket.destroy();
  const rawPreview = await request(base,`/v1/previews/${previewId}/raw?workspaceId=${workspaceId}&path=%2Findex.html&port=4173`,{headers:{authorization:'Bearer runner-test-token'}});
  assert.equal(rawPreview.status,200);assert.match(await rawPreview.text(),/Preview \/index.html/);
  const rawDenied = await request(base,`/v1/previews/${previewId}/raw?workspaceId=${crypto.randomUUID()}&path=%2Findex.html`,{headers:{authorization:'Bearer runner-test-token'}});assert.equal(rawDenied.status,404);
  const portDenied = await request(base,`/v1/previews/${previewId}/raw?workspaceId=${workspaceId}&port=22`,{headers:{authorization:'Bearer runner-test-token'}});assert.equal(portDenied.status,400);
  const wrongPreview = await request(base,`/v1/previews/${previewId}/content?workspaceId=${crypto.randomUUID()}&path=%2Findex.html`,{headers:{authorization:'Bearer runner-test-token'}});
  assert.equal(wrongPreview.status,404);
  const rightPreview = await request(base,`/v1/previews/${previewId}/content?workspaceId=${workspaceId}&path=%2Findex.html`,{headers:{authorization:'Bearer runner-test-token'}});
  assert.equal(rightPreview.status,200);
  const previewData=await rightPreview.json();
  assert.match(Buffer.from(previewData.content,'base64').toString(),/Preview \/index.html/);
  const unsafePreview = await request(base,`/v1/previews/${previewId}/content?workspaceId=${workspaceId}&path=%2F..%2Fsecret`,{headers:{authorization:'Bearer runner-test-token'}});
  assert.equal(unsafePreview.status,400);
  const stopPreview=await request(base,`/v1/previews/${previewId}?workspaceId=${workspaceId}`,{method:'DELETE',headers:{authorization:'Bearer runner-test-token'}});
  assert.equal(stopPreview.status,200);
  const afterStop=await request(base,`/v1/previews/${previewId}/content?workspaceId=${workspaceId}&path=%2F`,{headers:{authorization:'Bearer runner-test-token'}});
  assert.equal(afterStop.status,404);
  const calls = fs.readFileSync(logPath,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(calls.some(args=>args.includes('--detach')&&args.includes('--network=none')&&args.includes('--read-only')&&args.includes('--cap-drop=ALL')&&args.includes('--pids-limit=96')&&!args.includes('--publish')),'hosted previews must use tightly restricted, unpublished Docker containers');
  assert.ok(calls.some(args=>args[0]==='rm'&&args.includes('-f')),'preview stop must remove the container');
  assert.ok(calls.some(args=>args.includes('--network=none')&&args.includes('--check')),'syntax checks must use network-isolated containers');
  assert.ok(calls.some(args=>args.includes('fake-python-lsp:latest')&&args.includes('pylsp')&&args.includes('--stdio')&&args.includes('--network=none')&&args.some(v=>v.includes('dst=/workspace,readonly'))),'LSP must run a fixed command in a read-only, network-isolated container');
  assert.ok(calls.some(args=>args.includes('--network=bridge')&&args.some(v=>v.includes('npm install'))),'dependency download alone may access the network');
  assert.ok(calls.some(args=>args.includes('--network=none')&&args.some(v=>v.includes('readonly'))),'test runner should mount dependency cache read-only');
  assert.match(logs, /isolated runner listening|Arena isolated runner/);
});
