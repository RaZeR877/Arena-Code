import git from 'isomorphic-git';
import FS from '@isomorphic-git/lightning-fs';
import {Buffer} from 'buffer';
import guard from '../public/git-pack-guard.js';
import {diffLines} from 'diff';
// Git protocol uses bytes only. Credentials are attached by the native transport, never here.
globalThis.Buffer ||= Buffer;
const instances=new Map();
function filesystem(id){if(!instances.has(id))instances.set(id,new FS('vynqode-git-'+id));return instances.get(id);}
const base='/repo';
async function mkdir(fs,path){const parts=path.split('/').filter(Boolean);let current='';for(const part of parts){current+='/'+part;try{await fs.promises.mkdir(current);}catch(e){if(e.code!=='EEXIST')throw e;const stat=await fs.promises.lstat(current);if(!stat.isDirectory())throw Error('Git parent path is not a directory');}}}
async function project(repo){
 const fs=filesystem(repo.id),files=Object.create(null),omitted=[];let total=0;
 async function walk(directory,prefix=''){
  for(const name of await fs.promises.readdir(directory)){if(name==='.git')continue;const path=prefix+name;try{window.ArenaBrowserCore.safePath(path);}catch{omitted.push(path);continue;}const stat=await fs.promises.lstat(directory+'/'+name);if(stat.isDirectory()){await walk(directory+'/'+name,path+'/');continue;}if(!stat.isFile()||stat.size>window.ArenaBrowserCore.MAX_FILE_BYTES){omitted.push(path);continue;}try{const data=await fs.promises.readFile(directory+'/'+name);const text=new TextDecoder('utf-8',{fatal:true}).decode(data);if(text.includes('\0'))throw Error('binary');total+=data.length;if(Object.keys(files).length>=100||total>window.ArenaBrowserCore.MAX_TOTAL_BYTES)throw Error('budget');files[path]=text;}catch(error){if(error.message==='budget')throw Error('Repository exceeds the 100-file / 3 MiB workspace limit');omitted.push(path);}}
 }
 await walk(base);return {project:window.ArenaBrowserCore.normalize({name:repo.name,files}),managed:Object.keys(files),omitted};
}
async function copy(repo,source){
 const normalized=window.ArenaBrowserCore.normalize(source),fs=filesystem(repo.id);
 for(const path of repo.managed||[])if(!Object.hasOwn(normalized.files,path)){try{await fs.promises.unlink(base+'/'+path);}catch(e){if(e.code!=='ENOENT')throw e;}try{await git.remove({fs,dir:base,filepath:path});}catch(e){if(e.code!=='NotFoundError')throw e;}}
 for(const [path,text]of Object.entries(normalized.files)){await mkdir(fs,(base+'/'+path).split('/').slice(0,-1).join('/'));try{const stat=await fs.promises.lstat(base+'/'+path);if(!stat.isFile())throw Error('Refusing to overwrite a non-regular Git path: '+path);}catch(e){if(e.code!=='ENOENT')throw e;}await fs.promises.writeFile(base+'/'+path,text,'utf8');await git.add({fs,dir:base,filepath:path});}
 repo.managed=Object.keys(normalized.files);return repo;
}
function remoteURL(value){const url=new URL(value);if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||url.search||url.hash||url.port||!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(url.pathname))throw Error('Use a GitHub HTTPS repository URL without credentials');return url.href.replace(/\.git$/,'')+'.git';}
const http={async request({url,method='GET',body}){
 if(!window.VynqodeNative?.available)throw Error('Remote Git transport is available in the Android app. Local Git history works offline everywhere.');
 const chunks=[];let size=0;if(body)for await(const chunk of body){size+=chunk.length;if(size>16*1024*1024)throw Error('Git upload exceeds 16 MiB');chunks.push(chunk);}
 const data=Buffer.concat(chunks.map(chunk=>Buffer.from(chunk)));const response=await window.VynqodeNative.gitRequest({url,method,body:data.toString('base64')});const bytes=Buffer.from(response.body,'base64');
 if(response.statusCode===200&&method==='POST'&&url.endsWith('/git-upload-pack'))guard.verify(bytes);
 return {url,method,statusCode:response.statusCode,statusMessage:String(response.statusCode),headers:response.headers,body:(async function*(){yield bytes;})()};
}};
const locks=new Set();
async function exclusive(repo,operation){if(locks.has(repo.id))throw Error('This Git working copy is busy');locks.add(repo.id);try{return await operation();}finally{try{await filesystem(repo.id).promises.flush();}finally{locks.delete(repo.id);}}}
function author(value){if(!value?.name?.trim()||!/^\S+@\S+\.\S+$/.test(value.email||''))throw Error('Provide an author name and email');return {name:value.name.trim(),email:value.email.trim()};}
async function hydrate(repo){try{repo.merge=JSON.parse(await filesystem(repo.id).promises.readFile(base+'/.git/vynqode-merge.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;delete repo.merge;}}
async function clearMerge(repo){try{await filesystem(repo.id).promises.unlink(base+'/.git/vynqode-merge.json');}catch(error){if(error.code!=='ENOENT')throw error;}delete repo.merge;}
function noMerge(repo){if(repo.merge)throw Error('Resolve or abort the pending merge first');}
async function clean(repo){await hydrate(repo);noMerge(repo);const rows=await git.statusMatrix({fs:filesystem(repo.id),dir:base});if(rows.some(([,head,work,stage])=>head!==work||head!==stage))throw Error('Commit the Git working copy before changing branches or merging');}
async function branch(repo){const value=await git.currentBranch({fs:filesystem(repo.id),dir:base});if(!value)throw Error('Select a named branch first');return value;}
async function recovery(repo){const fs=filesystem(repo.id),ours=await branch(repo),oid=await git.resolveRef({fs,dir:base,ref:ours}),ref='recovery/'+Date.now()+'-'+crypto.randomUUID().slice(0,8);await git.branch({fs,dir:base,ref,object:oid});return {branch:ours,ours:oid,recovery:ref};}
async function restore(repo,state){const fs=filesystem(repo.id);await git.writeRef({fs,dir:base,ref:'refs/heads/'+state.branch,value:state.ours,force:true});await git.checkout({fs,dir:base,ref:state.branch,force:true});}
async function merge(repo,theirs,identity){
 await clean(repo);const fs=filesystem(repo.id),state=await recovery(repo);state.theirs=await git.resolveRef({fs,dir:base,ref:theirs});
 try{
  const result=await git.merge({fs,dir:base,ours:state.branch,theirs,author:author(identity),abortOnConflict:false});
  await git.checkout({fs,dir:base,ref:state.branch,force:true});const loaded=await project(repo);repo.managed=loaded.managed;
  return {repo,...result,recovery:state.recovery,conflicts:[]};
 }catch(error){
  if(error.code==='MergeConflictError'){
   const paths=error.data.filepaths;const loaded=await project(repo);
   if(paths.some(path=>!Object.hasOwn(loaded.project.files,path))){await restore(repo,state);throw Error('A conflict involves an unsupported file. Merge aborted; recovery branch: '+state.recovery);}
   repo.merge={...state,conflicts:paths};await fs.promises.writeFile(base+'/.git/vynqode-merge.json',JSON.stringify(repo.merge),'utf8');repo.managed=loaded.managed;return {repo,conflicts:paths,recovery:state.recovery};
  }
  try{await restore(repo,state);}catch{throw Error('Git merge recovery needs attention. Reopen recovery branch '+state.recovery);}
  throw error;
 }
}
async function diff(repo,source){
 const normalized=window.ArenaBrowserCore.normalize(source),fs=filesystem(repo.id),changes=[];
 let head;try{head=await git.resolveRef({fs,dir:base,ref:'HEAD'});}catch(error){if(error.code!=='NotFoundError')throw error;}
 const names=new Set([...(repo.managed||[]),...Object.keys(normalized.files)]);
 for(const path of [...names].sort()){
  let before='';if(head)try{const blob=await git.readBlob({fs,dir:base,oid:head,filepath:path});if(blob.blob.length>400*1024)continue;before=new TextDecoder('utf-8',{fatal:true}).decode(blob.blob);if(before.includes('\0'))continue;}catch(error){if(error.code!=='NotFoundError')throw error;}
  const after=normalized.files[path]??'';if(before===after&&Object.hasOwn(normalized.files,path))continue;
  changes.push({path,deleted:!Object.hasOwn(normalized.files,path),parts:diffLines(before,after,{timeout:200,maxEditLength:2000})||[{removed:true,value:before},{added:true,value:after}]});
 }
 return changes;
}
window.VynqodeGit=Object.freeze({
 async init(source){const repo={id:crypto.randomUUID(),name:source.name,managed:[],remote:null};const fs=filesystem(repo.id);await mkdir(fs,base);await git.init({fs,dir:base,defaultBranch:'main'});await copy(repo,source);await fs.promises.flush();return repo;},
 async clone(value,onProgress){const url=remoteURL(value),repo={id:crypto.randomUUID(),name:new URL(url).pathname.split('/').pop().replace(/\.git$/,''),remote:url,managed:[]};const fs=filesystem(repo.id);await mkdir(fs,base);try{await git.clone({fs,http,dir:base,url,singleBranch:true,onProgress:event=>onProgress?.(event.phase)});const loaded=await project(repo);repo.managed=loaded.managed;await fs.promises.flush();return {repo,...loaded};}catch(error){try{await fs.init('vynqode-git-'+repo.id,{wipe:true});await fs.promises.readdir('/');await fs.promises.flush();instances.delete(repo.id);}catch{}throw error;}},
 async status(repo){await hydrate(repo);return git.statusMatrix({fs:filesystem(repo.id),dir:base});},
 async branches(repo){await hydrate(repo);const fs=filesystem(repo.id);return {current:await git.currentBranch({fs,dir:base}),local:await git.listBranches({fs,dir:base})};},
 createBranch(repo,ref){return exclusive(repo,async()=>{await clean(repo);await git.branch({fs:filesystem(repo.id),dir:base,ref});return repo;});},
 checkout(repo,ref){return exclusive(repo,async()=>{await clean(repo);const fs=filesystem(repo.id),previous=await branch(repo);if(!(await git.listBranches({fs,dir:base})).includes(ref))throw Error('Select an existing local branch');try{await git.checkout({fs,dir:base,ref});const loaded=await project(repo);repo.managed=loaded.managed;return repo;}catch(error){await git.checkout({fs,dir:base,ref:previous,force:true});throw error;}});},
 merge(repo,ref,identity){return exclusive(repo,()=>merge(repo,ref,identity));},
 pull(repo,identity){return exclusive(repo,async()=>{await clean(repo);if(!repo.remote)throw Error('This Git copy has no remote');const ref=await branch(repo);await git.fetch({fs:filesystem(repo.id),http,dir:base,remote:'origin',ref,singleBranch:true});return merge(repo,'refs/remotes/origin/'+ref,identity);});},
 abortMerge(repo){return exclusive(repo,async()=>{await hydrate(repo);if(!repo.merge)throw Error('No pending merge');await restore(repo,repo.merge);await clearMerge(repo);const loaded=await project(repo);repo.managed=loaded.managed;return repo;});},
 async log(repo){try{return await git.log({fs:filesystem(repo.id),dir:base,depth:12});}catch(error){if(error.code==='NotFoundError')return [];throw error;}},
 commit(repo,source,message,identity){return exclusive(repo,async()=>{await hydrate(repo);if(!message?.trim())throw Error('Provide a commit message');const who=author(identity),fs=filesystem(repo.id);let parent;
  if(repo.merge){if(await branch(repo)!==repo.merge.branch||await git.resolveRef({fs,dir:base,ref:'HEAD'})!==repo.merge.ours)throw Error('Merge base changed. Abort and restart the merge');for(const text of Object.values(source.files))if(/^(?:<{7}|={7}|>{7})(?: |$)/m.test(text))throw Error('Resolve all conflict markers before committing');parent=[repo.merge.ours,repo.merge.theirs];}
  await copy(repo,source);const oid=await git.commit({fs,dir:base,message:message.trim(),author:who,...(parent?{parent}:{})});await clearMerge(repo);return {repo,oid};});},
 push(repo){return exclusive(repo,async()=>{await hydrate(repo);noMerge(repo);if(!repo.remote)throw Error('This repository has no remote. Clone a GitHub repository first.');return git.push({fs:filesystem(repo.id),http,dir:base,remote:'origin'});});},
 diff,project,remoteURL
});
