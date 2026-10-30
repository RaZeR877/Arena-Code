/* Browser client for the Vynqode localhost-only API proxy. No browser keys or custom endpoints. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.VynqodeCloud=api;})(typeof globalThis==='undefined'?null:globalThis,function(){
'use strict';
async function discover(fetcher=fetch){
 const res=await fetcher('./api/ide/providers',{credentials:'same-origin',cache:'no-store'});
 if(!res.ok)throw Error(res.status===404?'Secure AI backend not available on this static website. Run Vynqode locally to use API models.':'Provider discovery failed (HTTP '+res.status+').');
 const data=await res.json();if(!Array.isArray(data.providers))throw Error('Invalid provider list.');return data.providers;
}
function makeEngine(provider,model,fetcher=fetch){
 if(typeof provider!=='string'||!/^[a-z]+$/.test(provider)||typeof model!=='string'||!model||model.length>120)throw Error('Invalid provider or model');
 return {chat:{completions:{async create({messages,max_tokens}){
  const res=await fetcher('./api/ide/complete',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify({provider,model,messages,max_tokens})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(data.error||`API connection failed (HTTP ${res.status}).`);
  if(typeof data.text!=='string')throw Error('Invalid AI provider response.');
  return {choices:[{message:{content:data.text}}]};
 }}}};
}
return Object.freeze({discover,makeEngine});
});
