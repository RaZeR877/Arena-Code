'use strict';
// Copy Monaco's browser assets into the app image so production does not depend on a CDN.
const fs = require('node:fs');
const path = require('node:path');
const source = path.resolve(__dirname, '..', 'node_modules', 'monaco-editor', 'min', 'vs');
const target = path.resolve(__dirname, '..', 'public', 'vendor', 'monaco', 'vs');
if (!fs.existsSync(path.join(source, 'loader.js'))) {
  console.error('Monaco assets not found. Install dependencies before packaging Arena Code.');
  process.exitCode = 1;
} else {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, dereference: true });
  console.log('Copied Monaco Editor assets to public/vendor/monaco/vs.');
}
