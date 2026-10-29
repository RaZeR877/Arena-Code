'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {makeZip,parseZip}=require('../zip-utils.cjs');
const {createPreviewManager,previewPath,previewPort,previewScript}=require('../runner/preview.cjs');
test('preview path and script inputs are strictly bounded',()=>{
  assert.equal(previewPath('/main.js?mode=test'),'/main.js?mode=test');
  for(const entry of ['/../x','/%2e%2e/x','/%2Fsecret','/hello\\bad','/a/./b','a#frag','a\0b'])assert.throws(()=>previewPath(entry),undefined,entry);
  assert.equal(previewPort(3000),3000);assert.equal(previewPort(null),4173);
  for(const port of [22,80,65535,-1,'abc',4174])assert.throws(()=>previewPort(port),/Preview port/);
  assert.equal(previewScript({scripts:{start:'node server.js'}},'start'),'start');
  assert.throws(()=>previewScript({scripts:{test:'node --test'}},'test'));
  assert.throws(()=>previewScript({scripts:{start:''}},'start'));
});
test('isolated preview manager enforces capacity, TTL, cleanup and bounded binary responses',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arena-preview-unit-'));
  const calls=[];let nextContent='normal';
  const runDocker=async(args)=>{
    calls.push(args);
    if(args[0]==='exec'){
      if(nextContent==='huge')return {code:0,stdout:JSON.stringify({status:200,content:Buffer.alloc(400*1024).toString('base64'),contentType:'text/html'})};
      if(nextContent==='missing')return {code:1,stdout:'',stderr:'not running'};
      return {code:0,stdout:JSON.stringify({status:200,content:Buffer.from('<h1>Hello</h1>').toString('base64'),contentType:'text/html'})};
    }
    return {code:0,stdout:'container-id\n',stderr:''};
  };
  const unpack=(archive,workspace)=>parseZip(Buffer.from(archive,'base64')).map(entry=>{
    const dest=path.join(workspace,entry.name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,entry.data);return entry;
  });
  const m=createPreviewManager({runDocker,unpack,fingerprint:()=> 'cache-test',data:dir,image:'node:22-alpine',maxSessions:1,ttlMs:80});
  try {
    const workspaceId=crypto.randomUUID();
    const archive=makeZip([{name:'package.json',data:Buffer.from('{"scripts":{"start":"node server.js"}}')},{name:'server.js',data:Buffer.from('') }]).toString('base64');
    await assert.rejects(m.start({workspaceId,script:'test',archive}),/Choose an existing/);
    assert.equal(m.list().length,0);
    const started=await m.start({workspaceId,script:'start',archive});
    const result=await m.content(started.id,workspaceId,'/index.html');
    assert.equal(result.status,200);assert.equal(result.buffer.toString(),'<h1>Hello</h1>');
    assert.equal(m.list().length,1);
    const flags=calls.find(args=>args[0]==='run');
    assert.ok(flags.includes('--network=none')&&flags.includes('--read-only')&&flags.includes('--cap-drop=ALL'));
    assert.ok(!flags.some(arg=>arg==='--publish'||arg==='-p'||arg==='--privileged'));
    await assert.rejects(m.content(started.id,crypto.randomUUID(),'/index.html'),/not found/);
    nextContent='huge';await assert.rejects(m.content(started.id,workspaceId,'/index.html'),/response limit/);
    nextContent='missing';await assert.rejects(m.content(started.id,workspaceId,'/index.html'),/not responding/);
    await new Promise(resolve=>setTimeout(resolve,100));
    await assert.rejects(m.content(started.id,workspaceId,'/index.html'),/expired/);
    assert.equal(m.list().length,0);
    assert.ok(calls.some(args=>args[0]==='rm'&&args[1]==='-f'));
    assert.equal(fs.readdirSync(dir).filter(s=>s.startsWith('preview-')).length,0);
  }finally{await m.close();fs.rmSync(dir,{recursive:true,force:true});}
});
