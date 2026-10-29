'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {parseCsv}=require('../src/csv');
test('parses headers and commas inside quotes',()=>{assert.deepEqual(parseCsv('name,note\r\nAda,"hello, world"'),[{name:'Ada',note:'hello, world'}])});
test('unescapes doubled quotes and keeps quoted newlines',()=>{assert.deepEqual(parseCsv('name,note\nAda,"said ""hi""\nthere"'),[{name:'Ada',note:'said "hi"\nthere'}])});
test('rejects inconsistent row widths',()=>{assert.throws(()=>parseCsv('a,b\n1,2,3'),/column|field|width/i)});
