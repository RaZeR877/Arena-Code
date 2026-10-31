/* One persistence adapter; a touch editor on phones and optional desktop Monaco. */
(() => {
  'use strict';
  const input=document.getElementById('codeEditor'),host=document.getElementById('smartEditor'),phoneHost=document.getElementById('phoneEditor'),button=document.getElementById('toggleSmartEditor');
  const models=new Map(),views=new Map(),mobile=matchMedia('(max-width:800px), (pointer:coarse) and (max-width:1100px)');
  let settings={fontSize:mobile.matches?16:14,wordWrap:mobile.matches};
  let preferred=null;try{const saved=JSON.parse(localStorage.getItem('vynqode-editor-settings-v1')||'{}');if([12,14,16,18,20].includes(saved.fontSize))settings.fontSize=saved.fontSize;if(typeof saved.wordWrap==='boolean')settings.wordWrap=saved.wordWrap;preferred=localStorage.getItem('vynqode-editor-engine-v2');}catch{}
  let editor=null,phone=null,engine='simple',suppress=false,current=null,loading=false,request=0,viewTimer,monoSession=null;
  const language=path=>({js:'javascript',mjs:'javascript',cjs:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',html:'html',css:'css',json:'json',md:'markdown',py:'python',yml:'yaml',yaml:'yaml'})[path?.split('.').pop()]||'plaintext';
  function queueView(){clearTimeout(viewTimer);viewTimer=setTimeout(()=>window.Vynqode.rememberPosition(),300);}
  function selection(){
    if(engine==='phone'&&phone)return {...phone.selection,...phone.scroll};
    if(engine==='smart'&&editor?.getModel()){const value=editor.getSelection(),model=editor.getModel();return {start:model.getOffsetAt(value.getStartPosition()),end:model.getOffsetAt(value.getEndPosition()),top:editor.getScrollTop(),left:editor.getScrollLeft()};}
    return {start:input.selectionStart,end:input.selectionEnd,top:input.scrollTop,left:input.scrollLeft};
  }
  function mirrorSelection(){const value=selection();input.setSelectionRange(value.start,value.end);}
  function select(start,end=start,focus=true){
    const length=input.value.length;start=Math.max(0,Math.min(start,length));end=Math.max(0,Math.min(end,length));
    if(engine==='phone'){phone.select(start,end,focus);}
    else if(engine==='smart'&&editor?.getModel()){const model=editor.getModel(),a=model.getPositionAt(start),b=model.getPositionAt(end);editor.setSelection(new monaco.Range(a.lineNumber,a.column,b.lineNumber,b.column));editor.revealPositionInCenter(a);if(focus)editor.focus();}
    else{input.setSelectionRange(start,end);if(focus)input.focus();}
    mirrorSelection();queueView();
  }
  function updateHistory(canUndo=true,canRedo=true){document.getElementById('editUndo').disabled=!window.Vynqode.getCurrentFile()||!canUndo;document.getElementById('editRedo').disabled=!window.Vynqode.getCurrentFile()||!canRedo;}
  function visibility(){host.hidden=engine!=='smart';phoneHost.hidden=engine!=='phone';input.hidden=engine!=='simple';document.getElementById('lineNumbers').hidden=engine!=='simple'||settings.wordWrap;button.textContent=engine==='smart'?(mobile.matches?'Touch editor':'Simple editor'):'Smart editor';button.setAttribute('aria-pressed',String(engine==='smart'));if(engine==='simple')window.Vynqode.refreshGutter();editor?.layout();window.dispatchEvent(new Event('vynqode:editor'));}
  function ensurePhone(){if(phone)return;phone=window.VynqodePhoneEditor.create({parent:phoneHost,onChange:(text,start,end)=>{if(engine!=='phone')return;input.value=text;input.setSelectionRange(Math.min(start,end),Math.max(start,end));input.dispatchEvent(new Event('input'));},onSelection:(start,end)=>{if(engine!=='phone')return;input.setSelectionRange(Math.min(start,end),Math.max(start,end));queueView();},onHistory:updateHistory});phone.configure(settings);}
  function sync(project,path,force=false){
    const position=window.Vynqode.getViewPosition();
    if(phone&&engine==='phone'){phone.sync(project,path,window.Vynqode.getProjectSession(),position);mirrorSelection();}
    if(!editor||(!force&&engine!=='smart'))return;
    if(monoSession!==window.Vynqode.getProjectSession()){editor.setModel(null);for(const model of models.values())model.dispose();models.clear();views.clear();current=null;monoSession=window.Vynqode.getProjectSession();}
    const switched=current!==path;if(current&&switched)views.set(current,editor.saveViewState());suppress=true;
    try{
      for(const [name,model]of models)if(!Object.hasOwn(project.files,name)){if(editor.getModel()===model)editor.setModel(null);model.dispose();models.delete(name);views.delete(name);}
      for(const [name,value]of Object.entries(project.files)){let model=models.get(name);if(!model){model=monaco.editor.createModel(value,language(name),monaco.Uri.parse('file:///project/'+name.split('/').map(encodeURIComponent).join('/')));models.set(name,model);}else if(model.getValue()!==value)model.setValue(value);}
      current=path;const target=models.get(path)||null;if(editor.getModel()!==target)editor.setModel(target);if(switched&&!force&&views.has(path))editor.restoreViewState(views.get(path));else if(switched&&position&&engine==='smart'){select(position.start,position.end,false);editor.setScrollTop(position.top||0);}
    }finally{suppress=false;}
  }
  async function loadMonaco(){
    if(editor)return;
    const base=new URL('./vendor/monaco/',document.baseURI).href;
    await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=base+'vs/loader.js';script.onload=resolve;script.onerror=()=>reject(Error('Bundled editor unavailable. Run npm ci and rebuild.'));document.head.append(script);});
    window.MonacoEnvironment={getWorkerUrl:()=>URL.createObjectURL(new Blob([`self.MonacoEnvironment={baseUrl:${JSON.stringify(base)}};importScripts(${JSON.stringify(base+'vs/base/worker/workerMain.js')});`],{type:'text/javascript'}))};
    await new Promise((resolve,reject)=>{window.require.config({paths:{vs:base+'vs'}});window.require(['vs/editor/editor.main'],resolve,reject);});
    const compiler={allowJs:true,checkJs:true,noEmit:true,target:monaco.languages.typescript.ScriptTarget.ESNext,module:monaco.languages.typescript.ModuleKind.ESNext,moduleResolution:monaco.languages.typescript.ModuleResolutionKind.NodeJs,allowNonTsExtensions:true};
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions(compiler);monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compiler);
    monaco.editor.defineTheme('vynqode',{base:'vs-dark',inherit:true,rules:[],colors:{'editor.background':'#191a1e','editorLineNumber.foreground':'#646976','editorCursor.foreground':'#f4a66a'}});
    editor=monaco.editor.create(host,{theme:'vynqode',model:null,automaticLayout:true,minimap:{enabled:false},fontSize:13,scrollBeyondLastLine:false,padding:{top:18},tabSize:2});
    editor.onDidChangeModelContent(()=>{if(suppress||engine!=='smart')return;input.value=editor.getValue();mirrorSelection();input.dispatchEvent(new Event('input'));updateHistory();});
    editor.onDidChangeCursorSelection(()=>{if(engine==='smart'){mirrorSelection();queueView();}});
    applySettings();
  }
  async function setEngine(next,{focus=true,persist=true}={}){
    const token=++request;
    if(next==='smart'){loading=true;button.disabled=true;try{await loadMonaco();}catch(error){document.getElementById('statusMessage').textContent='Desktop editor unavailable. Touch editor remains available.';throw error;}finally{loading=false;button.disabled=false;}}
    if(token!==request)return;
    const position=selection(),text=input.value,project=window.Vynqode.getProject(),path=window.Vynqode.getCurrentFile();
    if(path)project.files[path]=text;
    if(next==='phone'){ensurePhone();phone.sync(project,path,window.Vynqode.getProjectSession(),position);}
    if(next==='smart')sync(project,path,true);
    if(next==='smart'&&editor?.getModel()&&editor.getValue()!==text){suppress=true;editor.setValue(text);suppress=false;}
    engine=next;visibility();select(position.start,position.end,focus);
    if(engine==='phone')phone.view.scrollDOM.scrollTop=position.top||0;
    else if(engine==='smart'){editor.setScrollTop(position.top||0);}
    else{input.scrollTop=position.top||0;input.scrollLeft=position.left||0;}
    if(persist){preferred=next;try{localStorage.setItem('vynqode-editor-engine-v2',next);}catch{}}
    window.Vynqode.rememberPosition();
  }
  button.onclick=()=>{if(loading)return;return setEngine(engine==='smart'?(mobile.matches?'phone':'simple'):'smart').catch(()=>{});};
  document.getElementById('mobileComplete').onpointerdown=event=>event.preventDefault();
  document.getElementById('mobileComplete').onclick=async()=>{if(!window.Vynqode.getCurrentFile()){document.getElementById('statusMessage').textContent='Open a source file first.';return;}try{if(engine==='simple')await setEngine(mobile.matches?'phone':'smart');if(engine==='phone')phone.complete();else{editor.focus();editor.trigger('completion','editor.action.triggerSuggest',{});}}catch{}};
  function applySettings(){input.style.fontSize=settings.fontSize+'px';document.getElementById('lineNumbers').style.fontSize=settings.fontSize+'px';input.wrap=settings.wordWrap?'soft':'off';phone?.configure(settings);editor?.updateOptions({fontSize:settings.fontSize,wordWrap:settings.wordWrap?'on':'off'});if(engine==='simple')document.getElementById('lineNumbers').hidden=settings.wordWrap;}
  function saveSettings(){settings={fontSize:Number(document.getElementById('editorFontSize').value),wordWrap:document.getElementById('editorWordWrap').checked};try{localStorage.setItem('vynqode-editor-settings-v1',JSON.stringify(settings));document.getElementById('editorSettingsStatus').textContent='Editor preferences saved on this device.';}catch{document.getElementById('editorSettingsStatus').textContent='Storage unavailable; preferences apply for this session.';}applySettings();}
  const settingsDialog=document.getElementById('editorSettingsDialog'),problemsDialog=document.getElementById('problemsDialog');
  document.getElementById('editorOptions').onclick=()=>{document.getElementById('editorFontSize').value=String(settings.fontSize);document.getElementById('editorWordWrap').checked=settings.wordWrap;settingsDialog.showModal();};
  document.getElementById('editorFontSize').onchange=saveSettings;document.getElementById('editorWordWrap').onchange=saveSettings;
  document.getElementById('closeEditorSettings').onclick=()=>settingsDialog.close();
  document.getElementById('formatCurrentFile').onclick=async()=>{const note=document.getElementById('editorSettingsStatus');try{if(engine==='smart'){const action=editor.getAction('editor.action.formatDocument');if(!action?.isSupported())throw Error('No formatter for this language');await action.run();}else if(window.Vynqode.getCurrentFile()?.endsWith('.json')){const text=JSON.stringify(JSON.parse(input.value),null,2)+'\n';if(engine==='phone'){phone.select(0,phone.text.length,false);phone.insert(text);}else{input.value=text;input.dispatchEvent(new Event('input'));}}else throw Error('Enable Smart editor for this formatter; JSON formatting also works in Simple editor');note.textContent='Formatted editor text. Save to retain it.';}catch(error){note.textContent=error.message;}};
  function problems(){if(!window.Vynqode.save())return;settingsDialog.close();const project=window.Vynqode.getProject(),list=document.getElementById('problemsResults');list.textContent='';const issues=[];
   for(const [path,text]of Object.entries(project.files)){const check=window.ArenaBrowserCore.check(path,text);if(check.status==='fail')issues.push({path,line:1,column:1,message:check.message});}
   if(editor&&engine==='smart')for(const marker of monaco.editor.getModelMarkers({})){const path=[...models].find(([,model])=>model.uri.toString()===marker.resource.toString())?.[0];if(path)issues.push({path,line:marker.startLineNumber,column:marker.startColumn,message:marker.message});}
   for(const issue of issues.slice(0,200)){const row=document.createElement('button');row.textContent=issue.path+':'+issue.line+':'+issue.column+' — '+issue.message;row.onclick=()=>{problemsDialog.close();window.Vynqode.switchFile(issue.path);const lines=project.files[issue.path].split('\n');const offset=lines.slice(0,issue.line-1).reduce((total,line)=>total+line.length+1,0)+issue.column-1;window.VynqodeEditor.select(offset,1);document.querySelector('[data-section="editor"]').click();};list.append(row);}
   document.getElementById('problemsStatus').textContent=issues.length?issues.length+' diagnostics (first 200 shown).':'No current syntax errors or loaded smart-editor diagnostics. Runtime behavior is unverified.';problemsDialog.showModal();
  }
  document.getElementById('openProblems').onclick=problems;document.getElementById('editorShowProblems').onclick=problems;document.getElementById('closeProblems').onclick=()=>problemsDialog.close();
  function insert(text){if(!window.Vynqode.getCurrentFile()){document.getElementById('statusMessage').textContent='Open a source file first.';return;}if(engine==='phone'){if(text==='  '&&phone.selection.start!==phone.selection.end)phone.indent();else phone.insert(text);}else if(engine==='smart'){if(text==='  '&&!editor.getSelection().isEmpty()){editor.trigger('editing-tools','editor.action.indentLines',{});editor.focus();return;}editor.executeEdits('editing-tools',[{range:editor.getSelection(),text}]);editor.focus();}else{input.focus();document.execCommand('insertText',false,text);}}
  function historyCommand(kind){if(engine==='phone')phone[kind]();else if(engine==='smart'){editor.trigger('editing-tools',kind,null);editor.focus();}else{input.focus();document.execCommand(kind);}}
  function move(direction){if(!window.Vynqode.getCurrentFile()){document.getElementById('statusMessage').textContent='Open a source file first.';return;}if(engine==='phone')phone.move(direction);else if(engine==='smart'){editor.trigger('editing-tools',direction<0?'cursorLeft':'cursorRight',{});editor.focus();}else{const value=selection();select(value.end+direction,value.end+direction);}}
  for(const [id,action]of Object.entries({editUndo:()=>historyCommand('undo'),editRedo:()=>historyCommand('redo'),caretLeft:()=>move(-1),caretRight:()=>move(1)})){const control=document.getElementById(id);control.onpointerdown=event=>event.preventDefault();control.onclick=action;}
  for(const type of ['select','keyup','pointerup','scroll'])input.addEventListener(type,()=>{if(engine==='simple')queueView();});
  window.addEventListener('beforeunload',()=>window.Vynqode.rememberPosition());document.addEventListener('visibilitychange',()=>{if(document.hidden)window.Vynqode.rememberPosition();});
  window.VynqodeEditor={sync,select:(offset,length)=>select(offset,offset+length),insert,position:selection,setEngine,get engine(){return engine;},get enabled(){return engine==='smart';},get phoneView(){return phone?.view;}};
  applySettings();
  const initial=mobile.matches&&preferred!=='smart'?'phone':(['phone','smart','simple'].includes(preferred)?preferred:'simple');
  if(initial!=='simple')setEngine(initial,{focus:false,persist:false}).catch(()=>{});
  mobile.addEventListener('change',event=>{if(engine==='simple'&&event.matches)setEngine('phone',{focus:false,persist:false}).catch(()=>{});});
})();
