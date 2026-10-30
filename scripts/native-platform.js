import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
window.VynqodeTerminal={Terminal,FitAddon};
import { diffLines } from 'diff';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
window.VynqodeDiff = (before,after)=>diffLines(before,after,{timeout:200,maxEditLength:2000});
window.VynqodeNative = Object.freeze({
  available: Capacitor.isNativePlatform(),
  async exportZip(blob, name) {
    if (!Capacitor.isNativePlatform()) throw Error('Native export is unavailable in the browser');
    const bytes=new Uint8Array(await blob.arrayBuffer());
    let binary='';
    for(let at=0;at<bytes.length;at+=8192)binary+=String.fromCharCode(...bytes.subarray(at,at+8192));
    const path='exports/'+name;
    const file=await Filesystem.writeFile({path,data:btoa(binary),directory:Directory.Cache,recursive:true});
    try{const result=await Share.share({title:name,files:[file.uri],dialogTitle:'Export Vynqode project'});if(Capacitor.getPlatform()==='android'&&!result.activityType)return {cancelled:true};return {shared:true};}
    catch(error){if(error.message==='Share canceled')return {cancelled:true};throw error;}
  }
});
