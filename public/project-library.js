/* Local snapshots and resumable review records. Schema upgrades preserve existing snapshots. */
(() => {
 'use strict';let database;
 function open(){return database ||= new Promise((resolve,reject)=>{
  let blocked=false;const request=indexedDB.open('vynqode-library',2);
  request.onupgradeneeded=()=>{for(const name of ['snapshots','jobs','repos'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'id'});};
  request.onsuccess=()=>{if(blocked){request.result.close();return;}request.result.onversionchange=()=>{request.result.close();database=null;};resolve(request.result);};
  request.onerror=()=>{database=null;reject(request.error);};request.onblocked=()=>{blocked=true;database=null;reject(Error('Close other Vynqode tabs before upgrading project storage.'));};
 });}
 async function transaction(store,mode,action){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode),request=action(tx.objectStore(store));tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Project storage transaction aborted'));});}
 const api={
  async save(project){const normalized=window.ArenaBrowserCore.normalize(project);const entries=await this.list();if(entries.filter(row=>row.kind!=='auto').length>=25)throw Error('Snapshot limit reached. Export and remove an older snapshot first.');return transaction('snapshots','readwrite',store=>store.put({id:crypto.randomUUID(),savedAt:new Date().toISOString(),project:normalized}));},
  async checkpoint(project){
   const normalized=window.ArenaBrowserCore.normalize(project),identity=window.VynqodeProjectIndex.identity(normalized),entries=await this.list();
   const existing=entries.find(row=>window.VynqodeProjectIndex.identity(row.project)===identity);if(existing)return existing.id;
   const protectedIds=new Set((await this.jobs()).map(job=>job.snapshotId));
   const automatic=entries.filter(row=>row.kind==='auto'&&!protectedIds.has(row.id));
   const remove=automatic.slice(7).map(row=>row.id),record={id:crypto.randomUUID(),kind:'auto',savedAt:new Date().toISOString(),project:normalized};
   const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite'),store=tx.objectStore('snapshots');for(const id of remove)store.delete(id);store.put(record);tx.oncomplete=()=>resolve(record.id);tx.onabort=()=>reject(tx.error||Error('Recovery checkpoint could not be saved'));tx.onerror=()=>reject(tx.error);});
  },
  async list(){const rows=await transaction('snapshots','readonly',store=>store.getAll());return rows.sort((a,b)=>b.savedAt.localeCompare(a.savedAt));},
  remove(id){return transaction('snapshots','readwrite',store=>store.delete(id));},
  async createJob(project,task,model){
   const snapshots=await this.list(),identity=window.VynqodeProjectIndex.identity(project);
   const existing=snapshots.find(row=>window.VynqodeProjectIndex.identity(row.project)===identity);
   const snapshotId=existing?.id||await this.checkpoint(project);
   const job={id:crypto.randomUUID(),snapshotId,projectName:project.name,task:String(task).slice(0,6000),model:String(model||'unknown'),status:'proposing',updatedAt:new Date().toISOString()};await this.putJob(job);return job;
  },
  async putJob(job){const rows=await this.jobs();if(!rows.some(row=>row.id===job.id)&&rows.length>=30){const old=rows.slice().reverse().find(row=>['applied','rejected','failed','cancelled'].includes(row.status));if(!old)throw Error('Task history is full. Remove an older task first.');await this.removeJob(old.id);}return transaction('jobs','readwrite',store=>store.put({...job,updatedAt:new Date().toISOString()}));},
  async jobs(){const rows=await transaction('jobs','readonly',store=>store.getAll());return rows.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));},
  removeJob(id){return transaction('jobs','readwrite',store=>store.delete(id));},
  async repositories(){return transaction('repos','readonly',store=>store.getAll());},
  putRepository(repo){return transaction('repos','readwrite',store=>store.put(repo));}
 };
 window.VynqodeLibrary=Object.freeze(api);
})();
