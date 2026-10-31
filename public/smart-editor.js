/* Optional, bundled Monaco surface. The textarea stays the persistence adapter and mobile fallback. */
(() => {
  'use strict';
  const input=document.getElementById('codeEditor'),host=document.getElementById('smartEditor'),button=document.getElementById('toggleSmartEditor');
  const models=new Map(),views=new Map();
  let settings={fontSize:14,wordWrap:false};try{const saved=JSON.parse(localStorage.getItem('vynqode-editor-settings-v1')||'{}');if([12,14,16,18,20].includes(saved.fontSize))settings.fontSize=saved.fontSize;if(typeof saved.wordWrap==='boolean')settings.wordWrap=saved.wordWrap;}catch{}
  let editor=null,enabled=false,suppress=false,current=null,loading=false;
  const language=path=>({js:'javascript',mjs:'javascript',cjs:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',html:'html',css:'css',json:'json',md:'markdown',py:'python',yml:'yaml',yaml:'yaml'})[path?.split('.').pop()]||'plaintext';
  function visibility(){host.hidden=!enabled;input.hidden=enabled;document.getElementById('lineNumbers').hidden=enabled;button.textContent=enabled?'Simple editor':'Smart editor';button.setAttribute('aria-pressed',String(enabled));editor?.layout();}
  function sync(project,path){
    if(!editor)return;
    if(current)views.set(current,editor.saveViewState());
    suppress=true;
    try{
      for(const [name,model] of models)if(!Object.hasOwn(project.files,name)){if(editor.getModel()===model)editor.setModel(null);model.dispose();models.delete(name);views.delete(name);}
      for(const [name,value] of Object.entries(project.files)){
        let model=models.get(name);
        if(!model){model=monaco.editor.createModel(value,language(name),monaco.Uri.parse('file:///project/'+name.split('/').map(encodeURIComponent).join('/')));models.set(name,model);}
        else if(model.getValue()!==value)model.setValue(value);
      }
      current=path;editor.setModel(models.get(path)||null);
      if(views.has(path))editor.restoreViewState(views.get(path));
    }finally{suppress=false;}
  }
  async function load(){
    if(editor)return;
    const base=new URL('./vendor/monaco/',document.baseURI).href;
    await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=base+'vs/loader.js';script.onload=resolve;script.onerror=()=>reject(Error('Bundled editor unavailable. Run npm ci and rebuild.'));document.head.append(script);});
    window.MonacoEnvironment={getWorkerUrl:()=>URL.createObjectURL(new Blob([`self.MonacoEnvironment={baseUrl:${JSON.stringify(base)}};importScripts(${JSON.stringify(base+'vs/base/worker/workerMain.js')});`],{type:'text/javascript'}))};
    await new Promise((resolve,reject)=>{window.require.config({paths:{vs:base+'vs'}});window.require(['vs/editor/editor.main'],resolve,reject);});
    const compiler={allowJs:true,checkJs:true,noEmit:true,target:monaco.languages.typescript.ScriptTarget.ESNext,module:monaco.languages.typescript.ModuleKind.ESNext,moduleResolution:monaco.languages.typescript.ModuleResolutionKind.NodeJs,allowNonTsExtensions:true};
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions(compiler);monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compiler);
    monaco.editor.defineTheme('vynqode',{base:'vs-dark',inherit:true,rules:[],colors:{'editor.background':'#191a1e','editorLineNumber.foreground':'#646976','editorCursor.foreground':'#f4a66a'}});
    editor=monaco.editor.create(host,{theme:'vynqode',model:null,automaticLayout:true,minimap:{enabled:false},fontSize:13,scrollBeyondLastLine:false,padding:{top:18},tabSize:2});
    editor.onDidChangeModelContent(()=>{if(suppress)return;input.value=editor.getValue();input.dispatchEvent(new Event('input'));});
    applySettings();sync(window.Vynqode.getProject(),window.Vynqode.getCurrentFile());
  }
  button.onclick=async()=>{
    if(loading)return;loading=true;button.disabled=true;
    try{await load();if(!enabled&&editor.getValue()!==input.value){suppress=true;editor.setValue(input.value);suppress=false;}enabled=!enabled;visibility();if(enabled)editor.focus();else input.focus();}
    catch(error){button.textContent='Retry smart editor';button.title=error.message;document.getElementById('statusMessage').textContent=error.message;}
    finally{loading=false;button.disabled=false;}
  };
  document.getElementById('mobileComplete').onpointerdown=event=>event.preventDefault();
  document.getElementById('mobileComplete').onclick=async()=>{if(!window.Vynqode.getCurrentFile()){document.getElementById('statusMessage').textContent='Open a source file first.';return;}const offset=enabled&&editor?editor.getModel().getOffsetAt(editor.getPosition()):input.selectionStart;if(!enabled)await button.onclick();if(editor&&enabled){editor.setPosition(editor.getModel().getPositionAt(offset));editor.focus();editor.trigger('mobile-completion','editor.action.triggerSuggest',{});}};
  function applySettings(){input.style.fontSize=settings.fontSize+'px';document.getElementById('lineNumbers').style.fontSize=settings.fontSize+'px';input.wrap=settings.wordWrap?'soft':'off';editor?.updateOptions({fontSize:settings.fontSize,wordWrap:settings.wordWrap?'on':'off'});}
  function saveSettings(){settings={fontSize:Number(document.getElementById('editorFontSize').value),wordWrap:document.getElementById('editorWordWrap').checked};try{localStorage.setItem('vynqode-editor-settings-v1',JSON.stringify(settings));document.getElementById('editorSettingsStatus').textContent='Editor preferences saved on this device.';}catch{document.getElementById('editorSettingsStatus').textContent='Storage unavailable; preferences apply for this session.';}applySettings();}
  const settingsDialog=document.getElementById('editorSettingsDialog'),problemsDialog=document.getElementById('problemsDialog');
  document.getElementById('editorOptions').onclick=()=>{document.getElementById('editorFontSize').value=String(settings.fontSize);document.getElementById('editorWordWrap').checked=settings.wordWrap;settingsDialog.showModal();};
  document.getElementById('editorFontSize').onchange=saveSettings;document.getElementById('editorWordWrap').onchange=saveSettings;
  document.getElementById('closeEditorSettings').onclick=()=>settingsDialog.close();
  document.getElementById('formatCurrentFile').onclick=async()=>{const note=document.getElementById('editorSettingsStatus');try{if(enabled){const action=editor.getAction('editor.action.formatDocument');if(!action?.isSupported())throw Error('No formatter for this language');await action.run();}else if(window.Vynqode.getCurrentFile()?.endsWith('.json')){input.value=JSON.stringify(JSON.parse(input.value),null,2)+'\n';input.dispatchEvent(new Event('input'));}else throw Error('Enable Smart editor for this formatter; JSON formatting also works in Simple editor');note.textContent='Formatted editor text. Save to retain it.';}catch(error){note.textContent=error.message;}};
  function problems(){if(!window.Vynqode.save())return;settingsDialog.close();const project=window.Vynqode.getProject(),list=document.getElementById('problemsResults');list.textContent='';const issues=[];
   for(const [path,text]of Object.entries(project.files)){const check=window.ArenaBrowserCore.check(path,text);if(check.status==='fail')issues.push({path,line:1,column:1,message:check.message});}
   if(editor)for(const marker of monaco.editor.getModelMarkers({})){const path=[...models].find(([,model])=>model.uri.toString()===marker.resource.toString())?.[0];if(path)issues.push({path,line:marker.startLineNumber,column:marker.startColumn,message:marker.message});}
   for(const issue of issues.slice(0,200)){const row=document.createElement('button');row.textContent=issue.path+':'+issue.line+':'+issue.column+' — '+issue.message;row.onclick=()=>{problemsDialog.close();window.Vynqode.switchFile(issue.path);const lines=project.files[issue.path].split('\n');const offset=lines.slice(0,issue.line-1).reduce((total,line)=>total+line.length+1,0)+issue.column-1;window.VynqodeEditor.select(offset,1);document.querySelector('[data-section="editor"]').click();};list.append(row);}
   document.getElementById('problemsStatus').textContent=issues.length?issues.length+' diagnostics (first 200 shown).':'No current syntax errors or loaded smart-editor diagnostics. Runtime behavior is unverified.';problemsDialog.showModal();
  }
  document.getElementById('openProblems').onclick=problems;document.getElementById('editorShowProblems').onclick=problems;document.getElementById('closeProblems').onclick=()=>problemsDialog.close();
  applySettings();
  window.VynqodeEditor={sync,select(offset,length){if(editor&&enabled){const model=editor.getModel();const start=model.getPositionAt(offset),end=model.getPositionAt(offset+length);editor.setSelection(new monaco.Range(start.lineNumber,start.column,end.lineNumber,end.column));editor.revealPositionInCenter(start);editor.focus();}else{input.focus();input.setSelectionRange(offset,offset+length);}},insert(text){if(!window.Vynqode.getCurrentFile()){document.getElementById('statusMessage').textContent='Open a source file first.';return;}if(editor&&enabled){editor.executeEdits('mobile-keyboard',[{range:editor.getSelection(),text}]);editor.focus();}else{input.setRangeText(text,input.selectionStart,input.selectionEnd,'end');input.dispatchEvent(new Event('input'));input.focus();}},get enabled(){return enabled;}};
})();
