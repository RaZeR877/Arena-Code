'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

test('GitHub Pages build is self-contained, subpath-safe, and excludes the private backend', () => {
  const build = spawnSync(process.execPath, [path.join(root, 'scripts/build-pages.cjs')], { cwd: root, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const dir = path.join(root, 'dist', 'pages');
  const entries = fs.readdirSync(dir);
  assert.deepEqual(entries.sort(), [
    '.nojekyll', 'app.js', 'ai-workflow.js', 'browser-core.js', 'browser-workspace.js', 'index.html', 'model-catalog.js', 'pages-static.css', 'pages-static.js',
    'robots.txt', 'studio.css', 'studio.js', 'style.css', 'templates.js'
  ].sort());
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(html, /src="\.\/pages-static\.js"/);
  assert.match(html, /src="\.\/studio\.js"/);
  assert.match(html, /href="\.\/style\.css"/);
  assert.doesNotMatch(html, /(?:src|href)="\//);
  assert.match(html, /src="\.\/browser-workspace\.js"/);
  assert.match(html, /src="\.\/ai-workflow\.js"/);
  assert.match(html, /src="\.\/model-catalog\.js"/);
  assert.doesNotMatch(html, /src="\.\/workspace\.js"|editor\.js/);
  for (const file of ['app.js', 'studio.js', 'templates.js']) {
    assert.ok(fs.statSync(path.join(dir, file)).size > 1000, `Missing ${file}`);
  }
  assert.ok(!entries.some(p => /\.env|server|runner|hosted|package\.json|key/i.test(p)));
});

test('Pages mode routes demo chat/status locally and fails closed for server-only APIs', async () => {
  const script = fs.readFileSync(path.join(root, 'pages', 'pages-static.js'), 'utf8');
  let nativeCalls = 0;
  const memory = new Map();
  const storage = {
    getItem: k => memory.has(k) ? memory.get(k) : null,
    setItem: (k, v) => memory.set(k, String(v))
  };
  const context = {
    window: { fetch: async () => { nativeCalls++; return new Response('ok'); } },
    localStorage: storage,
    location: { href: 'https://razer877.github.io/Arena-Code/' },
    Response,
    Request,
    URL,
    document: { addEventListener() {} }
  };
  vm.runInNewContext(script, context);
  assert.equal(storage.getItem('ac-source'), 'demo');
  const status = await context.window.fetch('/api/status');
  const parsed = await status.json();
  assert.equal(parsed.demo, true);
  assert.equal(parsed.staticPages, true);
  assert.equal(parsed.features.serverProjects, false);
  assert.equal(parsed.features.browserProjects, true);
  const chat = await context.window.fetch('/api/chat', { method: 'POST' });
  assert.equal((await chat.json()).demo, true);
  const denied = await context.window.fetch('/api/projects');
  assert.equal(denied.status, 503);
  assert.match((await denied.json()).error, /Node\.js backend/);
  assert.equal(nativeCalls, 0);
  await context.window.fetch('./style.css');
  assert.equal(nativeCalls, 1);
});
