#!/usr/bin/env node
/* Vynqode static-only IDE. Never include server, credentials or legacy battle UI. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist', 'pages');
const files = [
  ['public/index.html','index.html'],['public/ide.css','ide.css'],['public/ide.js','ide.js'],
  ['public/favicon.svg','favicon.svg'],['public/model-catalog.js','model-catalog.js'],
  ['pages/browser-core.js','browser-core.js'],['pages/ai-workflow.js','ai-workflow.js']
];
fs.rmSync(out, { recursive:true, force:true });
fs.mkdirSync(out,{recursive:true});
for (const [source,dest] of files) fs.copyFileSync(path.join(root,source),path.join(out,dest));
const html = fs.readFileSync(path.join(out,'index.html'),'utf8');
if (/(?:href|src)="\//.test(html)) throw Error('GitHub Pages requires relative asset links');
if (/battle mode|leaderboard|compare models/i.test(html)) throw Error('Legacy game/comparison UI appeared in focused IDE');
fs.writeFileSync(path.join(out,'.nojekyll'),'');
fs.writeFileSync(path.join(out,'robots.txt'),'User-agent: *\nAllow: /\n');
console.log('Built Vynqode GitHub Pages IDE ('+fs.readdirSync(out).length+' files)');
