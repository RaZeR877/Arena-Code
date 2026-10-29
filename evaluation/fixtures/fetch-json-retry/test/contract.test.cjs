'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { retry } = require('../src/retry');
const { fetchJson } = require('../src/api-client');

test('retry retries transient operations up to maxAttempts and returns the successful result', async () => {
  let attempts = 0;
  const result = await retry(async () => { attempts++; if (attempts < 3) throw new Error('temporary'); return 'ready'; }, { maxAttempts: 3, delayMs: 0 });
  assert.equal(result, 'ready'); assert.equal(attempts, 3);
});

test('fetchJson retries transient server errors but does not retry permanent client errors', async () => {
  let calls = 0;
  const transient = await fetchJson(async () => { calls++; return calls < 3 ? { ok:false, status:503, json:async()=>({}) } : { ok:true, status:200, json:async()=>({id:7}) }; }, '/profile', { maxAttempts:3, delayMs:0 });
  assert.deepEqual(transient, { id:7 }); assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(fetchJson(async()=>{ calls++; return {ok:false,status:400,json:async()=>({})}; },'/profile',{maxAttempts:4,delayMs:0}), /HTTP 400/);
  assert.equal(calls, 1);
});

test('fetchJson propagates fetch options and does not mutate caller options', async () => {
  const options = { maxAttempts:1, delayMs:0, fetchOptions:{headers:{accept:'application/json'}} };
  const before = JSON.stringify(options); let received;
  const value = await fetchJson(async (_url, got) => { received = got; return {ok:true,status:200,json:async()=>({ok:true})}; }, '/x', options);
  assert.deepEqual(received, options.fetchOptions); assert.deepEqual(value,{ok:true}); assert.equal(JSON.stringify(options),before);
});
