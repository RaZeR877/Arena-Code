'use strict';
const fs=require('node:fs'),path=require('node:path');
function build(directory){fs.mkdirSync(directory,{recursive:true});require('esbuild').buildSync({entryPoints:[path.join(__dirname,'playground-worker.js')],bundle:true,platform:'browser',format:'iife',outfile:path.join(directory,'playground-worker.js'),minify:true});fs.copyFileSync(require.resolve('@jitl/quickjs-wasmfile-release-sync/wasm'),path.join(directory,'quickjs.wasm'));}
module.exports=build;if(require.main===module)build(path.join(__dirname,'../public'));
