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

test('reviewed replacement treats special text literally and reports complete file changes',()=>{
 const project={name:'replace',files:{'a.js':'Needle Needle','b.js':'needle'}};
 const result=index.replace(project,'needle','$&',false);assert.equal(result.count,3);assert.equal(result.changes[0].content,'$& $&');assert.equal(project.files['a.js'],'Needle Needle');
 assert.equal(index.replace(project,'Needle','x',true).count,2);assert.throws(()=>index.replace(project,'','x'));assert.throws(()=>index.replace({files:{'large.js':'x'.repeat(10000)}},'x','y'.repeat(10000)),/file limit/);
});
test('explicit context pins include complete files or fail before model request',async()=>{
 const project={name:'pins',files:{'app.js':'const app=1;','ignored.js':'const ignored=2;','large.js':'x'.repeat(3000),'package.json':'{"scripts":{"test":"node --test"}}'}};
 const context=ai.context(project,'explain','app.js',2000,['ignored.js']);assert.ok(context.included.includes('ignored.js'));assert.ok(context.text.includes('PROJECT OVERVIEW'));
 assert.throws(()=>ai.context(project,'explain','app.js',2000,['large.js']),/Pinned file exceeds/);
 let calls=0;await assert.rejects(()=>ai.propose({engine:{chat:{completions:{create:async()=>{calls++;return {choices:[{message:{content:'{"summary":"Missing context: src/config.js","changes":[]}'}}]};}}}},project,task:'fix',current:'app.js'}),error=>error.code==='MISSING_CONTEXT');assert.equal(calls,1);
});
