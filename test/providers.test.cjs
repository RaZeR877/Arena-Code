'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const providers=require('../ai-providers.cjs');const bridge=require('../public/cloud-bridge.js');
const messages=[{role:'system',content:'Act as an expert coder'},{role:'user',content:'What is a closure?'}];
const credentials={OPENAI_API_KEY:'test-not-real',ANTHROPIC_API_KEY:'test-not-real',GEMINI_API_KEY:'test-not-real',OPENROUTER_API_KEY:'test-not-real',GROQ_API_KEY:'test-not-real',DEEPSEEK_API_KEY:'test-not-real',VYNQODE_ENABLE_OLLAMA:'1',VYNQODE_CUSTOM_API_KEY:'test-not-real',VYNQODE_CUSTOM_API_BASE_URL:'https://proxy.example.com/v1/'};
test('all eight API providers appear without exposing credentials',()=>{
 const list=providers.listProviders(credentials);assert.equal(list.length,8);
 for(const p of list){assert.equal(p.configured,true);assert.ok(p.models.length);assert.doesNotMatch(JSON.stringify(p),/test-not-real/);}
 assert.equal(providers.listProviders({}).filter(p=>p.configured).length,0);
});
test('request authentication and model selection are server-controlled',()=>{
 assert.throws(()=>providers.validateRequest({provider:'openai',model:'gpt-4.1-mini',messages},{}),/not configured/);
 assert.throws(()=>providers.validateRequest({provider:'openai',model:'../../../etc/passwd',messages},credentials),/allowed/);
 assert.throws(()=>providers.validateRequest({provider:'openai',model:'gpt-4.1-mini',messages:[{role:'user',content:'x'.repeat(50000)}]},credentials),/Invalid message/);
 assert.throws(()=>providers.validateRequest({provider:'openai',model:'gpt-4.1-mini',messages:Array.from({length:30},()=>messages[1])},credentials),/1–24/);
 assert.deepEqual(providers.configuredModels('openai',{...credentials,VYNQODE_OPENAI_MODELS:'gpt-5-mini,gpt-4.1-mini'}),['gpt-5-mini','gpt-4.1-mini']);
 assert.equal(providers.secureCustomEndpoint('http://example.com/v1/'),null);
 assert.equal(providers.secureCustomEndpoint('https://user:pass@example.com/v1/'),null);
 assert.equal(providers.secureCustomEndpoint('https://example.com/v1/'),'https://example.com/v1/chat/completions');
});
test('OpenAI-compatible, Anthropic and Gemini requests use correct formats',()=>{
 const openai=providers.makeRequest({provider:'openai',model:'gpt-4.1-mini',messages},credentials);
 assert.match(openai.url,/api\.openai\.com/);assert.equal(openai.headers.Authorization,'Bearer test-not-real');assert.ok(openai.body.max_completion_tokens);
 const anthropic=providers.makeRequest({provider:'anthropic',model:'claude-sonnet-4-5',messages},credentials);
 assert.equal(anthropic.body.system,messages[0].content);assert.equal(anthropic.body.messages.length,1);assert.ok(anthropic.headers['anthropic-version']);
 const gemini=providers.makeRequest({provider:'gemini',model:'gemini-2.5-flash',messages},credentials);
 assert.equal(gemini.headers['x-goog-api-key'],'test-not-real');assert.equal(gemini.body.contents[0].role,'user');assert.equal(gemini.body.systemInstruction.parts[0].text,messages[0].content);
 const ollama=providers.makeRequest({provider:'ollama',model:'qwen2.5-coder:7b',messages},credentials);
 assert.match(ollama.url,/127\.0\.0\.1:11434/);assert.equal(ollama.headers.Authorization,undefined);
});
test('provider text extraction handles each response schema',()=>{
 assert.equal(providers.extractText('openai',{choices:[{message:{content:'OpenAI works'}}]}),'OpenAI works');
 assert.equal(providers.extractText('anthropic',{content:[{type:'text',text:'Claude works'}]}),'Claude works');
 assert.equal(providers.extractText('gemini',{candidates:[{content:{parts:[{text:'Gemini works'}]}}]}),'Gemini works');
});
test('live connector mock returns actual inference text; never sends credentials from browser',async()=>{
 let sent;
 const fetcher=async(url,options)=>{sent={url,options};return new Response(JSON.stringify({text:'const result = true;'}),{status:200,headers:{'Content-Type':'application/json'}})};
 const engine=bridge.makeEngine('openai','gpt-4.1-mini',fetcher);
 const result=await engine.chat.completions.create({messages});
 assert.equal(result.choices[0].message.content,'const result = true;');
 assert.match(sent.url,/^\.\/api\/ide\/complete$/);
 assert.deepEqual(JSON.parse(sent.options.body),{provider:'openai',model:'gpt-4.1-mini',messages});
 assert.doesNotMatch(JSON.stringify(sent),/Authorization|apiKey/);
});
test('mock provider calls never hit real services and accept genuine provider-format responses',async()=>{
 const seen=[];
 for(const [id,model,output] of [['openai','gpt-4.1-mini',{choices:[{message:{content:'Hi'}}]}],['anthropic','claude-sonnet-4-5',{content:[{type:'text',text:'Hi'}]}],['gemini','gemini-2.5-flash',{candidates:[{content:{parts:[{text:'Hi'}]}}]}]]){
  const result=await providers.complete({provider:id,model,messages},{env:credentials,fetcher:async(url,req)=>{seen.push({url,req});return new Response(JSON.stringify(output),{status:200});}});
  assert.equal(result.text,'Hi');
 }
 assert.equal(seen.length,3);
});
