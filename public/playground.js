/* Untrusted JavaScript runs inside memory/instruction-limited QuickJS in a disposable worker. */
(() => {
 'use strict';let active=null;
 function run(project,entry,testing=false){
  stop();return new Promise(resolve=>{
   const worker=new Worker(new URL('./playground-worker.js',document.baseURI)),session={worker,resolve,timer:null};active=session;
   const finish=result=>{if(active!==session)return;clearTimeout(session.timer);worker.terminate();active=null;resolve({...result,backend:'quickjs',entry});};
   session.timer=setTimeout(()=>finish({ok:false,code:1,assertions:0,tests:0,output:'Execution/loading timed out; worker terminated.'}),15000);
   worker.onmessage=event=>finish(event.data);worker.onerror=()=>finish({ok:false,code:1,assertions:0,tests:0,output:'JavaScript VM could not load or failed. Rebuild bundled assets.'});
   worker.postMessage({files:project.files,entry,testing});
  });
 }
 function stop(){if(active){clearTimeout(active.timer);active.worker.terminate();active.resolve({ok:false,code:1,backend:'quickjs',assertions:0,tests:0,output:'Execution cancelled.'});active=null;}}
 window.VynqodePlayground={run,stop};
})();
