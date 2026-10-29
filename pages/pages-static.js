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
      features: { starterLab: true, canvas: true, browserAI: true, serverProjects: false }
    }));
    if (url.pathname === '/api/chat') return Promise.resolve(json({ demo: true }));
    if (url.pathname.startsWith('/api/')) return Promise.resolve(json({ error: 'This feature requires the Arena Code Node.js backend. GitHub Pages provides the static showcase only.' }, 503));
    return nativeFetch(input, options);
  };
  function unavailableFeature() {
    const message = 'Multi-file projects, the autonomous coding agent, Git, Docker execution, login, and hosted previews require Arena Code running on a Node.js host. This GitHub Pages edition supports the starter lab, editable HTML canvas, demo responses, and optional browser-local WebGPU AI.';
    if (typeof window.modal === 'function') {
      window.modal('Full coding workspace requires a server', '<p class="modal-copy">' + message + '</p><p class="modal-copy"><a href="https://github.com/RaZeR877/Arena-Code" target="_blank" rel="noopener noreferrer">Get the full Arena Code source on GitHub ↗</a></p>');
    } else window.alert(message);
  }
  window.arenaOpenProjectHub = unavailableFeature;
  document.addEventListener('DOMContentLoaded', function () {
    const main = document.querySelector('main');
    if (!main) return;
    const banner = document.createElement('div');
    banner.className = 'pages-banner';
    banner.setAttribute('role', 'status');
    const copy = document.createElement('span');
    copy.textContent = 'GitHub Pages edition · Starter projects, canvas, and optional on-device AI. Server-backed coding agent requires the full app.';
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
      button.id = 'pagesWorkspaceBtn';
      button.textContent = '▣ Full coding workspace';
      button.addEventListener('click', unavailableFeature);
      nav.append(button);
    }
    const status = document.querySelector('#statusPill');
    if (status) status.title = 'Pages edition: templates or browser-local AI only; no remote model API';
  });
})();
