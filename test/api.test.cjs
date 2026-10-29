'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { makeZip, parseZip } = require('../zip-utils.cjs');

const root = path.resolve(__dirname, '..');
let child, base, testProjectId, importedProjectId;
async function freePort() {
  const s = net.createServer();
  await new Promise((resolve, reject) => s.once('error', reject).listen(0, '127.0.0.1', resolve));
  const p = s.address().port; await new Promise(resolve => s.close(resolve)); return p;
}
async function waitReady() {
  let last;
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(`Server exited early with code ${child.exitCode}`);
    try { const res = await fetch(`${base}/api/status`); if (res.ok) return; last = new Error(`status ${res.status}`); }
    catch (e) { last = e; }
    await new Promise(r => setTimeout(r, 100));
  }
  throw last || new Error('Server did not start');
}
test('ZIP utility round-trips content and rejects corrupt archives', () => {
  const image = Buffer.from([0, 1, 2, 127, 128, 255]);
  const zip = makeZip([{ name: 'a.txt', data: Buffer.from('hello') }, { name: 'assets/pixel.bin', data: image }]);
  const decoded = parseZip(zip);
  assert.equal(decoded.length, 2);
  assert.equal(decoded.find(x => x.name === 'a.txt').data.toString(), 'hello');
  assert.deepEqual(decoded.find(x => x.name === 'assets/pixel.bin').data, image);
  assert.throws(() => parseZip(Buffer.from('no zip here')), /Invalid ZIP/);
  assert.throws(() => makeZip([{ name: '../escape.js', data: Buffer.from('bad') }]), /invalid file path/i);
  const pathTraversalZip = makeZip([{ name: 'safe', data: Buffer.from('x') }]);
  const endOffset = pathTraversalZip.length - 22;
  const centralOffset = pathTraversalZip.readUInt32LE(endOffset + 16);
  Buffer.from('../x').copy(pathTraversalZip, 30);
  Buffer.from('../x').copy(pathTraversalZip, centralOffset + 46);
  assert.throws(() => parseZip(pathTraversalZip), /unsafe path/i, 'Parser must reject traversal even when a crafted ZIP bypasses the writer');
});

