/* Phone navigation and keyboard-aware chrome. No project storage or execution here. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),mobile=matchMedia('(max-width:800px), (pointer:coarse) and (max-width:1100px)'),api=window.Vynqode;
  let expandedHeight=innerHeight,lastWidth=innerWidth;
  function viewport(){
    const height=window.visualViewport&&visualViewport.scale===1?visualViewport.height:innerHeight;
    if(Math.abs(innerWidth-lastWidth)>60){expandedHeight=height;lastWidth=innerWidth;}
    expandedHeight=Math.max(expandedHeight,height);
    const editing=document.activeElement?.matches('textarea,input,[contenteditable="true"]');
    document.body.classList.toggle('keyboard-open',mobile.matches&&Boolean(editing)&&expandedHeight-height>120);
    document.documentElement.style.setProperty('--phone-height',height+'px');
  }
  function text(id,value){if($(id).textContent!==value)$(id).textContent=value;}
  function state(){
    const value=window.VynqodeWorkspaceUI.saveState();
    text('phoneSaveStatus',value.target+' · '+(value.dirty?'Unsaved':'Saved'));
    text('saveFile',value.linked?'Save file':'Save in app');
    $('saveFile').title=value.linked?'Write changes to your linked device folder':'Save this project inside Vynqode app storage';
    text('phoneMenuProject',api.getProjectName()+' · '+value.target);$('projectName').setAttribute('aria-label',mobile.matches?'Open projects: '+api.getProjectName():'Rename current project');
    if(mobile.matches){const preview=$('editorSurface').classList.contains('hidden');document.body.classList.toggle('phone-preview',preview);text('runPreview',preview?'Edit code':'▶ Preview');}
    if(mobile.matches&&$('statusMessage').dataset.error!=='true')text('statusMessage',value.target+' · '+(value.dirty?'Changes pending':'Saved'));
  }
  const runPreview=$('runPreview').onclick;
  $('runPreview').onclick=()=>mobile.matches&&$('editorSurface').classList.contains('hidden')?$('editorTab').click():runPreview();
  $('phoneMore').onclick=()=>{state();$('phoneEngineAction').textContent=window.VynqodeEditor.engine==='smart'?'Use touch editor':'Use desktop editor';$('phoneMenu').showModal();};
  $('closePhoneMenu').onclick=()=>$('phoneMenu').close();
  for(const button of document.querySelectorAll('[data-phone-action]'))button.onclick=()=>{$('phoneMenu').close();$(button.dataset.phoneAction).click();};
  for(const button of document.querySelectorAll('[data-phone-insert]'))button.onclick=()=>{$('phoneMenu').close();window.VynqodeEditor.insert(button.dataset.phoneInsert);};
  const openProject=$('projectName').onclick;
  $('projectName').onclick=()=>mobile.matches?$('openProjects').click():openProject();
  document.querySelector('.brand').addEventListener('click',event=>{if(mobile.matches){event.preventDefault();$('openProjects').click();}});
  function notify(message){if(!mobile.matches)return;$('phoneNoticeText').textContent=message;if(!$('phoneNotice').open)$('phoneNotice').showModal();}
  $('closePhoneNotice').onclick=()=>$('phoneNotice').close();
  function back(){
    const dialogs=[...document.querySelectorAll('dialog[open]')],dialog=dialogs.at(-1);
    if(dialog){const event=new Event('cancel',{cancelable:true});if(dialog.dispatchEvent(event))dialog.close();return true;}
    if(document.querySelector('.ide-layout').dataset.section!=='editor'){api.setSection('editor');return true;}
    if($('editorSurface').classList.contains('hidden')){$('editorTab').click();return true;}
    api.flushDraft();api.rememberPosition();return false;
  }
  window.addEventListener('vynqode:state',state);window.addEventListener('resize',viewport);
  visualViewport?.addEventListener('resize',viewport);document.addEventListener('focusin',viewport);document.addEventListener('focusout',()=>setTimeout(viewport,0));
  mobile.addEventListener('change',()=>{viewport();state();});
  $('openProjects').setAttribute('aria-label','Projects and device folders');
  window.VynqodePhone={back,notify};viewport();state();
})();
