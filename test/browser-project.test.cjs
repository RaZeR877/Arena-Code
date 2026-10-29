'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inflateRawSync } = require('node:zlib');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../pages/browser-core.js');

test('browser project enforces path, size, secret and file-conflict constraints', () => {
  const p = core.starter();
  assert.equal(Object.keys(p.files).length, 3);
  for (const path of ['../etc/shadow', 'src/../../root', '/etc/shadow', 'C:\\evil.js', '.env', 'keys/private.pem', 'node_modules/index.js', 'bad//file.js', 'file/../x.js', '.git/config']) assert.throws(() => core.safePath(path), undefined, path);
  assert.throws(() => core.update(p, [{ path: 'huge.txt', content: 'x'.repeat(core.MAX_FILE_BYTES + 1) }]), /400 KiB/);
  assert.throws(() => core.normalize({ files: { 'src': 'file', 'src/index.js': 'file' } }), /conflict/);
  assert.throws(() => core.update(p, [{ path: '.env', content: 'secret' }]), /Unsafe/);
});

test('multi-file changes preserve unrelated files and support atomic restore', () => {
  const before = core.starter();
  const after = core.update(before, [{ path: 'index.html', content: '<html><body>new</body></html>' }, { path: 'src/util.js', content: 'const value = 1;' }, { path: 'app.js', delete: true }]);
  assert.equal(after.files['index.html'], '<html><body>new</body></html>');
  assert.equal(after.files['src/util.js'], 'const value = 1;');
  assert.equal(after.files['app.js'], undefined);
  assert.equal(after.files['style.css'], before.files['style.css']);
  assert.equal(core.normalize(JSON.parse(JSON.stringify(before))).files['app.js'], before.files['app.js']);
});

test('ZIP roundtrip preserves multiple UTF-8 files and is compatible with Python zipfile', async () => {
  const project = core.update(core.starter(), [{ path: 'src/émoji.txt', content: 'こんにちは 🌎\n' }]);
  const bytes = core.zip(project);
  assert.equal(Buffer.from(bytes).subarray(0, 4).toString('hex'), '504b0304');
  const imported = await core.unzip(bytes);
  assert.deepEqual({ ...imported.files }, { ...project.files });
  const python = spawnSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-c', 'import sys,zipfile,io; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(" ".join(sorted(z.namelist())))'], { input: Buffer.from(bytes) });
  assert.equal(python.status, 0, String(python.stderr));
  assert.match(String(python.stdout), /src\/émoji\.txt/);
});

test('ZIP import handles standard deflate archives, validates checksum and rejects traversal', async () => {
  const p = core.starter();
  const source = core.zip(p);
  const corrupted = source.slice();
  corrupted[corrupted.indexOf(0x3c)] ^= 1;
  await assert.rejects(() => core.unzip(corrupted), /checksum/i);
  const python = spawnSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-c', 'import io,zipfile,sys; b=io.BytesIO(); z=zipfile.ZipFile(b,"w",compression=zipfile.ZIP_DEFLATED); z.writestr("index.html", "<html><body>from compressed zip</body></html>"); z.close(); sys.stdout.buffer.write(b.getvalue())'], { encoding: null });
  assert.equal(python.status, 0);
  const imported = await core.unzip(new Uint8Array(python.stdout), async compressed => new Uint8Array(inflateRawSync(compressed)));
  assert.match(imported.files['index.html'], /compressed zip/);
  const evil = spawnSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-c', 'import io,zipfile,sys; b=io.BytesIO(); z=zipfile.ZipFile(b,"w"); z.writestr("../evil.txt", "evil"); z.close(); sys.stdout.buffer.write(b.getvalue())'], { encoding: null });
  await assert.rejects(() => core.unzip(new Uint8Array(evil.stdout)), /Invalid|Unsafe/);
});

test('browser check reports parsing failures without executing code', () => {
  assert.equal(core.check('src/app.js', 'const a = ;').status, 'fail');
  assert.equal(core.check('src/app.js', 'throw new Error("would execute")').status, 'pass');
  assert.equal(core.check('src/app.mjs', 'import x from "./x.js"').status, 'unverified');
  assert.equal(core.check('data.json', '{bad').status, 'fail');
  assert.equal(core.check('data.json', '{"valid":true}').status, 'pass');
});

test('AI change schema rejects secret writes, duplicate paths, and edits over limits', () => {
  const p = core.starter();
  assert.throws(() => core.parseSuggestion('not json', p), /valid JSON/);
  assert.throws(() => core.parseSuggestion(JSON.stringify({ changes: [{ path: '.env', content: 'SECRET=1' }] }), p), /Unsafe/);
  assert.throws(() => core.parseSuggestion(JSON.stringify({ changes: [{ path: 'app.js', content: 'x' }, { path: 'app.js', content: 'y' }] }), p), /Repeated/);
  const edits = core.parseSuggestion('```json\n' + JSON.stringify({ summary: 'updated', changes: [{ path: 'src/new.js', content: 'const ok = true;' }, { path: 'index.html', content: '<html><body>hi</body></html>' }] }) + '\n```', p);
  assert.equal(edits.changes.length, 2);
  assert.equal(core.update(p, edits.changes).files['src/new.js'], 'const ok = true;');
});
