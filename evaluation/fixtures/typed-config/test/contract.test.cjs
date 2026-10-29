'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {loadConfig}=require('../src/config');const {createAppConfig}=require('../src/app');
test('parses supported environment values with typed values',()=>{assert.deepEqual(loadConfig({PORT:'3001',DEBUG:'TRUE'},{PORT:3000,DEBUG:false,NAME:'x'}),{PORT:3001,DEBUG:true,NAME:'x'})});
test('invalid values fall back without mutating defaults',()=>{const d={PORT:3000,DEBUG:false};assert.deepEqual(loadConfig({PORT:'not-a-port',DEBUG:'maybe'},d),d);assert.deepEqual(d,{PORT:3000,DEBUG:false})});
test('the application uses the loader across files',()=>{assert.deepEqual(createAppConfig({PORT:'8080',DEBUG:'true'}),{PORT:8080,DEBUG:true,APP_NAME:'Arena'})});
