'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const python=['python3','python'].find(command=>spawnSync(command,['--version']).status===0);
test('native release gate rejects empty, skipped and incomplete coverage even with green unrelated tests',{skip:!python&&'Python is required for the Android result checker'},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vynqode-native-results-'));const report=path.join(dir,'TEST-fixture.xml');
 const run=()=>spawnSync(python,['scripts/verify-android-results.py','--results-dir',dir,'--min-tests','3','--required-class','NativeWorkflowTest','--required-class','DeviceStorageTest'],{encoding:'utf8'});
 try{
  assert.notEqual(run().status,0);
  fs.writeFileSync(report,'<testsuite tests="0" failures="0" errors="0" skipped="0"/>');assert.notEqual(run().status,0);
  fs.writeFileSync(report,'<testsuite tests="3" failures="0" errors="0" skipped="0"><testcase classname="Other"/></testsuite>');assert.notEqual(run().status,0);
  fs.writeFileSync(report,'<testsuite tests="3" failures="0" errors="0" skipped="0"><testcase classname="NativeWorkflowTest"/><testcase classname="DeviceStorageTest"/><testcase classname="DeviceStorageTest"/></testsuite>');assert.equal(run().status,0);
  fs.writeFileSync(report,'<testsuite tests="3" failures="0" errors="0" skipped="1"><testcase classname="NativeWorkflowTest"><skipped/></testcase><testcase classname="DeviceStorageTest"/></testsuite>');assert.notEqual(run().status,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
