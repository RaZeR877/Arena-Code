#!/usr/bin/env node
/* Vynqode static-only IDE. Never include server, credentials or legacy battle UI. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist', 'pages');
const files = [
  ['public/webview-required.html','webview-required.html'],['public/index.html','index.html'],['public/ide.css','ide.css'],['public/workbench.css','workbench.css'],['public/ide.js','ide.js'],
  ['public/workbench-layout.js','workbench-layout.js'],['public/runtime-tools.js','runtime-tools.js'],['public/project-library.js','project-library.js'],['public/smart-editor.js','smart-editor.js'],['public/favicon.svg','favicon.svg'],['public/model-catalog.js','model-catalog.js'],['public/cloud-bridge.js','cloud-bridge.js'],
  ['pages/browser-core.js','browser-core.js'],['pages/ai-workflow.js','ai-workflow.js']
];
fs.rmSync(out, { recursive:true, force:true });
fs.mkdirSync(out,{recursive:true});
for (const [source,dest] of files) fs.copyFileSync(path.join(root,source),path.join(out,dest));
const vendor=path.join(root,'public/vendor/monaco');
if(!fs.existsSync(path.join(vendor,'vs/loader.js')))throw Error('Run npm ci to install bundled Monaco assets before building.');
fs.cpSync(vendor,path.join(out,'vendor/monaco'),{recursive:true});
require('./build-native.cjs')(path.join(out,'native-platform.js'));
const html = fs.readFileSync(path.join(out,'index.html'),'utf8');
if (/(?:href|src)="\//.test(html)) throw Error('GitHub Pages requires relative asset links');
if (/battle mode|leaderboard|compare models/i.test(html)) throw Error('Legacy game/comparison UI appeared in focused IDE');
fs.writeFileSync(path.join(out,'.nojekyll'),'');
fs.writeFileSync(path.join(out,'robots.txt'),'User-agent: *\nAllow: /\n');
console.log('Built Vynqode GitHub Pages IDE ('+fs.readdirSync(out).length+' files)');
