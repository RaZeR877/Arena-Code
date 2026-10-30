import {newQuickJSWASMModuleFromVariant,newVariant} from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-wasmfile-release-sync';
let enginePromise;
async function engine(){return enginePromise ||= newQuickJSWASMModuleFromVariant(newVariant(variant,{wasmLocation:new URL('./quickjs.wasm',self.location.href).href}));}
function harness(files,entry,testing){return `(() => {
'use strict';
const files=${JSON.stringify(files)},entry=${JSON.stringify(entry)},testing=${JSON.stringify(testing)};
const compile=Function,parse=JSON.parse.bind(JSON),keys=Object.keys.bind(Object),same=Object.is.bind(Object),descriptor=Object.getOwnPropertyDescriptor.bind(Object);
const sort=Function.prototype.call.bind(Array.prototype.sort),clip=Function.prototype.call.bind(String.prototype.slice),primitiveString=String;
let assertions=0,testCount=0,failed=0,output='',logs=0;const cache=Object.create(null);
function log(...args){if(logs++>=100)return;output+=args.map(v=>v===null?'null':typeof v==='object'?'[object]':typeof v==='function'?'[function]':clip(primitiveString(v),0,2000)).join(' ')+'\\n';}
function error(message){throw Error(message||'Assertion failed');}
function equal(a,b,depth=0){if(same(a,b))return true;if(depth>40)error('Deep assertion nesting limit');if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return false;const ak=sort(keys(a)),bk=sort(keys(b));if(ak.length!==bk.length)return false;for(let i=0;i<ak.length;i++){if(ak[i]!==bk[i])return false;const ad=descriptor(a,ak[i]),bd=descriptor(b,bk[i]);if(!('value'in ad)||!('value'in bd))error('Accessor properties are unsupported in deep assertions');if(!equal(ad.value,bd.value,depth+1))return false;}return true;}
function assert(value,message){assertions++;if(!value)error(message);}
assert.ok=assert;assert.equal=assert.strictEqual=(a,b,message)=>{assertions++;if(!same(a,b))error(message||'Expected strict equality');};
assert.notEqual=assert.notStrictEqual=(a,b,message)=>{assertions++;if(same(a,b))error(message||'Expected unequal values');};
assert.deepEqual=assert.deepStrictEqual=(a,b,message)=>{assertions++;if(!equal(a,b))error(message||'Expected equal structures');};
assert.throws=(fn,expected)=>{assertions++;let caught,didThrow=false;try{fn();}catch(e){caught=e;didThrow=true;}if(!didThrow)error('Expected an exception');if(expected instanceof RegExp&&!expected.test(primitiveString(caught.message)))error('Exception did not match');else if(typeof expected==='function'&&!(caught instanceof expected))error('Wrong exception type');else if(expected&&typeof expected==='object'&&!(expected instanceof RegExp))for(const key of keys(expected)){if(expected[key] instanceof RegExp){if(!expected[key].test(primitiveString(caught[key])))error('Exception property did not match');}else if(!same(caught[key],expected[key]))error('Exception property did not match');}};Object.freeze(assert);
function test(name,fn){if(typeof fn!=='function')error('Only synchronous test(name, fn) is supported');testCount++;try{const result=fn();if(result&&typeof result.then==='function')error('Async tests are unsupported in this JavaScript runtime');log('PASS',name);}catch(e){failed++;log('FAIL',name,e.message);}}
const console=Object.freeze({log,warn:log,error:log,info:log});
function resolve(name,parent){if(!name.startsWith('.'))error('Only project-relative modules and assert/node:test are supported');const parts=parent.split('/');parts.pop();for(const piece of name.split('/')){if(piece==='.'||!piece)continue;if(piece==='..'){if(!parts.length)error('Module path escapes project');parts.pop();}else parts.push(piece);}const path=parts.join('/');for(const candidate of [path,path+'.js',path+'.cjs',path+'.json',path+'/index.js'])if(Object.hasOwn(files,candidate))return candidate;error('Module not found: '+name);}
function load(path){if(cache[path])return cache[path].exports;const module={exports:{}};cache[path]=module;
const require=name=>name==='assert'||name==='assert/strict'||name==='node:assert/strict'||name==='node:assert'?assert:name==='node:test'?Object.freeze({test}):load(resolve(name,path));
if(path.endsWith('.json'))module.exports=parse(files[path]);else{const fn=compile('module','exports','require','console',files[path]);fn(module,module.exports,require,console);}return module.exports;}
try{load(entry);if(testing&&assertions===0)error('No assertions executed. Select a synchronous test file.');}catch(caught){failed++;log('ERROR',caught.message);}
return {ok:failed===0,assertions,tests:testCount,output};
})()`;}
self.onmessage=async({data})=>{
 let runtime,context;
 try{
  const QuickJS=await engine();runtime=QuickJS.newRuntime();runtime.setMemoryLimit(32*1024*1024);runtime.setMaxStackSize(512*1024);
  const deadline=Date.now()+2000;runtime.setInterruptHandler(()=>Date.now()>deadline);context=runtime.newContext();
  if(!data.files||Object.keys(data.files).length>100||typeof data.entry!=='string'||!Object.hasOwn(data.files,data.entry))throw Error('Select a project JavaScript entry');
  if(Object.values(data.files).some(text=>typeof text!=='string'||text.length>409600)||JSON.stringify(data.files).length>4*1024*1024)throw Error('Project exceeds playground limits');
  const result=context.evalCode(harness(data.files,data.entry,Boolean(data.testing)),'vynqode-playground.js');
  if(result.error){let message='Execution failed';try{message=context.getProp(result.error,'message').consume(value=>context.getString(value));}catch{}result.error.dispose();self.postMessage({ok:false,code:1,output:message,assertions:0,tests:0});}
  else{const value=result.value;const ok=context.getProp(value,'ok').consume(v=>context.dump(v));const assertions=context.getProp(value,'assertions').consume(v=>context.getNumber(v));const tests=context.getProp(value,'tests').consume(v=>context.getNumber(v));const output=context.getProp(value,'output').consume(v=>context.getString(v));value.dispose();self.postMessage({ok,code:ok?0:1,assertions,tests,output});}
 }catch(error){self.postMessage({ok:false,code:1,assertions:0,tests:0,output:String(error.message||error)});}
 finally{context?.dispose();runtime?.dispose();}
};
