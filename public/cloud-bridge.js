/* Browser client for the Vynqode localhost-only API proxy. No browser keys or custom endpoints. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.VynqodeCloud=api;})(typeof globalThis==='undefined'?null:globalThis,function(){
'use strict';
async function discover(fetcher=fetch){
 if(globalThis.VynqodeNative?.available){const data=await globalThis.VynqodeNative.ai.providers();if(!Array.isArray(data.providers))throw Error('Invalid native provider list');return data.providers;}
 const res=await fetcher('./api/ide/providers',{credentials:'same-origin',cache:'no-store'});
 if(!res.ok)throw Error(res.status===404?'Secure AI backend not available on this static website. Run Vynqode locally to use API models.':'Provider discovery failed (HTTP '+res.status+').');
 const data=await res.json();if(!Array.isArray(data.providers))throw Error('Invalid provider list.');return data.providers;
}
async function setSessionKey(provider,apiKey,fetcher=fetch){
 if(globalThis.VynqodeNative?.available)throw Error('Use the native credential dialog; keys must not enter page JavaScript.');
 if(typeof provider!=='string'||!/^[a-z]+$/.test(provider)||typeof apiKey!=='string'||apiKey.length>512)throw Error('Invalid key configuration.');
 const res=await fetcher('./api/ide/credentials',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider,apiKey})});
 const body=await res.json().catch(()=>({}));if(!res.ok)throw Error(body.error||'Could not save session key.');return body;
}
async function clearSessionKey(provider,fetcher=fetch){
 if(globalThis.VynqodeNative?.available)return globalThis.VynqodeNative.ai.clear(provider);
 const res=await fetcher('./api/ide/credentials',{method:'DELETE',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider})});
 const body=await res.json().catch(()=>({}));if(!res.ok)throw Error(body.error||'Could not remove session key.');return body;
}
function makeEngine(provider,model,fetcher=fetch){
 if(typeof provider!=='string'||!/^[a-z]+$/.test(provider)||typeof model!=='string'||!model||model.length>120)throw Error('Invalid provider or model');
 return {chat:{completions:{async create({messages,max_tokens}){
  if(globalThis.VynqodeNative?.available){const data=await globalThis.VynqodeNative.ai.complete({provider,model,messages,max_tokens});if(typeof data.text!=='string')throw Error('Invalid native provider response');return {choices:[{message:{content:data.text}}]};}
  const res=await fetcher('./api/ide/complete',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify({provider,model,messages,max_tokens})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(data.error||`API connection failed (HTTP ${res.status}).`);
  if(typeof data.text!=='string')throw Error('Invalid AI provider response.');
  return {choices:[{message:{content:data.text}}]};
 }}}};
}
return Object.freeze({discover,makeEngine,setSessionKey,clearSessionKey,configureNative:provider=>globalThis.VynqodeNative.ai.configure(provider)});
});
