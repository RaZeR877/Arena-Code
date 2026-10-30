/* Local snapshots use IndexedDB so large projects do not consume localStorage's small quota. */
(() => {
  'use strict';
  let database;
  function open(){return database ||= new Promise((resolve,reject)=>{const request=indexedDB.open('vynqode-library',1);request.onupgradeneeded=()=>request.result.createObjectStore('snapshots',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  async function transaction(mode,action){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('snapshots',mode),request=action(tx.objectStore('snapshots'));tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Project storage transaction aborted'));});}
  window.VynqodeLibrary=Object.freeze({
    async save(project){const normalized=window.ArenaBrowserCore.normalize(project);const entries=await this.list();if(entries.length>=25)throw Error('Snapshot limit reached. Export and remove an older snapshot first.');return transaction('readwrite',store=>store.put({id:crypto.randomUUID(),savedAt:new Date().toISOString(),project:normalized}));},
    async list(){const rows=await transaction('readonly',store=>store.getAll());return rows.sort((a,b)=>b.savedAt.localeCompare(a.savedAt));},
    remove(id){return transaction('readwrite',store=>store.delete(id));}
  });
})();
