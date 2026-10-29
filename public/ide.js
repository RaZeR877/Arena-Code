/* Vynqode — focused single-interface browser coding IDE.
   This app uses the same constrained file engine and reviewed AI change contract
   as the earlier browser workspace. No cloud model or executable shell is required. */
(() => {
  'use strict';
  const core = window.ArenaBrowserCore;
  const workflow = window.ArenaAIWorkflow;
  const catalog = window.ArenaModelCatalog;
  if (!core || !workflow || !catalog) throw Error('Vynqode project and AI modules are missing');
  const KEY = 'vynqode-project-v1', BACKUP = 'vynqode-undo-v1', LEGACY = 'arena-pages-workspace-v1';
  const $ = id => document.getElementById(id);
  const state = { project:null, current:'index.html', dirty:false, view:'editor', busy:false, engine:null, model:null, module:null, models:[], proposal:null, frameNonce:null, source:'browser', mobileSection:'editor' };
  const enc = val => String(val ?? '');
  const sleep = n => new Promise(r => setTimeout(r, n));
  function note(message, error=false) { $('statusMessage').textContent=enc(message); $('statusMessage').dataset.error=String(error); }
  function starter() {
    return core.normalize({name:'My Vynqode project',files:{
      'index.html': `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width,initial-scale=1">\n  <title>My Vynqode App</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <main>\n    <span class="eyebrow">MADE WITH VYNQODE</span>\n    <h1>Make something remarkable.</h1>\n    <p>Write code. Ask AI. Preview instantly.</p>\n    <button id="action">Click to start ✦</button>\n  </main>\n  <script src="app.js"></script>\n</body>\n</html>`,
      'style.css': `:root { color-scheme: dark; }\n* { box-sizing: border-box; }\nbody { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #101829; color: #eaf2ff; font: 16px system-ui; }\nmain { max-width: 620px; padding: 48px 28px; text-align: center; }\n.eyebrow { color: #a9ef7c; font-size: 11px; font-weight: bold; letter-spacing: 3px; }\nh1 { font-size: clamp(34px, 6vw, 56px); letter-spacing: -2px; margin: 24px 0; }\np { color: #99aac3; }\nbutton { margin-top: 20px; background: #a9ef7c; border: 0; border-radius: 10px; color: #102019; padding: 13px 22px; font-weight: 700; cursor: pointer; }`,
      'app.js': `document.querySelector('#action').addEventListener('click', () => {\n  document.querySelector('h1').textContent = 'You are building something great!';\n  console.log('Vynqode preview is running.');\n});`
    }});
  }
  function load() {
    try {
      const saved = localStorage.getItem(KEY) || localStorage.getItem(LEGACY);
      state.project = saved ? core.normalize(JSON.parse(saved)) : starter();
      if (!localStorage.getItem(KEY)) persist(state.project);
    } catch (e) { state.project=starter(); note('Could not restore saved workspace: '+e.message, true); }
    state.current = Object.hasOwn(state.project.files,'index.html') ? 'index.html' : Object.keys(state.project.files)[0] || null;
  }
  function persist(project) {
    const raw = JSON.stringify(project);
    if (raw.length > 4 * 1024 * 1024) throw Error('Browser storage full. Export your ZIP before continuing.');
    localStorage.setItem(KEY, raw);
  }
  function mutate(changes, label, preferredPath) {
    const next = core.update(state.project, changes);
    try { localStorage.setItem(BACKUP, JSON.stringify(state.project)); persist(next); }
    catch (e) { note('Save failed: '+e.message,true); return false; }
    state.project = next;
    if (preferredPath && Object.hasOwn(next.files,preferredPath)) state.current=preferredPath;
    else if (!state.current || !Object.hasOwn(next.files,state.current)) state.current=Object.keys(next.files)[0]||null;
    state.dirty=false;
    render(); note(label || 'Saved locally'); return true;
  }
  function replaceProject(project,label) {
    const next=core.normalize(project);
    try { localStorage.setItem(BACKUP,JSON.stringify(state.project)); persist(next); }
    catch(e) {note('Could not replace project: '+e.message,true);return false;}
    state.project=next;state.current=Object.hasOwn(next.files,'index.html')?'index.html':Object.keys(next.files)[0]||null;
    state.dirty=false;setView('editor');render();note(label||'Project opened');return true;
  }
  function saveOpen() {
    if (!state.current || !state.dirty) return true;
    const content=$('codeEditor').value;
    if (content === state.project.files[state.current]) {state.dirty=false;render();return true;}
    return mutate([{path:state.current,content}],'Saved '+state.current);
  }
  function pathIcon(path){return /\.html?$/i.test(path)?'◇':/\.css$/i.test(path)?'◫':/\.[cm]?jsx?$/i.test(path)?'JS':/\.tsx?$/i.test(path)?'TS':/\.json$/i.test(path)?'{}':'◈';}
  function render() {
    $('projectName').textContent=state.project.name;
    $('treeProjectName').textContent=state.project.name.toUpperCase();
    const list=$('fileList');list.textContent='';
    for (const path of Object.keys(state.project.files).sort()) {
      const btn=document.createElement('button');btn.className='file-row'+(path===state.current?' selected':'');btn.dataset.file=path;btn.setAttribute('role','option');btn.setAttribute('aria-selected',String(path===state.current));btn.title=path;
      const icon=document.createElement('span');icon.className='file-icon';icon.textContent=pathIcon(path);
      const label=document.createElement('span');label.textContent=path;label.style.cssText='overflow:hidden;text-overflow:ellipsis;white-space:nowrap';btn.append(icon,label);list.append(btn);
    }
    $('codeEditor').disabled=!state.current;
    $('codeEditor').value=state.current?state.project.files[state.current]:'';
    $('fileBadge').textContent=state.current||'No file';
    state.dirty=false;updateGutter();
  }
  function updateGutter(){const value=$('codeEditor').value;$('lineNumbers').textContent=Array.from({length:Math.max(1,value.split('\n').length)},(_,i)=>i+1).join('\n');}
  function switchFile(path) {if (state.dirty&&!saveOpen()) return;state.current=path;render();setView('editor');}
  function createFile(){if(state.dirty&&!saveOpen())return;const path=prompt('New file path (e.g. src/components/button.js):');if(path===null)return;try{core.safePath(path);if(Object.hasOwn(state.project.files,path))throw Error('File already exists');mutate([{path,content:''}],'Created '+path,path);}catch(e){note(e.message,true);}}
  function renameFile(){if(!state.current)return;const before=state.current;const after=prompt('Rename file:',before);if(after===null||after===before)return;try{core.safePath(after);if(Object.hasOwn(state.project.files,after))throw Error('Destination exists');if(state.dirty&&!saveOpen())return;mutate([{path:before,delete:true},{path:after,content:state.project.files[before]}],'Renamed '+before,after);}catch(e){note(e.message,true);}}
  function deleteFile(){if(!state.current||!confirm('Delete '+state.current+'? You can undo this change.'))return;state.dirty=false;mutate([{path:state.current,delete:true}],'File deleted');}
  function newProject(){if(state.dirty&&!saveOpen())return;if(!confirm('Create a fresh project? Current work can be recovered with Undo or a previously exported ZIP.'))return;const p=starter();replaceProject(p,'New project created');}
  function renameProject(){if(state.dirty&&!saveOpen())return;const name=prompt('Project name:',state.project.name);if(name===null)return;const next=core.normalize({...state.project,name});replaceProject(next,'Project renamed');}
  function undo(){if(state.dirty&&!confirm('Discard unsaved editor text and undo the previous project change?'))return;try{const backup=localStorage.getItem(BACKUP);if(!backup)throw Error('No saved undo checkpoint');const next=core.normalize(JSON.parse(backup));localStorage.setItem(BACKUP,JSON.stringify(state.project));persist(next);state.project=next;state.current=Object.hasOwn(next.files,state.current)?state.current:Object.keys(next.files)[0]||null;render();note('Previous project change restored');}catch(e){note(e.message,true);}}
  function download(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  function exportZip(){if(state.dirty&&!saveOpen())return;try{const bytes=core.zip(state.project);const name=state.project.name.replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'')||'vynqode-project';download(new Blob([bytes],{type:'application/zip'}),name+'.zip');note('Project ZIP exported');}catch(e){note(e.message,true);}}
  async function importFiles(files){if(!files||!files.length)return;if(state.dirty&&!saveOpen())return;
    try{
      if(files.length===1&&/\.zip$/i.test(files[0].name)){const imported=await core.unzip(await files[0].arrayBuffer());imported.name=files[0].name.replace(/\.zip$/i,'');replaceProject(imported,'ZIP imported');return;}
      if(files.length===1&&/\.(?:arena\.)?json$/i.test(files[0].name)){
        const text=await files[0].text();let value;try{value=JSON.parse(text)}catch{value=null}
        if(value&&typeof value==='object'&&value.files){replaceProject(value,'Project JSON imported');return;}
      }
      const changes=[];
      for(const file of files){const path=core.safePath(file.webkitRelativePath||file.name);if(file.size>core.MAX_FILE_BYTES)throw Error('File too large: '+path);const content=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());changes.push({path,content});}
      if(!confirm('Import '+changes.length+' text file(s) into this project? Existing files with matching names will be replaced.'))return;
      if(changes.length>10)throw Error('Import up to 10 files at a time or use a ZIP');mutate(changes,'Imported '+changes.length+' files');
    }catch(e){note('Import failed: '+e.message,true);}
  }
  function checkProject(){if(state.dirty&&!saveOpen())return;
    const checks=Object.entries(state.project.files).map(([path,content])=>({path,...core.check(path,content)}));
    const bad=checks.filter(x=>x.status==='fail');
    $('diagnosticsText').textContent=checks.map(x=>`${x.status.toUpperCase().padEnd(10)} ${x.path}: ${x.message}`).join('\n')||'No project files';
    $('diagnosticsCount').textContent=`${bad.length} errors · ${checks.length} files`;$('diagnosticsPanel').open=true;
    note(bad.length?bad.length+' syntax issues found':'Syntax checks complete. Browser preview is not a build/test runner.',bad.length>0);
  }
  function setView(view){state.view=view;const isPreview=view==='preview';$('editorSurface').classList.toggle('hidden',isPreview);$('previewSurface').classList.toggle('hidden',!isPreview);$('editorTab').classList.toggle('active',!isPreview);$('previewTab').classList.toggle('active',isPreview);$('editorTab').setAttribute('aria-selected',String(!isPreview));$('previewTab').setAttribute('aria-selected',String(isPreview));}
  function resolveAsset(target,base) {if(!target||/^(?:https?:|data:|blob:|\/\/|\/|#)/i.test(target))return null;const stack=base.split('/').slice(0,-1);for(const part of target.split('/')){if(!part||part==='.')continue;if(part==='..'){if(!stack.length)return null;stack.pop();}else stack.push(part);}try{return core.safePath(stack.join('/'));}catch{return null;}}
  function preview(){if(state.dirty&&!saveOpen())return;const paths=Object.keys(state.project.files);const source=(state.current&&/\.html?$/i.test(state.current)?state.current:paths.find(x=>x==='index.html')||paths.find(x=>/\.html?$/i.test(x)));
    if(!source){note('Add an HTML file to preview. Server-side frameworks require the Node runner.',true);return;}
    const parser=new DOMParser();const doc=parser.parseFromString(state.project.files[source],'text/html');
    for(const css of [...doc.querySelectorAll('link[rel="stylesheet"][href]')]){const path=resolveAsset(css.getAttribute('href'),source);if(path&&Object.hasOwn(state.project.files,path)){const style=doc.createElement('style');style.textContent=state.project.files[path];css.replaceWith(style);}}
    for(const js of [...doc.querySelectorAll('script[src]')]){const path=resolveAsset(js.getAttribute('src'),source);if(path&&Object.hasOwn(state.project.files,path)&&js.type!=='module'){const inline=doc.createElement('script');inline.textContent=state.project.files[path];js.replaceWith(inline);}}
    const token=Math.random().toString(36).slice(2)+Date.now();state.frameNonce=token;
    const bridge=doc.createElement('script');bridge.textContent=`(()=>{const token=${JSON.stringify(token)};for(const name of ['log','warn','error']){const old=console[name];console[name]=(...values)=>{try{parent.postMessage({vynqodePreview:true,token,level:name,message:values.map(String).join(' ').slice(0,600)},'*')}catch{};old.apply(console,values)}}addEventListener('error',e=>parent.postMessage({vynqodePreview:true,token,level:'error',message:String(e.message).slice(0,600)},'*'))})();`;
    doc.head.prepend(bridge);$('previewFrame').srcdoc='<!doctype html>\n'+doc.documentElement.outerHTML;setView('preview');note('Previewing '+source+' · HTML/CSS/classic JS only');
  }
  function showModal(id){$(id).showModal();}function hideModal(id){$(id).close();}
  function chatBubble(message,author){const log=$('chatLog');log.querySelector('.welcome')?.remove();const div=document.createElement('div');div.className='bubble '+author;if(author==='ai'){const label=document.createElement('strong');label.textContent='Vynqode AI';div.append(label);}const p=document.createElement('span');p.textContent=message;div.append(p);log.append(div);log.scrollTop=log.scrollHeight;return div;}
  function modelProgress(message,value){$('modelStatus').textContent=message;if(value!==undefined)$('modelProgress').style.width=Math.max(0,Math.min(100,Math.round(value*100)))+'%';}
  async function discoverModels(){
    $('discoverModels').disabled=true;
    try{
      modelProgress('Loading WebLLM catalog…',0);
      const lib=await import('https://esm.run/@mlc-ai/web-llm@0.2.80');state.module=lib;
      const models=catalog.availableModels(lib.prebuiltAppConfig.model_list);state.models=models;
      if(!models.length)throw Error('No supported quantized models were found in this runtime');
      $('modelSelect').textContent='';for(const m of models){const o=document.createElement('option');o.value=m.id;o.textContent=m.label;$('modelSelect').append(o);}const preferred=catalog.recommended(models,localStorage.getItem('vynqode-model-choice'));if(preferred)$('modelSelect').value=preferred;
      modelProgress(models.length+' compatible models found. Choose based on available GPU memory.',0);
    }catch(e){modelProgress('Model discovery failed: '+e.message,0);}
    finally{$('discoverModels').disabled=false;}
  }
  async function loadModel(){if(state.busy)return;state.busy=true;$('loadModel').disabled=true;
    try{
      if(!navigator.gpu)throw Error('WebGPU is unavailable. Use a supported Chrome or Edge browser with GPU support.');
      if(!state.module||!state.models.length)await discoverModels();
      const id=$('modelSelect').value;
      if(!state.models.some(x=>x.id===id))throw Error('Choose a model from the supported list');
      modelProgress('Loading model. Large downloads can take time…',0.01);
      if(state.engine){await state.engine.unload?.();state.engine=null;}
      state.engine=await state.module.CreateMLCEngine(id,{initProgressCallback:e=>modelProgress(e.text||'Loading local model…',e.progress||0)},{context_window_size:4096});
      state.model=id;localStorage.setItem('vynqode-model-choice',id);
      $('activeModel').textContent=id;$('aiLight').classList.add('ready');modelProgress('Ready · on-device model '+id,1);hideModal('modelDialog');note('AI model loaded locally');
    }catch(e){modelProgress('Could not load model: '+e.message,0);note('AI model unavailable: '+e.message,true);}
    finally{state.busy=false;$('loadModel').disabled=false;}
  }
  async function askAI(){if(state.busy)return;const task=$('assistantPrompt').value.trim();if(!task)return note('Write a question for AI first',true);if(!state.engine)return showModal('modelDialog');if(state.dirty&&!saveOpen())return;
    state.busy=true;$('askAssistant').disabled=true;$('proposeEdits').disabled=true;$('assistantPrompt').value='';chatBubble(task,'user');const bubble=chatBubble('Thinking…','ai');
    try{const context=workflow.context(state.project,task,state.current,14000);
      const res=await state.engine.chat.completions.create({messages:[{role:'system',content:'You are a programming assistant. Answer the question accurately and concisely. You can inspect provided project context. Do not claim you executed tests or changed files. If asked to change files, explain that Suggest edits handles approved patches.'},{role:'user',content:context.text}],max_tokens:1200,temperature:0.2});
      bubble.querySelector('span').textContent=String(res.choices?.[0]?.message?.content||'The model returned no response.').slice(0,8000);
    }catch(e){bubble.querySelector('span').textContent='AI request failed: '+e.message;}
    finally{state.busy=false;$('askAssistant').disabled=false;$('proposeEdits').disabled=false;}
  }
  function fillReview(proposal){$('reviewDescription').textContent=proposal.summary+' · Generated code is untrusted; no tests have been executed.';const container=$('reviewFiles');container.textContent='';
    for(const change of proposal.changes){const details=document.createElement('details');details.open=true;const title=document.createElement('summary');title.textContent=(change.delete?'DELETE ':Object.hasOwn(state.project.files,change.path)?'EDIT ':'CREATE ')+change.path;details.append(title);const grid=document.createElement('div');grid.className='diff-grid';for(const [name,content] of [['Before',state.project.files[change.path]??'(new file)'],['After',change.delete?'(deleted)':change.content]]){const pane=document.createElement('section');const h=document.createElement('h3');h.textContent=name;const pre=document.createElement('pre');pre.textContent=content;pane.append(h,pre);grid.append(pane);}details.append(grid);container.append(details);}
    $('approveChanges').textContent='Approve '+proposal.changes.length+' change(s)';
  }
  async function suggestEdits(){if(state.busy)return;const task=$('assistantPrompt').value.trim();if(!task)return note('Describe your requested change first',true);if(!state.engine)return showModal('modelDialog');if(state.dirty&&!saveOpen())return;
    state.busy=true;$('askAssistant').disabled=true;$('proposeEdits').disabled=true;const revision=state.project.revision;chatBubble(task,'user');const reply=chatBubble('Inspecting project files and preparing a reviewed patch…','ai');
    try{
      const result=await workflow.propose({engine:state.engine,project:state.project,task,current:state.current,onProgress:p=>reply.querySelector('span').textContent=p});
      if(state.project.revision!==revision||state.dirty)throw Error('Project changed while the model was generating; no stale edit will be applied.');
      state.proposal={...result,revision};fillReview(result.proposal);
      reply.querySelector('span').textContent='Proposed '+result.proposal.changes.length+' file change(s) after '+result.attempts+' pass(es). Please review the exact before/after contents.';
      $('assistantPrompt').value='';showModal('reviewDialog');
    }catch(e){reply.querySelector('span').textContent='Could not propose edits: '+e.message;note(e.message,true);}
    finally{state.busy=false;$('askAssistant').disabled=false;$('proposeEdits').disabled=false;}
  }
  function applyReview(){const pending=state.proposal;if(!pending)return;
    if(state.project.revision!==pending.revision||state.dirty){note('Project changed during review. Stale edits rejected.',true);chatBubble('Stale changes were rejected; request a new patch.','ai');}
    else if(mutate(pending.proposal.changes,'Applied '+pending.proposal.changes.length+' approved AI edits')){
      chatBubble('Approved changes saved. Run Check syntax and Preview to inspect the result; runtime tests have NOT been executed.','ai');
      setView('editor');
    }
    state.proposal=null;hideModal('reviewDialog');
  }
  async function checkGPU(){try{const adapter=await navigator.gpu?.requestAdapter();$('gpuStatus').textContent=adapter?'✓ WebGPU adapter detected':'WebGPU unavailable in this browser or device';}catch(e){$('gpuStatus').textContent='WebGPU request failed: '+e.message;}}
  function mobileSection(section){document.querySelector('.ide-layout').dataset.section=section;state.mobileSection=section;document.querySelectorAll('[data-section]').forEach(x=>x.classList.toggle('active',x.dataset.section===section));}
  function wire(){
    $('fileList').onclick=e=>{const row=e.target.closest('button[data-file]');if(row)switchFile(row.dataset.file);};
    $('codeEditor').addEventListener('input',()=>{state.dirty=true;$('fileBadge').textContent=(state.current||'')+' •';updateGutter();});
    $('codeEditor').addEventListener('scroll',()=>{$('lineNumbers').scrollTop=$('codeEditor').scrollTop;});
    $('codeEditor').addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();const ta=e.currentTarget;ta.setRangeText('  ',ta.selectionStart,ta.selectionEnd,'end');ta.dispatchEvent(new Event('input'));}});
    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveOpen();}if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();preview();}});
    $('newProject').onclick=newProject;$('projectName').onclick=renameProject;$('addFile').onclick=createFile;$('renameFile').onclick=renameFile;$('deleteFile').onclick=deleteFile;
    $('saveFile').onclick=saveOpen;$('checkSyntax').onclick=checkProject;$('runPreview').onclick=preview;$('refreshPreview').onclick=preview;$('undoChange').onclick=undo;
    $('editorTab').onclick=()=>setView('editor');$('previewTab').onclick=preview;
    $('exportProject').onclick=exportZip;$('importProject').onclick=()=>$('importInput').click();
    $('importInput').onchange=async e=>{try{await importFiles(e.target.files);}finally{e.target.value='';}};
    $('configureModel').onclick=()=>{showModal('modelDialog');checkGPU();};$('discoverModels').onclick=discoverModels;$('loadModel').onclick=loadModel;
    document.querySelectorAll('[data-close-modal]').forEach(x=>x.onclick=()=>hideModal('modelDialog'));
    $('askAssistant').onclick=askAI;$('proposeEdits').onclick=suggestEdits;
    $('approveChanges').onclick=applyReview;$('rejectChanges').onclick=()=>{state.proposal=null;hideModal('reviewDialog');note('AI edits rejected; no files modified');};
    document.querySelectorAll('[data-close-review]').forEach(x=>x.onclick=()=>$('rejectChanges').click());
    $('reviewDialog').onclose=()=>{if($('reviewDialog').returnValue!=='apply')state.proposal=null;};
    $('chatLog').onclick=e=>{const s=e.target.closest('[data-suggest]');if(s){$('assistantPrompt').value=s.dataset.suggest;$('assistantPrompt').focus();}};
    $('assistantPrompt').onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();askAI();}};
    document.querySelectorAll('[data-section]').forEach(x=>x.onclick=()=>mobileSection(x.dataset.section));
    window.addEventListener('message',event=>{if(event.source!==$('previewFrame').contentWindow||!event.data?.vynqodePreview||event.data.token!==state.frameNonce)return;if(event.data.level==='error'){note('Preview: '+String(event.data.message).slice(0,160),true);} });
  }
  load();wire();render();mobileSection('editor');
  // Public, intentionally limited diagnostics interface for automation/test harnesses.
  window.Vynqode = Object.freeze({ getProject:()=>JSON.parse(JSON.stringify(state.project)),getModel:()=>state.model,
    attachTestEngine:(engine,name='Test model')=>{if(!engine?.chat?.completions?.create)throw Error('Invalid model engine');state.engine=engine;state.model=name;$('activeModel').textContent=name;$('aiLight').classList.add('ready');}
  });
})();
