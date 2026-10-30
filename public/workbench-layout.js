/* Pointer and keyboard resizing; preferences are clamped to keep the editor usable. */
(() => {
 'use strict';
 const layout=document.querySelector('.ide-layout'),left=document.getElementById('filesPanel'),right=document.getElementById('assistantPanel');
 const handles=[];let widths=null;
 try{const saved=JSON.parse(localStorage.getItem('vynqode-panel-widths'));if(saved&&Number.isFinite(saved.left)&&Number.isFinite(saved.right))widths=saved;}catch{}
 function apply(){
  if(innerWidth<=800){layout.style.gridTemplateColumns='';return;}
  if(!widths)return;
  const rail=document.querySelector('.activity-rail').getBoundingClientRect().width||44;
  const room=Math.max(340,layout.clientWidth-rail-34-240);
  widths.left=Math.max(120,Math.min(400,room-220,widths.left));widths.right=Math.max(220,Math.min(500,room-widths.left,widths.right));
  layout.style.gridTemplateColumns=rail+'px '+widths.left+'px minmax(0,1fr) '+widths.right+'px';
  for(const h of handles)h.setAttribute('aria-valuenow',Math.round(widths[h.dataset.side]));
 }
 function save(){try{localStorage.setItem('vynqode-panel-widths',JSON.stringify(widths));}catch{}}
 for(const [side,panel] of [['left',left],['right',right]]){
  const handle=document.createElement('div');handle.className='panel-resizer '+side;handle.dataset.side=side;handle.tabIndex=0;handle.role='separator';handle.setAttribute('aria-label','Resize '+(side==='left'?'file explorer':'AI assistant'));handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-valuemin',side==='left'?'120':'220');handle.setAttribute('aria-valuemax',side==='left'?'400':'500');handle.setAttribute('aria-valuenow',Math.round(panel.getBoundingClientRect().width));
  let drag=null;
  function measure(){widths ||= {left:left.getBoundingClientRect().width,right:right.getBoundingClientRect().width};}
  handle.onpointerdown=event=>{if(innerWidth<=800)return;event.preventDefault();measure();drag={x:event.clientX,width:widths[side]};handle.setPointerCapture(event.pointerId);};
  handle.onpointermove=event=>{if(!drag)return;widths[side]=drag.width+(event.clientX-drag.x)*(side==='left'?1:-1);apply();};
  handle.onpointerup=()=>{drag=null;save();};handle.onpointercancel=()=>{drag=null;save();};
  handle.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;event.preventDefault();measure();if(event.key==='Home'){widths=null;layout.style.gridTemplateColumns='';try{localStorage.removeItem('vynqode-panel-widths');}catch{}return;}widths[side]+=(event.key==='ArrowRight'?10:-10)*(side==='left'?1:-1);apply();save();};
  handles.push(handle);panel.append(handle);
 }
 addEventListener('resize',apply);apply();
})();
