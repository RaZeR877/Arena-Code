/* Optional, bundled Monaco surface. The textarea stays the persistence adapter and mobile fallback. */
(() => {
  'use strict';
  const input=document.getElementById('codeEditor'),host=document.getElementById('smartEditor'),button=document.getElementById('toggleSmartEditor');
  const models=new Map(),views=new Map();
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
    monaco.editor.defineTheme('vynqode',{base:'vs-dark',inherit:true,rules:[],colors:{'editor.background':'#191a1e','editorLineNumber.foreground':'#646976','editorCursor.foreground':'#f4a66a'}});
    editor=monaco.editor.create(host,{theme:'vynqode',model:null,automaticLayout:true,minimap:{enabled:false},fontSize:13,scrollBeyondLastLine:false,padding:{top:18},tabSize:2});
    editor.onDidChangeModelContent(()=>{if(suppress)return;input.value=editor.getValue();input.dispatchEvent(new Event('input'));});
    sync(window.Vynqode.getProject(),window.Vynqode.getCurrentFile());
  }
  button.onclick=async()=>{
    if(loading)return;loading=true;button.disabled=true;
    try{await load();if(!enabled&&editor.getValue()!==input.value){suppress=true;editor.setValue(input.value);suppress=false;}enabled=!enabled;visibility();if(enabled)editor.focus();else input.focus();}
    catch(error){button.textContent='Retry smart editor';button.title=error.message;document.getElementById('statusMessage').textContent=error.message;}
    finally{loading=false;button.disabled=false;}
  };
  window.VynqodeEditor={sync,get enabled(){return enabled;}};
})();
