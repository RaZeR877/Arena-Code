/* Reject oversized Git objects before the Git library inflates/checks them out. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('pako'));})(typeof globalThis==='undefined'?null:globalThis,function(pako){
 'use strict';
 function word(bytes,at){return String.fromCharCode(...bytes.subarray(at,at+4));}
 function packFromResponse(bytes){
  let at=0;const chunks=[];let length=0;
  while(at<bytes.length){if(word(bytes,at)==='PACK')return bytes.subarray(at);const header=word(bytes,at);if(!/^[0-9a-f]{4}$/i.test(header))throw Error('Invalid Git packet');const size=parseInt(header,16);at+=4;if(size<=2)continue;if(size<4||at+size-4>bytes.length)throw Error('Truncated Git packet');const data=bytes.subarray(at,at+size-4);at+=size-4;if(data[0]===1){chunks.push(data.subarray(1));length+=data.length-1;}else if(data[0]===3)throw Error('Git server rejected the request');}
  if(!length)return null;const result=new Uint8Array(length);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
 }
 function verify(bytes){
  const pack=packFromResponse(bytes);if(!pack)return;
  if(word(pack,0)!=='PACK'||pack.length<32)throw Error('Invalid Git pack');const view=new DataView(pack.buffer,pack.byteOffset,pack.byteLength),version=view.getUint32(4),count=view.getUint32(8);
  if(![2,3].includes(version)||count>2000)throw Error('Git repository has too many objects');let at=12,total=0;
  for(let object=0;object<count;object++){
   if(at>=pack.length-20)throw Error('Truncated Git object');let byte=pack[at++],type=(byte>>4)&7,size=byte&15,shift=4;
   while(byte&128){if(at>=pack.length||shift>28)throw Error('Invalid Git object size');byte=pack[at++];size+=(byte&127)*2**shift;shift+=7;}
   if(size>512*1024||![1,2,3,4,6,7].includes(type))throw Error('Git object exceeds mobile workspace limits');
   if(type===6){do{if(at>=pack.length)throw Error('Truncated delta reference');byte=pack[at++];}while(byte&128);}else if(type===7)at+=20;
   if(at+2>=pack.length)throw Error('Truncated compressed object');const cmf=pack[at],flg=pack[at+1];if((cmf&15)!==8||((cmf<<8)+flg)%31||flg&32)throw Error('Unsupported Git compression');
   const inflater=new pako.Inflate({raw:true,chunkSize:16384});let inflated=0,prefix=[];
   inflater.onData=data=>{inflated+=data.length;if(inflated>512*1024)throw Error('Inflated Git object exceeds limit');if(prefix.length<24)prefix.push(...data.subarray(0,24-prefix.length));};
   inflater.push(pack.subarray(at+2),false);if(inflater.err||!inflater.ended||inflated!==size)throw Error('Invalid compressed Git object');
   if(type===6||type===7){let p=0;const number=()=>{let value=0,bits=0,next;do{if(p>=prefix.length||bits>28)throw Error('Invalid delta size');next=prefix[p++];value+=(next&127)*2**bits;bits+=7;}while(next&128);return value;};const base=number(),target=number();if(base>512*1024||target>400*1024)throw Error('Reconstructed Git file exceeds 400 KiB');total+=target;}
   else{if(type===3&&size>400*1024)throw Error('Git file exceeds 400 KiB');total+=size;}
   if(total>8*1024*1024)throw Error('Expanded Git repository exceeds mobile limits');at+=2+inflater.strm.next_in+4;
  }
  if(at+20!==pack.length)throw Error('Unexpected Git pack trailing data');
 }
 return {verify,packFromResponse};
});
