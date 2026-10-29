'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const c=require('../src/calculator');
test('valid arithmetic stays unchanged',()=>{assert.equal(c.add(2,3),5);assert.equal(c.subtract(7,4),3);assert.equal(c.multiply(3,4),12);assert.equal(c.divide(12,3),4)});
test('division by zero throws a useful RangeError',()=>{assert.throws(()=>c.divide(5,0),{name:'RangeError',message:/zero/i})});
