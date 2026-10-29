'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { promisify } = require('node:util');
const { scrypt } = require('node:crypto');
const { safeProjectPath, passwordHash, validateFileContent, listFiles, sha, parseCookies, quotaAllowed } = require('../hosted/hosted.cjs');
const scryptAsync = promisify(scrypt);

test('hosted workspace path policy excludes traversal and secrets', () => {
  assert.equal(safeProjectPath('src/index.ts'), 'src/index.ts');
  for (const p of ['../outside.js','/etc/passwd','C:\\secret.txt','.env','.env.production','.npmrc','private.pem','node_modules/pkg/index.js','.git/config']) assert.throws(() => safeProjectPath(p), undefined, p);
});
test('hosted workspace file validation preserves safe text and rejects oversized or invalid payloads', () => {
  const file = validateFileContent({content:'hello'}); assert.equal(file.encoding,'utf8'); assert.equal(file.size,5);
  assert.throws(() => validateFileContent({content:'x'.repeat(5*1024*1024+1)}), /exceeds/i);
  assert.throws(() => validateFileContent({encoding:'base64',content:'not base64!'}), /base64/i);
  const listing = listFiles({'src/index.ts':file}); assert.ok(listing.files.some(f=>f.path==='src'&&f.type==='directory')); assert.ok(listing.files.some(f=>f.path==='src/index.ts'&&f.type==='file'));
});
test('hosted account utilities hash passwords with per-user salts and parse cookie values', async () => {
  const {salt,hash}=await passwordHash('a-long-test-password'); const check=await scryptAsync('a-long-test-password',salt,64); const bad=await scryptAsync('wrong-password',salt,64);
  assert.equal(check.toString('hex'),hash); assert.notEqual(bad.toString('hex'),hash); assert.equal(sha('abc').length,64);
  assert.deepEqual(parseCookies('a=one; arena_session=two%20words'),{a:'one',arena_session:'two words'});
});

test('quota limits support finite caps and explicit unlimited mode', () => {
  assert.equal(quotaAllowed(0,1),true);
  assert.equal(quotaAllowed(1,1),false);
  assert.equal(quotaAllowed(10000,0),true);
});
