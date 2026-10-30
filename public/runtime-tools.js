/* Active IDE tools for the same-origin localhost Node app. No Android host execution. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);let projectId=null,fingerprint=null,terminal=null,fit=null,busy=false;
 const sessions={terminal:null,debug:null};
 async function request(path,options={}){const response=await fetch(path,{credentials:'same-origin',...options});const data=await response.json();if(!response.ok)throw Error(data.error||'Local runtime request failed');return data;}
 const post=(path,body)=>request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 function status(text){$('runtimeStatus').textContent=text;}
 async function snapshot(){
  if(!window.Vynqode.save())throw Error('Save your current file before opening runtime tools');
  const project=window.Vynqode.getProject();const current=JSON.stringify(project);
  if(projectId&&fingerprint===current)return projectId;
  if(Object.values(sessions).some(Boolean))throw Error('Project changed. Stop active tools before creating a fresh execution snapshot.');
  const bytes=window.ArenaBrowserCore.zip(project);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  const imported=await post('./api/projects/import-zip',{name:project.name+' runtime',archive:btoa(binary)});
  projectId=imported.project.id;fingerprint=current;return projectId;
 }
 function appendTerminal(text){terminal?.write(text);}
 async function poll(kind){
  const session=sessions[kind];if(!session||session.polling)return;session.polling=true;
  try{const result=await request('./api/ide/runtime/'+session.id+'?cursor='+session.cursor);if(sessions[kind]!==session)return;session.cursor=result.cursor;
   if(kind==='terminal'){if(result.reset)terminal.clear();appendTerminal(result.output);if(result.exited){status('Terminal exited. Stop this session to start another.');}}
   else{
    $('debugState').textContent=result.exited?'Process exited':result.paused?'Paused':'Running';
    $('debugFrames').textContent=(result.frames||[]).map(f=>`${f.name} · ${f.url||'current file'}:${f.line}:${f.column}`).join('\n')||'No paused call stack';
    $('debugLocals').textContent=(result.locals||[]).map(v=>v.name+' = '+v.value).join('\n')||'No local variables at this location';
    $('debugOutput').textContent=($('debugOutput').textContent+result.output).slice(-50000);
   }
  }catch(error){if(sessions[kind]===session)status(error.message);}finally{session.polling=false;}
 }
 async function start(kind){
  if(busy)return;busy=true;
  try{
   if(sessions[kind])throw Error('Stop the existing '+kind+' session first');
   const capabilities=await request('./api/ide/runtime');if(kind==='terminal'&&!capabilities.terminal)throw Error('This host has no PTY support. Install the optional node-pty dependency with its build prerequisites.');
   if(!confirm('Start '+kind+' on your localhost machine? Project code and shell commands run as your OS user. Only run trusted code. Edits in the execution copy can be imported explicitly.'))return;
   const id=await snapshot();const result=await post('./api/ide/runtime',{projectId:id,kind,path:window.Vynqode.getCurrentFile()});
   const session={id:result.id,cursor:0,polling:false};sessions[kind]=session;session.timer=setInterval(()=>poll(kind),350);
   if(kind==='terminal'){
    if(!terminal){terminal=new window.VynqodeTerminal.Terminal({theme:{background:'#16171b',foreground:'#d4dae5'},cursorBlink:true,fontSize:13,scrollback:2000});fit=new window.VynqodeTerminal.FitAddon();terminal.loadAddon(fit);terminal.open($('terminalSurface'));
     terminal.onData(input=>{const s=sessions.terminal;if(s)post('./api/ide/runtime/'+s.id,{input}).catch(e=>status(e.message));});
    }terminal.reset();fit.fit();await post('./api/ide/runtime/'+session.id,{cols:terminal.cols,rows:terminal.rows});terminal.focus();
   }else $('debugOutput').textContent='';
   status('Running a local execution copy. Browser files change only when you import it.');await poll(kind);
  }catch(e){status('Cannot start '+kind+': '+e.message);}finally{busy=false;}
 }
 async function stop(kind){const s=sessions[kind];if(!s)return;clearInterval(s.timer);sessions[kind]=null;try{await request('./api/ide/runtime/'+s.id,{method:'DELETE'});}catch(e){status(e.message);}}
 async function action(action){const s=sessions.debug;if(!s)return status('Start the debugger first');try{await post('./api/ide/runtime/'+s.id,{action,line:Number($('breakpointLine').value)});await poll('debug');}catch(e){status(e.message);}}
 $('openRuntime').onclick=async()=>{$('runtimeDialog').showModal();$('startTerminal').disabled=true;$('startDebugger').disabled=true;try{const capabilities=await request('./api/ide/runtime');$('startTerminal').disabled=!capabilities.terminal;$('startDebugger').disabled=!capabilities.debugger;status('Local trusted-code tools ready. Start a session explicitly.');}catch{status('Terminal and debugger require the localhost Node app. They are unavailable in static Pages and the Android APK.');}};
 $('startTerminal').onclick=()=>start('terminal');$('stopTerminal').onclick=()=>stop('terminal');$('startDebugger').onclick=()=>start('debug');$('stopDebugger').onclick=()=>stop('debug');
 for(const button of document.querySelectorAll('[data-debug-action]'))button.onclick=()=>action(button.dataset.debugAction);
 async function close(){await Promise.all([stop('terminal'),stop('debug')]);$('runtimeDialog').close();}
 $('closeRuntime').onclick=close;$('runtimeDialog').addEventListener('cancel',event=>{event.preventDefault();close();});
 $('exportRuntime').onclick=async()=>{try{if(!projectId)throw Error('No execution copy exists');const response=await fetch('./api/projects/'+projectId+'/archive.zip');if(!response.ok)throw Error('Cannot export execution files');const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='vynqode-execution-copy.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(e){status(e.message);}};
 $('importRuntime').onclick=async()=>{try{
  if(!projectId)throw Error('No execution copy exists');
  if(!window.Vynqode.save())throw Error('Save your editor first');
  if(JSON.stringify(window.Vynqode.getProject())!==fingerprint)throw Error('Browser project changed. Export both copies before reconciling them.');
  if(!confirm('Replace browser files with the execution copy? A browser undo checkpoint will be kept.'))return;
  const response=await fetch('./api/projects/'+projectId+'/archive.zip');if(!response.ok)throw Error('Cannot export the execution copy');
  const project=await window.ArenaBrowserCore.unzip(await response.arrayBuffer());project.name=window.Vynqode.getProject().name;
  if(window.Vynqode.openProject(project,'Imported execution-copy files')){fingerprint=JSON.stringify(window.Vynqode.getProject());status('Execution-copy files imported. You can undo this project change.');}
 }catch(e){status(e.message);}};
 const resize=()=>{if(terminal&&sessions.terminal){fit.fit();post('./api/ide/runtime/'+sessions.terminal.id,{cols:terminal.cols,rows:terminal.rows}).catch(()=>{});}};
 new ResizeObserver(resize).observe($('terminalSurface'));
})();
