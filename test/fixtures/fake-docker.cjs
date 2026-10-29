#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
const log = process.env.MOCK_DOCKER_LOG;
if (log) fs.appendFileSync(log, JSON.stringify(args) + '\n');
const mountAt = args.indexOf('--mount');
const mountSpec = mountAt >= 0 ? args[mountAt + 1] : '';
const mountMatch = mountSpec.match(/type=bind,src=(.*),dst=\/workspace(?:,|$)/);
const workspace = mountMatch && mountMatch[1];
const cmd = args.slice(Math.max(0, args.indexOf('node:22-alpine') + 1)).join(' ');
if (args[0] === 'run' && args.includes('--detach')) {
  process.stdout.write('mock-preview-container-id\n');
} else if (args[0] === 'exec' && args.some(x => x.startsWith('arena-prev-'))) {
  const requested=args[args.length-1];
  if(args.some(x=>x.includes('Sec-WebSocket-Key: '))){
    const key=args[args.length-2];
    const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    process.stdout.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    process.stdout.write(Buffer.concat([Buffer.from([0x81,13]),Buffer.from('mock-hmr-live')]));
    process.stdin.resume();
  }else if(args.some(x=>x.includes('ARENA_PREVIEW_V1'))){
    process.stdout.write('ARENA_PREVIEW_V1 '+JSON.stringify({status:200,type:'text/html; charset=utf-8'})+'\n');
    process.stdout.write(`<h1>Preview ${args[args.length-3]}</h1>`);
  }else{
    process.stdout.write(JSON.stringify({status:200,contentType:'text/html; charset=utf-8',content:Buffer.from(`<h1>Preview ${requested}</h1>`).toString('base64')})+'\n');
  }
} else if (args[0] === 'run' && args.includes('fake-python-lsp:latest')) {
  let buffered = Buffer.alloc(0);
  process.stdin.on('data', chunk => {
    buffered = Buffer.concat([buffered, chunk]);
    while (true) {
      const separator = buffered.indexOf('\r\n\r\n');
      if (separator < 0) break;
      const header = buffered.subarray(0, separator).toString('ascii');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) { process.stderr.write('Invalid fake LSP header\n'); process.exitCode = 2; process.stdin.destroy(); return; }
      const size = Number(match[1]);
      if (buffered.length < separator + 4 + size) break;
      let message;
      try { message = JSON.parse(buffered.subarray(separator + 4, separator + 4 + size).toString('utf8')); } catch {}
      buffered = buffered.subarray(separator + 4 + size);
      if (message && message.id != null) {
        const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { capabilities: { completionProvider: {} } } }));
        process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
        process.stdout.write(body);
      }
    }
  });
  process.stdin.resume();
} else {
  if (workspace && args.some(x => x.includes('npm install') || x === 'npm')) {
    if (args.join(' ').includes('npm install') || args.join(' ').includes('npm ci')) {
      fs.mkdirSync(path.join(workspace, 'node_modules', 'mock'), { recursive: true });
      fs.writeFileSync(path.join(workspace, 'node_modules', 'mock', 'index.js'), 'module.exports=1;');
    }
  }
  if (workspace && args.some(x => x.includes('pip install'))) {
    fs.mkdirSync(path.join(workspace, 'python-deps'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'python-deps', 'mock_dep.py'), 'VALUE=1');
  }
  process.stdout.write(`MOCK_DOCKER_OK ${cmd.slice(0, 120)}\n`);
}
