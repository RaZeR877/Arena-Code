'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib');const guard=require('../public/git-pack-guard.js');
function sizeHeader(type,size){const bytes=[];let first=(type<<4)|(size&15);size=Math.floor(size/16);if(size)first|=128;bytes.push(first);while(size){let next=size&127;size=Math.floor(size/128);if(size)next|=128;bytes.push(next);}return Buffer.from(bytes);}
function object(data,declared=data.length,type=3){return Buffer.concat([sizeHeader(type,declared),...(type===7?[Buffer.alloc(20)]:[]),zlib.deflateSync(data)]);}
function pack(objects){const header=Buffer.alloc(12);header.write('PACK');header.writeUInt32BE(2,4);header.writeUInt32BE(objects.length,8);return Buffer.concat([header,...objects,Buffer.alloc(20)]);}
test('pack preflight accepts bounded Git blobs and sideband transport',()=>{
 const value=pack([object(Buffer.from('module.exports=1;'))]);guard.verify(value);
 const payload=Buffer.concat([Buffer.from([1]),value]);const packet=Buffer.concat([Buffer.from((payload.length+4).toString(16).padStart(4,'0')),payload,Buffer.from('0000')]);guard.verify(packet);
});
test('pack preflight rejects oversized declarations, decompression bombs and expanded deltas',()=>{
 assert.throws(()=>guard.verify(pack([object(Buffer.from('x'),600000)])),/limits/);
 assert.throws(()=>guard.verify(pack([object(Buffer.alloc(1024*1024),1)])),/Inflated/);
 const delta=Buffer.from([1,255,255,127]);assert.throws(()=>guard.verify(pack([object(delta,delta.length,7)])),/Reconstructed/);
 assert.throws(()=>guard.verify(pack([object(Buffer.from('x'))]).subarray(0,-2)),/trailing|Truncated|Invalid/);
});
