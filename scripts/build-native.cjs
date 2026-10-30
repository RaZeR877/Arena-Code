'use strict';
const path=require('node:path');
function build(outfile){require('esbuild').buildSync({entryPoints:[path.join(__dirname,'native-platform.js')],bundle:true,platform:'browser',format:'iife',outfile,minify:true});}
module.exports=build;
if(require.main===module)build(path.join(__dirname,'../public/native-platform.js'));
