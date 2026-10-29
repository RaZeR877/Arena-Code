/* Browser-only GitHub Pages edition: no server, secrets, or remote code execution. */
(function () {
  'use strict';
  window.ARENA_STATIC_PAGES = true;
  // The public site defaults to an immediately usable, clearly labeled template demo.
  // Users can opt into on-device AI after confirming their browser supports WebGPU.
  try { if (!localStorage.getItem('ac-source')) localStorage.setItem('ac-source', 'demo'); } catch {}
  const nativeFetch = window.fetch.bind(window);
  const json = (data, status = 200) => new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
  window.fetch = function (input, options) {
    const target = typeof input === 'string' ? input : input instanceof Request ? input.url : '';
    let url;
    try { url = new URL(target, location.href === 'about:blank' ? 'https://arena-pages.invalid/' : location.href); } catch { return nativeFetch(input, options); }
    if (url.pathname === '/api/status') return Promise.resolve(json({
      demo: true,
      staticPages: true,
      hostedMode: false,
      models: ['demo/template-A', 'demo/template-B'],
      features: { starterLab: true, canvas: true, browserAI: true, browserProjects: true, serverProjects: false }
    }));
    if (url.pathname === '/api/chat') return Promise.resolve(json({ demo: true }));
    if (url.pathname.startsWith('/api/')) return Promise.resolve(json({ error: 'This feature requires the Arena Code Node.js backend. GitHub Pages provides the static showcase only.' }, 503));
    return nativeFetch(input, options);
  };
  function unavailableFeature() {
    const message = 'This browser edition supports local multi-file editing, ZIP import/export, basic syntax checks, sandboxed preview, undo and optional local WebGPU AI edits. Server-executed npm/Python tests, remote Git operations, Docker, hosted accounts, and production previews require the full Node.js app.';
    if (typeof window.modal === 'function') window.modal('What needs a server?', '<p class="modal-copy">' + message + '</p><p class="modal-copy"><a href="https://github.com/RaZeR877/Arena-Code" target="_blank" rel="noopener noreferrer">Get the full source on GitHub ↗</a></p>');
    else window.alert(message);
  }
  document.addEventListener('DOMContentLoaded', function () {
    const main = document.querySelector('main');
    if (!main) return;
    const banner = document.createElement('div');
    banner.className = 'pages-banner';
    banner.setAttribute('role', 'status');
    const copy = document.createElement('span');
    copy.textContent = 'GitHub Pages edition · Local multi-file projects, previews, ZIP export, and optional on-device AI. Docker and cloud accounts need a server.';
    const link = document.createElement('a');
    link.href = 'https://github.com/RaZeR877/Arena-Code';
    link.textContent = 'View source ↗';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    banner.append(copy, link);
    main.prepend(banner);
    const nav = document.querySelector('#sidebar nav');
    if (nav) {
      const button = document.createElement('button');
      button.className = 'nav-studio';
      button.id = 'pagesServerFeatureBtn';
      button.textContent = '◈ Server features and limitations';
      button.addEventListener('click', unavailableFeature);
      nav.append(button);
    }
    const status = document.querySelector('#statusPill');
    if (status) status.title = 'Pages edition: templates or browser-local AI only; no remote model API';
  });
})();
