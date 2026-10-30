'use strict';
// Localhost-only, server-side AI credentials. Never copy this file or keys into Pages builds.
const PROVIDERS = Object.freeze({
  openai: { name:'OpenAI (ChatGPT API)', env:'OPENAI_API_KEY', models:['gpt-4.1-mini','gpt-4.1'], endpoint:'https://api.openai.com/v1/chat/completions', kind:'openai' },
  anthropic: { name:'Anthropic Claude', env:'ANTHROPIC_API_KEY', models:['claude-sonnet-4-5','claude-haiku-4-5'], endpoint:'https://api.anthropic.com/v1/messages', kind:'anthropic' },
  gemini: { name:'Google Gemini', env:'GEMINI_API_KEY', models:['gemini-2.5-flash','gemini-2.5-pro'], endpoint:'https://generativelanguage.googleapis.com/v1beta', kind:'gemini' },
  openrouter: { name:'OpenRouter', env:'OPENROUTER_API_KEY', models:['openai/gpt-4.1-mini','anthropic/claude-sonnet-4'], endpoint:'https://openrouter.ai/api/v1/chat/completions', kind:'openai-compatible' },
  groq: { name:'Groq', env:'GROQ_API_KEY', models:['llama-3.3-70b-versatile','openai/gpt-oss-20b'], endpoint:'https://api.groq.com/openai/v1/chat/completions', kind:'openai-compatible' },
  deepseek: { name:'DeepSeek', env:'DEEPSEEK_API_KEY', models:['deepseek-chat','deepseek-reasoner'], endpoint:'https://api.deepseek.com/chat/completions', kind:'openai-compatible' },
  ollama: { name:'Ollama (local)', env:null, models:['qwen2.5-coder:7b','codellama:7b'], endpoint:'http://127.0.0.1:11434/v1/chat/completions', kind:'openai-compatible' },
  custom: { name:'Custom OpenAI-compatible', env:'VYNQODE_CUSTOM_API_KEY', models:['custom-model'], endpoint:null, kind:'openai-compatible' }
});
const safeModel = x => typeof x === 'string' && /^[A-Za-z0-9][\w./:+-]{0,119}$/.test(x);
function configuredModels(id, env = process.env) {
  const spec = PROVIDERS[id]; if (!spec) return [];
  const configured = String(env[`VYNQODE_${id.toUpperCase()}_MODELS`] || '').split(',').map(x => x.trim()).filter(safeModel).slice(0, 16);
  return [...new Set(configured.length ? configured : spec.models)];
}
function configured(id, env = process.env) {
  const p = PROVIDERS[id]; if (!p) return false;
  if (id === 'ollama') return env.VYNQODE_ENABLE_OLLAMA === '1';
  if (id === 'custom') return !!(env.VYNQODE_CUSTOM_API_KEY && secureCustomEndpoint(env.VYNQODE_CUSTOM_API_BASE_URL));
  return !!env[p.env];
}
function secureCustomEndpoint(raw) {
  if (typeof raw !== 'string' || raw.length > 300) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash || !url.pathname.match(/\/$/)) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname))) return null;
    return url.href.replace(/\/$/,'') + '/chat/completions';
  } catch { return null; }
}
function listProviders(env = process.env) {
  return Object.entries(PROVIDERS).map(([id,p]) => ({id, name:p.name, configured:configured(id,env), models:configuredModels(id,env), requiresBackend:true}));
}
function validateRequest(body, env = process.env) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(Error('Invalid AI request.'),{status:400});
  const {provider,model,messages} = body;
  if (!PROVIDERS[provider]) throw Object.assign(Error('Unsupported provider.'),{status:400});
  if (!configured(provider,env)) throw Object.assign(Error('This provider is not configured on the local server.'),{status:409});
  if (!configuredModels(provider,env).includes(model)) throw Object.assign(Error('Select a model allowed by the server configuration.'),{status:400});
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 24) throw Object.assign(Error('Expected 1–24 messages.'),{status:400});
  let length=0;
  const clean=messages.map(m=>{
    if (!m || !['system','user','assistant'].includes(m.role) || typeof m.content!=='string' || m.content.length > 42000) throw Object.assign(Error('Invalid message.'),{status:400});
    length += m.content.length;
    return {role:m.role,content:m.content};
  });
  if (length > 100000) throw Object.assign(Error('Project context is too large.'),{status:413});
  return { provider,model,messages:clean };
}
function makeRequest(args,env=process.env){
  const p=PROVIDERS[args.provider];const key=p.env?env[p.env]:'';
  if (p.kind==='anthropic') {
    const system=args.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n');
    const messages=args.messages.filter(m=>m.role!=='system').map(m=>({role:m.role,content:m.content}));
    if (!messages.length) messages.push({role:'user',content:system});
    return {url:p.endpoint,headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:{model:args.model,system,max_tokens:3500,messages}};
  }
  if (p.kind==='gemini') {
    const system=args.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n');
    const contents=args.messages.filter(m=>m.role!=='system').map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]}));
    if (!contents.length) contents.push({role:'user',parts:[{text:system}]});
    const model=encodeURIComponent(args.model);
    return {url:`${p.endpoint}/models/${model}:generateContent`,headers:{'Content-Type':'application/json','x-goog-api-key':key},body:{contents,...(system?{systemInstruction:{parts:[{text:system}]}}:{}),generationConfig:{maxOutputTokens:3500}}};
  }
  const endpoint=args.provider==='custom'?secureCustomEndpoint(env.VYNQODE_CUSTOM_API_BASE_URL):p.endpoint;
  if (!endpoint) throw Object.assign(Error('Secure custom API base URL required.'),{status:400});
  return {url:endpoint,headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},body:{model:args.model,messages:args.messages,...(args.provider==='openai'?{max_completion_tokens:3500}:{max_tokens:3500}),stream:false}};
}
function extractText(provider,payload) {
  let text;
  if (provider==='anthropic') text=(payload?.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
  else if (provider==='gemini') text=(payload?.candidates?.[0]?.content?.parts||[]).filter(c=>typeof c.text==='string').map(c=>c.text).join('\n');
  else {
    const content=payload?.choices?.[0]?.message?.content;
    text=typeof content==='string'?content:Array.isArray(content)?content.filter(c=>typeof c.text==='string').map(c=>c.text).join('\n'):'';
  }
  if (!text || typeof text!=='string') throw Object.assign(Error('The provider returned no text.'),{status:502});
  return text.slice(0,100000);
}
async function limitedJson(response, bytes=1_500_000) {
  if (!response.body) return response.json();
  const reader=response.body.getReader();let size=0;const chunks=[];
  try {while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>bytes)throw Object.assign(Error('Provider response exceeded size limit.'),{status:502});chunks.push(value);}}
  finally {await reader.cancel().catch(()=>{});}
  return JSON.parse(Buffer.concat(chunks.map(c=>Buffer.from(c))).toString('utf8'));
}
async function complete(body,{env=process.env,fetcher=globalThis.fetch}={}) {
  const args=validateRequest(body,env);
  const req=makeRequest(args,env);
  const response=await fetcher(req.url,{method:'POST',headers:req.headers,body:JSON.stringify(req.body),signal:AbortSignal.timeout(60_000),redirect:'error'});
  const payload=await limitedJson(response);
  if (!response.ok) {
    throw Object.assign(Error(`Provider returned HTTP ${response.status}. Check the provider key, allowed model, and quota.`),{status:response.status===429?429:response.status>=500?502:400});
  }
  return {model:args.model,provider:args.provider,text:extractText(args.provider,payload)};
}
module.exports={PROVIDERS,configured,configuredModels,listProviders,validateRequest,makeRequest,extractText,secureCustomEndpoint,complete};
