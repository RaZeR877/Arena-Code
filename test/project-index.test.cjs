'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const index=require('../public/project-index.js');const ai=require('../public/ai-workflow.js');
test('dependency-aware context includes linked implementation and tests ahead of unrelated files',()=>{
 const project={name:'linked',files:{'src/main.js':"const sum=require('./sum');",'src/sum.js':'module.exports=(a,b)=>a+b;','test/main.test.cjs':"require('../src/main.js');",'unrelated.txt':'x'.repeat(5000)}};
 const graph=index.related(project,'src/main.js','repair behavior');assert.equal(graph.get('src/sum.js'),1);assert.equal(graph.get('test/main.test.cjs'),1);
 const context=ai.context(project,'repair behavior','src/main.js',2000);assert.ok(context.included.includes('src/sum.js'));assert.ok(context.included.includes('test/main.test.cjs'));assert.ok(context.truncated.includes('unrelated.txt'));
});
test('project search returns exact positions, literal matching and a bounded result set',()=>{
 const project={name:'search',files:{'a.js':'Needle\nneedle needle\n.*','b.js':'needle'}};
 const hits=index.search(project,'needle');assert.equal(hits.length,4);assert.deepEqual([hits[1].line,hits[1].column,hits[1].offset],[2,1,7]);assert.equal(index.search(project,'Needle',true).length,1);assert.equal(index.search(project,'.*').length,1);assert.equal(index.search({files:{'large.txt':'x '.repeat(1000)}},'x').length,200);
});
test('persisted review identity ignores timestamps and insertion order but detects source/name changes',()=>{
 const a={name:'a',files:{'z.js':'1','a.js':'2'},updatedAt:'old'},b={name:'a',files:{'a.js':'2','z.js':'1'},updatedAt:'new'};
 assert.equal(index.identity(a),index.identity(b));b.files['z.js']='3';assert.notEqual(index.identity(a),index.identity(b));
});
