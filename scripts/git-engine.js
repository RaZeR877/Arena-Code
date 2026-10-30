import git from 'isomorphic-git';
import FS from '@isomorphic-git/lightning-fs';
import {Buffer} from 'buffer';
import guard from '../public/git-pack-guard.js';
// Git protocol uses bytes only. Credentials are attached by the native transport, never here.
globalThis.Buffer ||= Buffer;
const instances=new Map();
function filesystem(id){if(!instances.has(id))instances.set(id,new FS('vynqode-git-'+id));return instances.get(id);}
const base='/repo';
async function mkdir(fs,path){const parts=path.split('/').filter(Boolean);let current='';for(const part of parts){current+='/'+part;try{await fs.promises.mkdir(current);}catch(e){if(e.code!=='EEXIST')throw e;}}}
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
 for(const [path,text]of Object.entries(normalized.files)){await mkdir(fs,(base+'/'+path).split('/').slice(0,-1).join('/'));await fs.promises.writeFile(base+'/'+path,text,'utf8');await git.add({fs,dir:base,filepath:path});}
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
window.VynqodeGit=Object.freeze({
 async init(source){const repo={id:crypto.randomUUID(),name:source.name,managed:[],remote:null};const fs=filesystem(repo.id);await mkdir(fs,base);await git.init({fs,dir:base,defaultBranch:'main'});await copy(repo,source);return repo;},
 async clone(value,onProgress){const url=remoteURL(value),repo={id:crypto.randomUUID(),name:new URL(url).pathname.split('/').pop().replace(/\.git$/,''),remote:url,managed:[]};const fs=filesystem(repo.id);await mkdir(fs,base);await git.clone({fs,http,dir:base,url,depth:1,singleBranch:true,onProgress:event=>onProgress?.(event.phase)});const loaded=await project(repo);repo.managed=loaded.managed;return {repo,...loaded};},
 async status(repo){return git.statusMatrix({fs:filesystem(repo.id),dir:base});},
 async log(repo){try{return await git.log({fs:filesystem(repo.id),dir:base,depth:12});}catch(error){if(error.code==='NotFoundError')return [];throw error;}},
 async commit(repo,source,message,author){if(!message.trim()||!author.name.trim()||!/^\S+@\S+\.\S+$/.test(author.email))throw Error('Provide a commit message, author name and email');await copy(repo,source);const oid=await git.commit({fs:filesystem(repo.id),dir:base,message:message.trim(),author:{name:author.name.trim(),email:author.email.trim()}});return {repo,oid};},
 async push(repo){if(!repo.remote)throw Error('This repository has no remote. Clone a GitHub repository first.');return git.push({fs:filesystem(repo.id),http,dir:base,remote:'origin'});},
 project,remoteURL
});
