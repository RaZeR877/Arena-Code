/* Bounded static project index: text search and relative dependency links, no execution. */
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;if(root)root.VynqodeProjectIndex=value;})(typeof globalThis==='undefined'?null:globalThis,()=>{
 'use strict';
 function resolve(files,parent,target){
  if(/^(?:https?:|data:|#|\/\/)/i.test(target))return null;
  const parts=target.startsWith('/')?[]:parent.split('/').slice(0,-1);
  for(const part of target.replace(/[?#].*$/,'').split('/')){if(!part||part==='.')continue;if(part==='..'){if(!parts.length)return null;parts.pop();}else parts.push(part);}
  const path=parts.join('/');return [path,path+'.js',path+'.cjs',path+'.mjs',path+'.ts',path+'.json',path+'/index.js',path+'/index.ts'].find(name=>Object.hasOwn(files,name))||null;
 }
 function build(project){
  const links=new Map(Object.keys(project.files).map(path=>[path,new Set()]));
  for(const [path,text]of Object.entries(project.files)){
   const matches=text.matchAll(/(?:require|import)\s*\(\s*['"]([^'"]+)['"]|(?:from|import)\s*['"]([^'"]+)['"]|(?:src|href)\s*=\s*['"]([^'"]+)['"]/g);
   let count=0;for(const match of matches){if(count++>=500)break;const dependency=resolve(project.files,path,match[1]||match[2]||match[3]);if(dependency&&dependency!==path){links.get(path).add(dependency);links.get(dependency).add(path);}}
  }
  return links;
 }
 function related(project,current,task=''){
  const links=build(project),distance=new Map(),queue=[];
  for(const path of Object.keys(project.files))if(path===current||String(task).includes(path)){distance.set(path,0);queue.push(path);}
  while(queue.length){const path=queue.shift(),depth=distance.get(path);if(depth>=2)continue;for(const neighbor of links.get(path)||[])if(!distance.has(neighbor)){distance.set(neighbor,depth+1);queue.push(neighbor);}}
  return distance;
 }
 function search(project,query,caseSensitive=false,limit=200){
  if(typeof query!=='string'||!query||query.length>200)return [];const results=[];
  const matcher=new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),caseSensitive?'g':'gi');
  for(const [path,content]of Object.entries(project.files).sort(([a],[b])=>a.localeCompare(b))){let offset=0;for(const [index,line]of content.split('\n').entries()){matcher.lastIndex=0;let match;while((match=matcher.exec(line))!==null){const at=match.index;results.push({path,line:index+1,column:at+1,offset:offset+at,length:match[0].length,excerpt:line.slice(Math.max(0,at-35),at+match[0].length+80)});if(results.length>=limit)return results;}offset+=line.length+1;}}
  return results;
 }
 function identity(project){return JSON.stringify([project.name,Object.entries(project.files).sort(([a],[b])=>a.localeCompare(b))]);}
 return Object.freeze({build,related,search,identity});
});
