'use strict';
/* Repeatable model-in-the-loop evaluation. Requires a running local Arena server, a real model provider,
 * and the Docker execution backend. Benchmark contract files are immutable and hashed before/after. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.ARENA_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const MAX_STEPS = 18;
function loadFixture(id) {
  const dir = path.join(__dirname, 'fixtures', id); const files = {};
  function walk(current, rel = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name); const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, child); else if (entry.isFile()) files[child] = fs.readFileSync(abs, 'utf8');
    }
  }
  walk(dir); return files;
}
const SUITE = [
  { id:'calculator-zero-division', title:'Fix calculator zero division', prompt:'Inspect the calculator module and contract test. Fix division by zero so it throws a clear RangeError. Keep the existing exports and behavior for valid arithmetic. Run the test suite and repair any failures.', files:loadFixture('calculator-zero-division'), immutable:['test/contract.test.cjs'] },
  { id:'slugify-multifile', title:'Repair slugify in a multi-file project', prompt:'Fix src/slugify.js so slugify handles accents, punctuation, repeated whitespace, empty strings, and leading/trailing separators. It must return lowercase ASCII kebab-case. Preserve the exported function name. Run the contract tests. Do not change the tests.', files:loadFixture('slugify-multifile'), immutable:['test/contract.test.cjs'] },
  { id:'typed-config', title:'Implement a robust multi-file configuration loader', prompt:'Implement src/config.js loadConfig(env, defaults). It must parse integer PORT with a safe fallback, parse DEBUG as a boolean (true/false case-insensitively), preserve other default keys, and never mutate the defaults object. The app entry point already imports this function. Run tests; do not change test/contract.test.cjs.', files:loadFixture('typed-config'), immutable:['test/contract.test.cjs'] },
  { id:'csv-parser', title:'Implement a CSV parser for quoted fields', prompt:'Implement src/csv.js parseCsv(text) and preserve the export. It must support commas inside double-quoted fields, escaped quotes (two double-quote characters), CRLF, headers, and quoted fields containing newlines. Return an array of objects keyed by the header row. Trim a trailing final newline, and reject mismatched column counts with an informative Error. Run tests; do not edit the contract test.', files:loadFixture('csv-parser'), immutable:['test/contract.test.cjs'] },
  { id:'fetch-json-retry', title:'Implement a retry policy across API client modules', prompt:'Implement src/retry.js and src/api-client.js as a robust multi-file retry flow. retry(operation, options) must support maxAttempts (total attempts, default 3), delayMs (default 0), optional shouldRetry(error), and optional sleep(ms) injection for tests; it must return the first successful value, stop at the attempt limit, and rethrow the last error. fetchJson(fetcher, url, options) must use retry to repeat network errors and HTTP 5xx responses only, not retry 4xx responses, pass options.fetchOptions to fetcher, return response.json() on success, and give an informative HTTP status error on failure. Do not mutate input options or change the contract test. Run tests.', files:loadFixture('fetch-json-retry'), immutable:['test/contract.test.cjs'] }
];
function digest(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
async function api(route, options = {}) {
  const response = await fetch(`${BASE}${route}`, { ...options, headers: { ...(options.body ? { 'Content-Type':'application/json' } : {}), ...(options.headers || {}) } });
  const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = { text: text.slice(0,1000) }; }
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${route} → ${response.status}: ${data.error || text.slice(0,300)}`);
  return data;
}
function parseAction(text) { const s=String(text).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''); const a=s.indexOf('{'),b=s.lastIndexOf('}'); if(a<0||b<=a)throw new Error('Model returned no JSON action'); const value=JSON.parse(s.slice(a,b+1)); if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid model action'); return value; }
async function modelStep(model,messages) { const r=await api('/api/chat',{method:'POST',body:JSON.stringify({model,messages})}); if(r.demo||!r.text)throw new Error('Configured model did not return real model text'); return r.text; }
async function readFile(id,p) { return api(`/api/projects/${id}/file?path=${encodeURIComponent(p)}`); }
async function agentAction(id, action) {
  const getFiles=async()=> (await api(`/api/projects/${id}/files`)).files.filter(f=>f.type==='file'&&f.path!=='.arena-project.json');
  if(action.tool==='list_files')return {ok:true,files:await getFiles()};
  if(action.tool==='read_file'){const f=await readFile(id,action.path);return {ok:true,path:f.path,content:f.encoding==='utf8'?f.content:`[binary ${f.size} bytes]`};}
  if(action.tool==='search_files'){const files=await getFiles(),out=[];for(const f of files){if(f.size>150000)continue;const d=await readFile(id,f.path);if(d.encoding!=='utf8')continue;d.content.split('\n').forEach((line,i)=>{if(line.toLowerCase().includes(String(action.query||'').toLowerCase())&&out.length<30)out.push({path:f.path,line:i+1,text:line.slice(0,250)});});}return {ok:true,matches:out};}
  if(action.tool==='write_file'){if(typeof action.path!=='string'||typeof action.content!=='string'||action.content.length>200000)throw new Error('Invalid or oversized write_file action');await api(`/api/projects/${id}/file`,{method:'PUT',body:JSON.stringify({path:action.path,content:action.content})});return {ok:true,path:action.path};}
  if(action.tool==='patch_file'){const d=await readFile(id,action.path);if(d.encoding!=='utf8')throw new Error('Cannot patch binary file');const find=String(action.find||'');if(!find)throw new Error('Patch find text is empty');const at=d.content.indexOf(find);if(at<0||d.content.indexOf(find,at+find.length)>=0)throw new Error('Patch context must occur exactly once');const content=d.content.slice(0,at)+String(action.replace??'')+d.content.slice(at+find.length);await api(`/api/projects/${id}/file`,{method:'PUT',body:JSON.stringify({path:action.path,content})});return {ok:true,path:action.path};}
  if(action.tool==='delete_file'){await api(`/api/projects/${id}/file?path=${encodeURIComponent(action.path)}`,{method:'DELETE'});return {ok:true,path:action.path};}
  if(action.tool==='node_check'||action.tool==='json_check'||action.tool==='python_check'){const actionMap={node_check:'node-check',json_check:'json-check',python_check:'python-check'};const r=await api(`/api/projects/${id}/run`,{method:'POST',body:JSON.stringify({action:actionMap[action.tool],path:action.path})});return {ok:r.ok,output:`${r.stdout||''}${r.stderr||''}`.slice(-4000)};}
  if(action.tool==='npm_test'){const r=await api(`/api/projects/${id}/run`,{method:'POST',body:JSON.stringify({action:'npm-test'})});return {ok:r.ok,output:`${r.stdout||''}${r.stderr||''}`.slice(-5000),timedOut:r.timedOut};}
  throw new Error(`Unsupported benchmark tool: ${action.tool}`);
}
async function createTaskProject(task) {
  const r=await api('/api/projects',{method:'POST',body:JSON.stringify({name:`Eval ${task.id}`})}); const id=r.project.id;
  try { for(const [p,content] of Object.entries(task.files)) await api(`/api/projects/${id}/file`,{method:'PUT',body:JSON.stringify({path:p,content})}); }
  catch(error){throw Object.assign(error,{projectId:id});}
  const immutable={}; for(const p of task.immutable) immutable[p]=digest((await readFile(id,p)).content);
  return {id,immutable};
}
async function runOne(task, model) {
  const begin=Date.now(); const result={id:task.id,title:task.title,model,steps:0,completed:false,testPassed:false,immutableTestsPreserved:true,error:null,events:[]};
  let projectId=null;
  try {
    const project=await createTaskProject(task); projectId=project.id; result.projectId=projectId;
    const before=await api(`/api/projects/${projectId}/run`,{method:'POST',body:JSON.stringify({action:'npm-test'})});
    result.baselineFailed=!before.ok;
    if(!result.baselineFailed) { result.error='Invalid benchmark: acceptance tests pass before agent changes.'; return result; }
    const taskPrompt=`PROJECT: Eval ${task.id}\nTASK: ${task.prompt}\n\nUse one strict JSON object per turn and no prose. Allowed tools: {"tool":"list_files"}, {"tool":"read_file","path":"relative/path"}, {"tool":"search_files","query":"text"}, {"tool":"write_file","path":"relative/path","content":"complete file","reason":"why"}, {"tool":"patch_file","path":"relative/path","find":"unique text","replace":"replacement","reason":"why"}, {"tool":"delete_file","path":"relative/path"}, {"tool":"node_check","path":"x.js"}, {"tool":"json_check","path":"x.json"}, {"tool":"python_check","path":"x.py"}, {"tool":"npm_test"}, {"done":true,"message":"honest summary"}. No shell access exists. Inspect first, make minimal multi-file changes, and run tests. Never edit files under test/; contract tests are immutable and any change invalidates the benchmark. Do not claim tests pass without test output. Finish within ${MAX_STEPS} actions.`;
    const messages=[{role:'system',content:'You are an autonomous coding agent evaluated on correctness, multi-file reasoning, and test results. Return one strict JSON object only. Do not modify contract tests or fake test outcomes.'},{role:'user',content:taskPrompt}];
    let finished=false;
    for(let step=1;step<=MAX_STEPS;step++) {
      result.steps=step;
      const raw=await modelStep(model,messages.length>12?[messages[0],messages[1],...messages.slice(-10)]:messages);
      messages.push({role:'assistant',content:raw});
      let action;
      try{action=parseAction(raw);}catch(e){messages.push({role:'user',content:`Tool result: ${e.message}. Return a valid JSON tool action.`});result.events.push({step,error:e.message});continue;}
      if(action.done===true){finished=true;result.completed=true;result.summary=String(action.message||'').slice(0,1000);break;}
      let toolResult;try{toolResult=await agentAction(projectId,action);}catch(e){toolResult={ok:false,error:String(e.message||e).slice(0,800)};}
      result.events.push({step,tool:action.tool,ok:Boolean(toolResult.ok),path:action.path||null});
      messages.push({role:'user',content:`Tool result for ${action.tool}: ${JSON.stringify(toolResult).slice(0,10000)}. Choose the next single action or finish.`});
    }
    const immutableAfter={}; for(const p of task.immutable) immutableAfter[p]=digest((await readFile(projectId,p)).content);
    result.immutableTestsPreserved=task.immutable.every(p=>project.immutable[p]===immutableAfter[p]);
    const check=await api(`/api/projects/${projectId}/run`,{method:'POST',body:JSON.stringify({action:'npm-test'})});
    result.testPassed=Boolean(check.ok); result.testOutput=`${check.stdout||''}${check.stderr||''}`.slice(-5000); result.score=(result.testPassed?70:0)+(result.completed?10:0)+(result.immutableTestsPreserved?20:0); result.pass=result.testPassed&&result.completed&&result.immutableTestsPreserved;
  } catch(error) { result.error=String(error.message||error).slice(0,1500); }
  finally { result.durationMs=Date.now()-begin; if(projectId){ const local=path.join(ROOT,'data','projects',projectId); try{const meta=JSON.parse(fs.readFileSync(path.join(local,'.arena-project.json'),'utf8'));if(meta.name===`Eval ${task.id}`)fs.rmSync(local,{recursive:true,force:true});}catch{} try{fs.rmSync(path.join(ROOT,'data','history',projectId),{recursive:true,force:true});}catch{} } }
  return result;
}
async function main() {
  if(process.argv.includes('--dry-run')) { console.log(`Arena multi-file benchmark suite: ${SUITE.length} tasks\n${SUITE.map((t,i)=>`${i+1}. ${t.id} — ${t.title} (${Object.keys(t.files).length} starter files; ${t.immutable.length} immutable contract test)`).join('\n')}\nModel execution requires AI_API_KEY and ARENA_EXECUTION_BACKEND=docker.`); return; }
  const status=await api('/api/status');
  if(!status.providerConfigured)throw new Error('No cloud provider configured. Set AI_API_KEY and AI_BASE_URL before running model-in-the-loop evaluation.');
  if(status.executionBackend!=='docker')throw new Error('Evaluation requires ARENA_EXECUTION_BACKEND=docker so task code runs in the isolated Docker backend.');
  const model=process.argv.find((arg,i)=>process.argv[i-1]==='--model')||status.models[0]; if(!status.models.includes(model))throw new Error(`Model ${model} is not in the server-configured AI_MODELS list.`);
  console.log(`Running ${SUITE.length} benchmark tasks on model ${model}. Results are quality measurements, not a universal model ranking.`);
  const results=[]; for(const task of SUITE){console.log(`\n[${task.id}] ${task.title}`);const r=await runOne(task,model);results.push(r);console.log(`${r.pass?'PASS':'FAIL'} · score ${r.score??0}/100 · ${r.steps} steps · ${(r.durationMs/1000||0).toFixed(1)}s${r.error?` · ${r.error}`:''}`);}
  const summary={createdAt:new Date().toISOString(),baseUrl:BASE,model,taskCount:results.length,passed:results.filter(r=>r.pass).length,averageScore:Math.round(results.reduce((n,r)=>n+(r.score||0),0)/results.length),results};
  const output=path.join(__dirname,'results','latest.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(summary,null,2));
  console.log(`\nSummary: ${summary.passed}/${summary.taskCount} passed · average ${summary.averageScore}/100\nResults: ${output}`);
  if(summary.passed!==summary.taskCount)process.exitCode=1;
}
main().catch(error=>{console.error(`Evaluation unavailable: ${error.message}`);process.exitCode=2;});
