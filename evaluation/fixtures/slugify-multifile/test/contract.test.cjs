'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {slugify}=require('../src/slugify');const {productUrl}=require('../src');
test('slugifies accents punctuation and spacing',()=>{assert.equal(slugify('  Crème brûlée & Tea!  '),'creme-brulee-tea')});
test('handles empty and separator-only strings',()=>{assert.equal(slugify(''),'');assert.equal(slugify(' --- !!! '),'')});
test('consumers get a stable route',()=>{assert.equal(productUrl('New   Café!',42),'/products/new-cafe-42')});