test('local API, project files, syntax checks, test runner, and path protection', async t => {
  const port = await freePort(); base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), AI_API_KEY: '', AI_MODELS: 'test/model-a,test/model-b' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', c => logs += c); child.stderr.on('data', c => logs += c);
  t.after(async () => { if (child && child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([new Promise(r => child.once('exit', r)), new Promise(r => setTimeout(r, 2000))]); } for (const id of [testProjectId, importedProjectId]) if (id) { fs.rmSync(path.join(root, 'data', 'projects', id), { recursive: true, force: true }); fs.rmSync(path.join(root, 'data', 'history', id), { recursive: true, force: true }); fs.rmSync(path.join(root, 'data', 'checkpoints', id), { recursive: true, force: true }); } });
  await waitReady();

  const status = await fetch(`${base}/api/status`); const statusData = await status.json();
  assert.equal(status.status, 200); assert.equal(statusData.demo, true); assert.equal(statusData.workspaceStorage, 'local-filesystem'); assert.equal(statusData.features.zipImportExport, true); assert.equal(statusData.limits.maxArchiveBytes, 8 * 1024 * 1024);
  assert.equal('apiKey' in statusData, false);
  assert.deepEqual(statusData.models, ['test/model-a', 'test/model-b'], 'Server model IDs should be configurable without editing source files');

  const staticFile = await fetch(`${base}/`); assert.equal(staticFile.status, 200); assert.match(staticFile.headers.get('x-content-type-options'), /nosniff/);
  const hiddenServer = await fetch(`${base}/server.js`); assert.equal(hiddenServer.status, 404);
  const blockedRemote = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env: { ...process.env, HOST: '0.0.0.0', PORT: '65530', ARENA_ALLOW_REMOTE: '' }, stdio: 'ignore' });
  const remoteExit = await new Promise(resolve => { const timer = setTimeout(() => { blockedRemote.kill(); resolve(null); }, 2000); blockedRemote.once('exit', code => { clearTimeout(timer); resolve(code); }); });
  assert.equal(remoteExit, 1, 'Remote bind should require explicit opt-in');
  const traversal = await fetch(`${base}/%2e%2e%2fserver.js`); assert.notEqual(traversal.status, 200);
  const cors = await fetch(`${base}/api/projects`, { headers: { Origin: 'https://attacker.example' } }); assert.equal(cors.status, 403);

  const created = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test Project' }) });
  assert.equal(created.status, 201); const { project } = await created.json(); testProjectId = project.id; assert.match(project.id, /^[a-f0-9-]{36}$/i);
  const list = await fetch(`${base}/api/projects`); assert.equal((await list.json()).projects.some(p => p.id === project.id), true);

  const save = async (p, content) => fetch(`${base}/api/projects/${project.id}/file`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p, content }) });
  assert.equal((await save('src/index.js', 'const value = 42;\n')).status, 200);
  const read = await fetch(`${base}/api/projects/${project.id}/file?path=${encodeURIComponent('src/index.js')}`); assert.equal((await read.json()).content, 'const value = 42;\n');
  assert.equal((await save('src/index.js', 'const value = 43;\n')).status, 200);
  const historyResponse = await fetch(`${base}/api/projects/${project.id}/history?path=${encodeURIComponent('src/index.js')}`); const historyData = await historyResponse.json(); assert.equal(historyData.versions.length, 1);
  const restoreResponse = await fetch(`${base}/api/projects/${project.id}/history`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'src/index.js', versionId: historyData.versions[0].id }) }); assert.equal((await restoreResponse.json()).ok, true);
  const restoredRead = await fetch(`${base}/api/projects/${project.id}/file?path=${encodeURIComponent('src/index.js')}`); assert.equal((await restoredRead.json()).content, 'const value = 42;\n');
  assert.equal((await save('../server.js', 'bad')).status, 400);
  assert.equal((await save('/tmp/evil.js', 'bad')).status, 400);
  assert.equal((await save('.env', 'SECRET=x')).status, 400); assert.equal((await save('.npmrc', '//registry.npmjs.org/:_authToken=bad')).status, 400); assert.equal((await save('private.key', 'private')).status, 400);
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
  const imageSave = await fetch(`${base}/api/projects/${project.id}/file`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'assets/test.png', encoding: 'base64', content: imageBytes.toString('base64') }) });
  assert.equal(imageSave.status, 200);
  const imageRead = await fetch(`${base}/api/projects/${project.id}/file?path=${encodeURIComponent('assets/test.png')}`); const imageData = await imageRead.json(); assert.equal(imageData.encoding, 'base64'); assert.deepEqual(Buffer.from(imageData.content, 'base64'), imageBytes);
  const servedAsset = await fetch(`${base}/api/projects/${project.id}/assets/assets/test.png`); assert.equal(servedAsset.status, 200); assert.match(servedAsset.headers.get('content-type'), /image\/png/); assert.deepEqual(Buffer.from(await servedAsset.arrayBuffer()), imageBytes);

  fs.writeFileSync(path.join(root, 'data', 'projects', project.id, '.env'), 'KEEP_MY_LOCAL_SECRET=1');
  fs.writeFileSync(path.join(root, 'data', 'projects', project.id, '.npmrc'), 'PRIVATE_REGISTRY_TOKEN=1');
  fs.mkdirSync(path.join(root, 'data', 'projects', project.id, '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'projects', project.id, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  // A local agent's safety checkpoint restores an entire multi-file project, not just an individual file.
  const checkpointUrl = `${base}/api/projects/${project.id}/checkpoints`;
  const newCheckpoint = await fetch(checkpointUrl, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'create', name:'Before multi-file change' }) });
  assert.equal(newCheckpoint.status, 201); const checkpoint = (await newCheckpoint.json()).checkpoint;
  assert.match(checkpoint.id, /^[a-f0-9-]{36}$/);
  await save('src/index.js', 'throw new Error("changed");\n');
  await save('new-file.js', 'const added = true;\n');
  const withoutConfirm = await fetch(checkpointUrl, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'restore', checkpointId:checkpoint.id }) });
  assert.equal(withoutConfirm.status, 400);
  const afterListing = await (await fetch(checkpointUrl)).json();
  assert.ok(afterListing.checkpoints.some(item => item.id === checkpoint.id));
  const restoredCheckpoint = await fetch(checkpointUrl, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'restore', checkpointId:checkpoint.id, confirm:true }) });
  assert.equal(restoredCheckpoint.status, 200, await restoredCheckpoint.text().then(x => x.slice(0,300)));
  const restoredSource = await (await fetch(`${base}/api/projects/${project.id}/file?path=src%2Findex.js`)).json();
  assert.equal(restoredSource.content, 'const value = 42;\n');
  assert.equal((await fetch(`${base}/api/projects/${project.id}/file?path=new-file.js`)).status, 404);
  const restoredBinary = await (await fetch(`${base}/api/projects/${project.id}/file?path=assets%2Ftest.png`)).json();
  assert.deepEqual(Buffer.from(restoredBinary.content, 'base64'), imageBytes);
  assert.equal(fs.readFileSync(path.join(root, 'data', 'projects', project.id, '.env'), 'utf8'), 'KEEP_MY_LOCAL_SECRET=1');
  assert.equal(fs.readFileSync(path.join(root, 'data', 'projects', project.id, '.git', 'HEAD'), 'utf8'), 'ref: refs/heads/main\n');
  assert.equal(fs.readFileSync(path.join(root, 'data', 'projects', project.id, '.npmrc'), 'utf8'), 'PRIVATE_REGISTRY_TOKEN=1');

  // Standard ZIP export preserves text and binary assets, and excludes internal metadata and secrets.
  fs.writeFileSync(path.join(root, 'data', 'projects', project.id, '.env'), 'SHOULD_NOT_EXPORT=1');
  const exportedZipResponse = await fetch(`${base}/api/projects/${project.id}/archive.zip`);
  assert.equal(exportedZipResponse.status, 200); assert.match(exportedZipResponse.headers.get('content-type'), /application\/zip/);
  const exportedEntries = parseZip(Buffer.from(await exportedZipResponse.arrayBuffer()));
  const exportedPaths = new Set(exportedEntries.map(entry => entry.name));
  assert.equal(exportedPaths.has('src/index.js'), true); assert.equal(exportedPaths.has('assets/test.png'), true);
  assert.equal(exportedPaths.has('.env'), false); assert.equal(exportedPaths.has('.arena-project.json'), false);
  assert.deepEqual(exportedEntries.find(entry => entry.name === 'assets/test.png').data, imageBytes);

  const incomingZip = makeZip([{ name: 'src/main.js', data: Buffer.from('console.log("from zip")\n') }, { name: 'assets/bytes.bin', data: Buffer.from([0, 1, 2, 255]) }]);
  const importedResponse = await fetch(`${base}/api/projects/import-zip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Imported ZIP', archive: incomingZip.toString('base64') }) });
  assert.equal(importedResponse.status, 201); const imported = await importedResponse.json(); importedProjectId = imported.project.id; assert.equal(imported.importedFiles, 2);
  const importedText = await fetch(`${base}/api/projects/${importedProjectId}/file?path=${encodeURIComponent('src/main.js')}`); assert.equal((await importedText.json()).content, 'console.log("from zip")\n');
  const importedBinary = await fetch(`${base}/api/projects/${importedProjectId}/file?path=${encodeURIComponent('assets/bytes.bin')}`); const importedBinaryData = await importedBinary.json(); assert.deepEqual(Buffer.from(importedBinaryData.content, 'base64'), Buffer.from([0, 1, 2, 255]));
  const secretZip = makeZip([{ name: '.env', data: Buffer.from('TOKEN=not-imported') }]);
  const rejectedSecret = await fetch(`${base}/api/projects/import-zip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Bad ZIP', archive: secretZip.toString('base64') }) });
  assert.equal(rejectedSecret.status, 400); assert.match((await rejectedSecret.json()).error, /reserved|secrets/i);
  const invalidZip = await fetch(`${base}/api/projects/import-zip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Invalid ZIP', archive: Buffer.from('not a zip').toString('base64') }) });
  assert.equal(invalidZip.status, 400);

  const checkGood = await fetch(`${base}/api/projects/${project.id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'node-check', path: 'src/index.js' }) });
  assert.equal((await checkGood.json()).ok, true);
  await save('broken.js', 'const = ;');
  const checkBad = await fetch(`${base}/api/projects/${project.id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'node-check', path: 'broken.js' }) });
  assert.equal((await checkBad.json()).ok, false);

  await save('config.json', '{\"enabled\":true}');
  const jsonGood = await fetch(`${base}/api/projects/${project.id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'json-check', path: 'config.json' }) });
  assert.equal((await jsonGood.json()).ok, true);
  await save('config.json', '{\"enabled\":}');
  const jsonBad = await fetch(`${base}/api/projects/${project.id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'json-check', path: 'config.json' }) });
  assert.equal((await jsonBad.json()).ok, false);
  await save('src/main.py', 'def answer():\n    return 42\n');
  const pythonGood = await fetch(`${base}/api/projects/${project.id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'python-check', path: 'src/main.py' }) });
  const pythonGoodData = await pythonGood.json(); assert.equal(pythonGoodData.ok, true, JSON.stringify(pythonGoodData));
  await save('src/broken.py', 'def broken(:\n    pass\n');
  const pythonBad = await fetch(`${base}/api/projects/${project.id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'python-check', path: 'src/broken.py' }) });
  assert.equal((await pythonBad.json()).ok, false);

  await save('package.json', JSON.stringify({ name: 'test-fixture', private: true, scripts: { test: "node -e \"console.log('fixture tests passed')\"" } }));
  const run = await fetch(`${base}/api/projects/${project.id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'npm-test' }) });
  const runData = await run.json(); assert.equal(run.status, 200); assert.equal(runData.ok, true, `${runData.stderr}\n${logs}`); assert.match(runData.stdout, /fixture tests passed/);

  // Start a localhost-only fixture app, verify its response, then stop it cleanly.
  await save('package.json', JSON.stringify({ name: 'test-fixture', private: true, scripts: { test: "node -e \"console.log('fixture tests passed')\"", dev: 'node dev.js' } }));
  await save('dev.js', "const http=require('node:http'); const server=http.createServer((_req,res)=>{res.end('arena fixture ok')}); server.listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('DEV_SERVER_READY'));\n");
  const refusedScript = await fetch(`${base}/api/projects/${project.id}/process`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', script: 'postinstall' }) });
  assert.equal(refusedScript.status, 400);
  const startProcessResponse = await fetch(`${base}/api/projects/${project.id}/process`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', script: 'dev' }) });
  const started = await startProcessResponse.json(); assert.equal(startProcessResponse.status, 202, JSON.stringify(started));
  const managed = (await fetch(`${base}/api/projects/${project.id}/process`)).ok;
  assert.equal(managed, true);
  const processInfo = started.process; let appResponse = null;
  for (let i = 0; i < 40; i++) {
    try { appResponse = await fetch(processInfo.url); if (appResponse.ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(appResponse && appResponse.ok, `dev server did not become ready; process=${JSON.stringify((await (await fetch(`${base}/api/projects/${project.id}/process`)).json()).processes)}`);
  assert.equal(await appResponse.text(), 'arena fixture ok');
  const stopProcessResponse = await fetch(`${base}/api/projects/${project.id}/process`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop', processId: processInfo.id }) });
  assert.equal(stopProcessResponse.status, 202);
  let stopped = false;
  for (let i = 0; i < 30; i++) {
    const list = await (await fetch(`${base}/api/projects/${project.id}/process`)).json();
    const item = list.processes.find(p => p.id === processInfo.id);
    if (item && item.status === 'stopped') { stopped = true; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(stopped, true, 'Managed project process should stop and report its final state.');

  const messages = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }) });
  const messagesData = await messages.json(); assert.equal(messagesData.demo, true, JSON.stringify(messagesData));
});


test('server-side AI proxy keeps provider credentials private and uses configured model IDs', async t => {
  let received = null;
  const provider = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = { url: req.url, authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'mock provider response' } }] }));
  });
  await new Promise((resolve, reject) => provider.once('error', reject).listen(0, '127.0.0.1', resolve));
  const providerPort = provider.address().port;
  const port = await freePort(); base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), AI_API_KEY: 'unit-test-secret', AI_BASE_URL: `http://127.0.0.1:${providerPort}/v1`, AI_MODELS: 'test/model-a,test/model-b' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', c => logs += c); child.stderr.on('data', c => logs += c);
  t.after(async () => {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([new Promise(r => child.once('exit', r)), new Promise(r => setTimeout(r, 2000))]); }
    await new Promise(resolve => provider.close(resolve));
  });
  await waitReady();
  const status = await (await fetch(`${base}/api/status`)).json();
  assert.equal(status.demo, false); assert.equal(status.providerConfigured, true);
  assert.deepEqual(status.models, ['test/model-a', 'test/model-b']);
  assert.equal(JSON.stringify(status).includes('unit-test-secret'), false, 'Provider key must never be returned by status');
  const result = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'test/model-b', messages: [{ role: 'user', content: 'Say hello' }] }) });
  const data = await result.json();
  assert.equal(result.status, 200, logs); assert.equal(data.text, 'mock provider response'); assert.equal(data.model, 'test/model-b');
  assert.equal(received.url, '/v1/chat/completions'); assert.equal(received.authorization, 'Bearer unit-test-secret');
  assert.equal(received.body.model, 'test/model-b'); assert.equal(received.body.messages.at(-1).content, 'Say hello');
});


