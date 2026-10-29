#!/usr/bin/env node
/* Create a GitHub Pages-safe, standalone browser showcase. No server code or secrets are published. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist', 'pages');
const source = path.join(root, 'public');
const files = ['index.html', 'style.css', 'studio.css', 'app.js', 'studio.js', 'templates.js', 'model-catalog.js'];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const file of files) fs.copyFileSync(path.join(source, file), path.join(out, file));
let html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
// GitHub Pages project sites are served under /<repository>/, never the domain root.
html = html.replace(/(href|src)="\/(style\.css|studio\.css|app\.js|templates\.js|studio\.js|model-catalog\.js)"/g, '$1="./$2"');
html = html.replace(/href="\/"/g, 'href="./"');
html = html.replaceAll('href="https://github.com"', 'href="https://github.com/RaZeR877/Arena-Code"');
html = html.replace('<script src="./app.js"></script>', '<script src="./pages-static.js"></script><script src="./app.js"></script>');
html = html.replace('<script src="/editor.js"></script><script src="/workspace.js"></script>', '');
if (html.includes('src="/')) throw new Error('Found a root-relative script; GitHub Pages asset paths would break');
if (html.includes('href="/')) throw new Error('Found a root-relative link; GitHub Pages asset paths would break');
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.copyFileSync(path.join(root, 'pages', 'pages-static.js'), path.join(out, 'pages-static.js'));
fs.copyFileSync(path.join(root, 'pages', 'pages-static.css'), path.join(out, 'pages-static.css'));
for (const file of ['browser-core.js', 'ai-workflow.js', 'browser-workspace.js']) fs.copyFileSync(path.join(root, 'pages', file), path.join(out, file));
html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
html = html.replace('<script src="./studio.js"></script>', '<script src="./studio.js"></script><script src="./browser-core.js"></script><script src="./ai-workflow.js"></script><script src="./browser-workspace.js"></script>');
fs.writeFileSync(path.join(out, 'index.html'), html);
html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="./studio.css">', '<link rel="stylesheet" href="./studio.css"><link rel="stylesheet" href="./pages-static.css">');
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nAllow: /\n');
console.log('GitHub Pages static build prepared in dist/pages with ' + fs.readdirSync(out).length + ' files');
