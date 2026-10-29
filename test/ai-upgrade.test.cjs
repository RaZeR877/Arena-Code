'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../pages/browser-core.js');
const ai = require('../pages/ai-workflow.js');
const catalog = require('../public/model-catalog.js');

test('WebLLM catalog is based on real runtime records and recommends coding models without inventing IDs', () => {
  const list = catalog.availableModels([
    {model_id:'Qwen2.5-0.5B-Instruct-q4f16_1-MLC'},
    {model_id:'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC'},
    {model_id:'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC'},
    {model_id:'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC'},
    {model_id:'Other-32B-Instruct-q4f32_1-MLC'},
    {model_id:'Not-A-Real-Model'}
  ]);
  assert.equal(list.length, 3);
  assert.equal(catalog.sizeBillions(list[1].id), 1.5);
  assert.equal(catalog.recommended(list), 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC');
  assert.equal(catalog.recommended(list, list[2].id), list[2].id);
  assert.equal(catalog.recommended(list, 'invalid-id'), list[1].id);
  assert.match(list[2].tier, /High GPU memory/);
});

test('AI context ranks relevant source files, bounds context, and reports incomplete files', () => {
  const project = core.normalize({ name:'context', files:{
    'index.html':'<html><body>Good</body></html>',
    'app.js':'const unrelated = 2;',
    'src/shopping-cart.js':'export const cartTotal = () => 0;',
    'src/data-large.js':'export default "' + 'z'.repeat(18000) + '";',
    'README.md':'How to use this project.'
  }});
  const ctx = ai.context(project, 'Fix shopping cart total logic', 'src/shopping-cart.js', 4000);
  assert.ok(ctx.included.includes('src/shopping-cart.js'));
  assert.ok(ctx.text.includes('shopping-cart.js'));
  assert.ok(ctx.text.length <= 4000);
  assert.ok(ctx.truncated.length || ctx.omitted.length);
  assert.ok(!ctx.text.includes('z'.repeat(4000)));
});

test('AI proposal retries syntax-invalid output, returns validated edits without modifying project', async () => {
  const p = core.starter(); let n = 0; const messages = [];
  const engine = {chat:{completions:{create: async ({messages:m}) => {
    messages.push(m); n++;
    const content = n === 1 ? JSON.stringify({summary:'broken',changes:[{path:'app.js',content:'const = ;'}]})
      : JSON.stringify({summary:'fixed',changes:[{path:'app.js',content:'const healthy = 1;'},{path:'style.css',content:'body { color: green; }'}]});
    return {choices:[{message:{content}}]};
  }}}};
  const result = await ai.propose({engine, project:p,task:'Fix app.js and style.css',current:'app.js'});
  assert.equal(n, 2);assert.equal(result.attempts,2);
  assert.equal(result.checks.failures.length,0);
  assert.equal(result.proposal.changes.length,2);
  assert.ok(messages[1].some(m=>m.content?.includes('RETRY:')));
  assert.match(p.files['app.js'], /document.querySelector/);
});

test('AI proposals cannot overwrite a file excluded from full model context', async () => {
  const p = core.normalize({files:{'target.js':'const initial = true;','huge.js':'x'.repeat(37000)}});
  const engine = {chat:{completions:{create:async()=>({choices:[{message:{content:JSON.stringify({summary:'change',changes:[{path:'huge.js',content:'const hacked = 1;'}]})}}]})}}};
  await assert.rejects(()=>ai.propose({engine,project:p,task:'fix target.js',current:'target.js',contextLimit:2800}),/outside complete context/);
  assert.equal(p.files['huge.js'].length,37000);
});

test('AI refuses repeated malformed responses; no edits applied', async () => {
  const p=core.starter();const engine={chat:{completions:{create:async()=>({choices:[{message:{content:'Not JSON'}}]})}}};
  await assert.rejects(()=>ai.propose({engine,project:p,task:'edit app.js',current:'app.js'}),/two attempts/);
  assert.match(p.files['app.js'],/document.querySelector/);
});

test('real-model structural evaluation harness can report honest pass/fail without executing proposals', async () => {
  let calls=0;
  const engine={chat:{completions:{create:async()=>{
    const first=++calls===1;
    const changes=first?[{path:'index.html',content:'<html><body><div id="arenaBadge">ok</div></body></html>'},{path:'app.js',content:'document.querySelector("#arenaBadge");'}]:[{path:'style.css',content:'.status-good{color:green;}'},{path:'index.html',content:'<html><body><p class="status-good">yay</p></body></html>'}];
    return {choices:[{message:{content:JSON.stringify({summary:'test',changes})}}]};
  }}}};
  const report=await ai.evaluate(engine);
  assert.equal(calls,2);assert.equal(report.total,2);assert.equal(report.score,2);
  assert.match(report.caveat,/No functional execution/);
  assert.ok(report.results.every(x=>x.passesStructuralChecks));
});