test('optional Docker test backend uses a disposable copy and restrictive run flags', { skip: process.platform === 'win32' }, async t => {
  const fakeDocker = path.join(os.tmpdir(), `arena-fake-docker-${crypto.randomUUID()}.js`);
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === 'image' && args[1] === 'inspect') { process.stdout.write('mock image available\\n'); process.exit(0); }
if (args[0] === 'rm') { process.stdout.write('mock cleanup\\n'); process.exit(0); }
if (args[0] === 'run') {
  const mi = args.indexOf('--mount');
  const mount = mi >= 0 ? args[mi + 1] : '';
  const match = mount.match(/(?:^|,)source=([^,]+)(?:,|$)/);
  if (!match) { process.stderr.write('missing bind mount'); process.exit(2); }
  const source = match[1];
  if (!fs.existsSync(path.join(source, 'package.json'))) { process.stderr.write('project copy missing package.json'); process.exit(3); }
  fs.writeFileSync(path.join(source, 'mock-container-marker.txt'), 'written only to disposable copy');
  const required = ['--network=none', '--read-only', '--cap-drop=ALL', '--memory=768m', '--pids-limit=128'];
  const missing = required.filter(flag => !args.includes(flag));
  if (missing.length) { process.stderr.write('missing restrictions: ' + missing.join(',')); process.exit(4); }
  process.stdout.write('MOCK_DOCKER_SANDBOX=' + source + '\\nMOCK_RESTRICTIONS_OK\\n'); process.exit(0);
}
process.stderr.write('unexpected docker args: ' + args.join(' ')); process.exit(5);
`;
  fs.writeFileSync(fakeDocker, script, { mode: 0o700 });
  fs.chmodSync(fakeDocker, 0o700);
  const port = await freePort(); base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), AI_API_KEY: '', ARENA_EXECUTION_BACKEND: 'docker', ARENA_DOCKER_BIN: fakeDocker, ARENA_DOCKER_IMAGE: 'mock/node-test-image' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', c => logs += c); child.stderr.on('data', c => logs += c);
  let projectId;
  t.after(async () => {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([new Promise(r => child.once('exit', r)), new Promise(r => setTimeout(r, 2000))]); }
    if (projectId) { fs.rmSync(path.join(root, 'data', 'projects', projectId), { recursive: true, force: true }); fs.rmSync(path.join(root, 'data', 'history', projectId), { recursive: true, force: true }); }
    fs.rmSync(fakeDocker, { force: true });
  });
  await waitReady();
  const status = await (await fetch(`${base}/api/status`)).json();
  assert.equal(status.executionBackend, 'docker');
  const created = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Docker Backend Test' }) });
  assert.equal(created.status, 201); projectId = (await created.json()).project.id;
  const save = await fetch(`${base}/api/projects/${projectId}/file`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'package.json', content: JSON.stringify({ name: 'sandbox-fixture', private: true, scripts: { test: 'echo should-not-be-run-by-fake-docker' } }) }) });
  assert.equal(save.status, 200);
  const run = await fetch(`${base}/api/projects/${projectId}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'npm-test' }) });
  const result = await run.json();
  assert.equal(run.status, 200, logs); assert.equal(result.ok, true, result.stderr); assert.equal(result.backend, 'docker');
  assert.match(result.stdout, /MOCK_RESTRICTIONS_OK/);
  const sandbox = result.stdout.match(/MOCK_DOCKER_SANDBOX=([^\r\n]+)/)?.[1];
  assert.ok(sandbox && path.resolve(sandbox).startsWith(path.resolve(root, 'data', 'exec') + path.sep), `Sandbox should be a temporary copy under data/exec, got ${sandbox}`);
  assert.equal(fs.existsSync(path.join(sandbox, 'mock-container-marker.txt')), false, 'Disposable workspace should be removed after completion');
  const markerInProject = await fetch(`${base}/api/projects/${projectId}/file?path=mock-container-marker.txt`);
  assert.equal(markerInProject.status, 404, 'Writes inside the disposable test workspace must not modify the user project');
});
