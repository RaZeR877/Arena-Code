/* Client-only multi-file workspace for the free GitHub Pages edition of Arena Code.
   No server-side execution, no account sync, no external AI requests. */
(function () {
  'use strict';
  const core = window.ArenaBrowserCore;
  if (!core) throw Error('Arena browser workspace requires browser-core.js');
  const KEY = 'arena-pages-workspace-v1', BACKUP = 'arena-pages-workspace-backup-v1';
  const state = { project: null, current: 'index.html', dirty: false, log: [], busy: false, frameNonce: '', dialog: null };
  const $ = (selector, node = document) => node.querySelector(selector);
  const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  function flash(message, bad = false) {
    const status = $('#arenaLocalStatus');
    if (status) { status.textContent = message; status.dataset.error = String(bad); }
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      state.project = raw ? core.normalize(JSON.parse(raw)) : core.starter();
    } catch (e) { state.project = core.starter(); flash('Previous browser workspace could not be opened: ' + e.message, true); }
    state.current = Object.keys(state.project.files).includes('index.html') ? 'index.html' : Object.keys(state.project.files)[0] || null;
  }
  function persist(project) {
    const value = JSON.stringify(project);
    // Browser storage is a convenience, not reliable backups; ZIP export is always available.
    if (value.length > 4 * 1024 * 1024) throw Error('Browser storage budget exceeded. Export your ZIP and remove large files.');
    localStorage.setItem(KEY, value);
  }
  function backup() { localStorage.setItem(BACKUP, JSON.stringify(state.project)); }
  function mutation(changes, label) {
    const next = core.update(state.project, changes);
    const previous = state.project;
    try { backup(); persist(next); } catch (e) { flash('Save failed: ' + e.message, true); state.project = previous; return false; }
    state.project = next;
    if (!Object.hasOwn(next.files, state.current)) state.current = Object.keys(next.files)[0] || null;
    state.dirty = false;
    render(); flash(label || 'Project saved in this browser');
    return true;
  }
  function open() {
    if (!state.project) load();
    if (!state.dialog) createDialog();
    render();
    state.dialog.showModal();
  }
  function createDialog() {
    const dialog = document.createElement('dialog'); dialog.id = 'arenaLocalDialog';
    dialog.setAttribute('aria-label', 'Browser coding workspace');
    dialog.innerHTML = `
      <div class="arena-local-root">
        <header class="arena-local-header">
          <div class="arena-local-brand"><strong>⌘ Arena Projects</strong><small>Local files · free browser edition</small></div>
          <div class="arena-local-actions">
            <button data-action="new">New</button><button data-action="import">Import</button><button data-action="export">Export ZIP</button><button data-action="restore">Undo last change</button><button data-action="close" title="Close project workspace">✕</button>
          </div>
        </header>
        <div class="arena-local-grid">
          <aside class="arena-local-explorer"><div class="arena-local-caption">PROJECT FILES <button data-action="add" title="New file">＋</button></div><div id="arenaLocalFiles"></div><p class="arena-local-help">Stored only on this device. Export regularly; clearing browser data removes local projects.</p></aside>
          <section class="arena-local-editor">
            <div class="arena-local-toolbar"><span id="arenaLocalFileName">Select a file</span><span class="arena-local-spacer"></span><button data-action="rename">Rename</button><button data-action="delete">Delete</button><button data-action="save">Save</button><button data-action="check">Check syntax</button><button data-action="preview">Preview</button></div>
            <textarea id="arenaLocalCode" spellcheck="false" aria-label="Project file editor" autocapitalize="off" autocomplete="off"></textarea>
            <div class="arena-local-log" id="arenaLocalStatus" role="status">Ready. Select a file to edit.</div>
          </section>
          <section class="arena-local-preview"><div class="arena-local-caption">SANDBOXED PREVIEW <span>HTML + CSS + classic JS</span></div><iframe id="arenaLocalFrame" title="Project preview" sandbox="allow-scripts allow-forms allow-downloads" referrerpolicy="no-referrer"></iframe><div id="arenaLocalConsole" class="arena-local-console">Preview logs appear here.</div></section>
        </div>
        <footer class="arena-local-agent"><div class="arena-local-agent-title"><strong>✦ On-device AI edit assistant</strong><small>Requires explicitly loading the free WebGPU model. Every change needs approval; no shell commands.</small></div><textarea id="arenaLocalTask" placeholder="Example: add a character counter to the page, updating both index.html and app.js" aria-label="Task for local coding model"></textarea><button data-action="agent">Suggest edits</button><button data-action="load-ai">Load browser AI</button></footer>
        <input type="file" id="arenaLocalImport" multiple hidden accept=".zip,.json,.html,.css,.js,.ts,.jsx,.tsx,.md,.txt,.py,.svg,.xml,.yml,.yaml,.jsonc,.csv">
      </div>`;
    document.body.append(dialog); state.dialog = dialog;
    dialog.addEventListener('close', () => { state.log = []; });
    dialog.addEventListener('click', event => {
      const b = event.target.closest('button[data-action]');
      if (b) { Promise.resolve(handle(b.dataset.action)).catch(e => flash(e.message, true)); }
      const file = event.target.closest('button[data-path]');
      if (file) switchFile(file.dataset.path);
    });
    $('#arenaLocalCode').addEventListener('input', () => { state.dirty = true; $('#arenaLocalFileName').textContent = (state.current || '') + ' · unsaved'; });
    $('#arenaLocalCode').addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveOpen(); } if (event.key === 'Tab') { event.preventDefault(); const el = event.target; el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end'); el.dispatchEvent(new Event('input')); } });
    $('#arenaLocalImport').addEventListener('change', async event => { try { await importFiles(event.target.files); } catch (e) { flash(e.message, true); } finally { event.target.value = ''; } });
  }
  function render() {
    if (!state.dialog || !state.project) return;
    const explorer = $('#arenaLocalFiles'); explorer.textContent = '';
    const names = Object.keys(state.project.files).sort();
    for (const name of names) {
      const b = document.createElement('button'); b.dataset.path = name; b.className = 'arena-local-file' + (name === state.current ? ' selected' : '');
      const icon = /\.html?$/i.test(name) ? '◇' : /\.css$/i.test(name) ? '▤' : /\.jsx?$/i.test(name) ? '⌘' : '◈';
      b.textContent = icon + '  ' + name; b.title = name; explorer.append(b);
    }
    const editor = $('#arenaLocalCode'); editor.disabled = !state.current;
    editor.value = state.current ? state.project.files[state.current] : '';
    $('#arenaLocalFileName').textContent = state.current || 'No files';
    state.dirty = false;
    $('#arenaLocalStatus').dataset.error = 'false';
  }
  function saveOpen() {
    if (!state.current || !state.dirty) return true;
    return mutation([{ path: state.current, content: $('#arenaLocalCode').value }], 'Saved ' + state.current);
  }
  function switchFile(path) { if (state.dirty && !saveOpen()) return; state.current = path; render(); }
  function filename() { return state.project.name.replace(/[^a-z0-9_-]/gi, '-') || 'arena-project'; }
  function download(blob, name) { const link = document.createElement('a'), url = URL.createObjectURL(blob); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 3000); }
  async function importFiles(files) {
    if (!files || !files.length) return;
    if (state.dirty && !saveOpen()) return;
    if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
      const imported = await core.unzip(await files[0].arrayBuffer());
      imported.name = files[0].name.replace(/\.zip$/i, '');
      await replaceProject(imported); return;
    }
    if (files.length === 1 && /\.arena\.json$/i.test(files[0].name)) {
      const restored = core.normalize(JSON.parse(await files[0].text())); await replaceProject(restored); return;
    }
    const additions = [];
    for (const file of files) {
      const path = core.safePath(file.webkitRelativePath || file.name);
      if (file.size > core.MAX_FILE_BYTES) throw Error('File too large: ' + path);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      additions.push({ path, content });
    }
    if (!confirm('Import ' + additions.length + ' text file(s) into this project? Matching paths will be replaced.')) return;
    mutation(additions, 'Imported ' + additions.length + ' files');
  }
  async function replaceProject(incoming) {
    const normalized = core.normalize(incoming);
    if (!confirm('Replace your current browser project with "' + normalized.name + '"? Export your current ZIP first.')) return;
    backup(); persist(normalized); state.project = normalized; state.current = Object.keys(normalized.files)[0] || null; render(); flash('Imported ' + Object.keys(normalized.files).length + ' files');
  }
  function htmlPreview() {
    if (state.dirty && !saveOpen()) return;
    const entry = state.project.files['index.html'] || state.project.files[state.current];
    if (!entry || !/<html\b/i.test(entry)) { flash('Create an index.html document to preview this project.', true); return; }
    const source = 'index.html' in state.project.files ? 'index.html' : state.current;
    const folder = source.split('/').slice(0, -1).join('/');
    const resolve = ref => { const clean = String(ref || '').split(/[?#]/)[0]; if (!clean || clean.startsWith('/') || /^[a-z]+:/i.test(clean)) return null; const segments = (folder ? folder + '/' : '') + clean.replace(/^\.\//, ''); try { return core.safePath(segments); } catch { return null; } };
    const doc = new DOMParser().parseFromString(entry, 'text/html');
    for (const link of Array.from(doc.querySelectorAll('link[rel="stylesheet"][href]'))) {
      const path = resolve(link.getAttribute('href'));
      if (!path || !Object.hasOwn(state.project.files, path)) continue;
      const style = doc.createElement('style'); style.textContent = state.project.files[path]; link.replaceWith(style);
    }
    for (const script of Array.from(doc.querySelectorAll('script[src]'))) {
      const path = resolve(script.getAttribute('src'));
      if (!path || !Object.hasOwn(state.project.files, path)) continue;
      if (script.getAttribute('type') === 'module') { flash('Preview cannot resolve module imports. Build with the Node runner for a full test.', true); continue; }
      const inline = doc.createElement('script'); inline.textContent = state.project.files[path]; script.replaceWith(inline);
    }
    state.frameNonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const bridge = doc.createElement('script');
    bridge.textContent = `(function(){var id=${JSON.stringify(state.frameNonce)};for(const level of ['log','warn','error']){const old=console[level];console[level]=function(...args){try{parent.postMessage({arenaLocal:true,id,level,text:args.map(String).join(' ').slice(0,500)},'*')}catch{};old.apply(console,args)}}addEventListener('error',e=>parent.postMessage({arenaLocal:true,id,level:'error',text:String(e.message).slice(0,500)},'*'));})();`;
    doc.head.prepend(bridge);
    $('#arenaLocalConsole').textContent = 'Preview loaded in an opaque-origin sandbox. Not a complete application test.';
    $('#arenaLocalFrame').srcdoc = '<!doctype html>\n' + doc.documentElement.outerHTML;
    flash('Rendered ' + source + ' (local CSS and classic JavaScript).');
  }
  window.addEventListener('message', event => {
    if (!state.dialog || event.source !== $('#arenaLocalFrame')?.contentWindow || event.data?.arenaLocal !== true || event.data?.id !== state.frameNonce) return;
    const text = String(event.data.level || 'log') + ': ' + String(event.data.text || '');
    state.log.push(text.slice(0, 600)); state.log = state.log.slice(-20);
    $('#arenaLocalConsole').textContent = state.log.join('\n');
  });
  function checkAll() {
    if (state.dirty && !saveOpen()) return [];
    const results = Object.entries(state.project.files).map(([path, value]) => ({ path, ...core.check(path, value) }));
    const fail = results.filter(x => x.status === 'fail');
    $('#arenaLocalConsole').textContent = results.map(x => x.status.toUpperCase() + ' · ' + x.path + ' · ' + x.message).join('\n');
    flash(fail.length ? fail.length + ' syntax check(s) failed.' : 'Basic syntax checks completed. Runtime/build/tests remain unverified.', !!fail.length);
    return results;
  }
  function reviewChanges(proposal) {
    return new Promise(resolve => {
      const dialog = document.createElement('dialog'); dialog.className = 'arena-review-dialog';
      const head = document.createElement('header'); const title = document.createElement('strong'); title.textContent = 'Review every proposed AI file change';
      const note = document.createElement('p'); note.textContent = proposal.summary + ' · AI-generated code is untrusted and has not been tested.';
      head.append(title, note); dialog.append(head);
      const container = document.createElement('div'); container.className = 'arena-review-files';
      for (const change of proposal.changes) {
        const details = document.createElement('details'); details.open = true;
        const summary = document.createElement('summary');
        summary.textContent = (change.delete ? 'DELETE ' : Object.hasOwn(state.project.files, change.path) ? 'EDIT ' : 'CREATE ') + change.path;
        details.append(summary);
        const grid = document.createElement('div'); grid.className = 'arena-review-diff';
        for (const [caption, value] of [['Before', state.project.files[change.path] ?? '(new file)'], ['After', change.delete ? '(deleted)' : change.content]]) {
          const pane = document.createElement('section'); const h = document.createElement('h3'); h.textContent = caption;
          const pre = document.createElement('pre'); pre.textContent = value; pane.append(h, pre); grid.append(pane);
        }
        details.append(grid); container.append(details);
      }
      dialog.append(container);
      const actions = document.createElement('footer');
      const reject = document.createElement('button'); reject.textContent = 'Reject'; reject.onclick = () => dialog.close('reject');
      const apply = document.createElement('button'); apply.className = 'arena-review-apply'; apply.textContent = 'Approve ' + proposal.changes.length + ' changes'; apply.onclick = () => dialog.close('apply');
      actions.append(reject, apply); dialog.append(actions);
      dialog.addEventListener('close', () => { const approved = dialog.returnValue === 'apply'; dialog.remove(); resolve(approved); }, { once: true });
      document.body.append(dialog); dialog.showModal();
    });
  }
  async function aiSuggest() {
    if (state.busy) return;
    if (state.dirty && !saveOpen()) return;
    const task = $('#arenaLocalTask').value.trim();
    if (!task) return flash('Describe the edit task first.', true);
    if (typeof studio === 'undefined' || !studio.ready || !studio.engine) { flash('Load a real browser AI model first (WebGPU required); demo templates cannot edit files.', true); return; }
    const startingRevision = state.project.revision;
    state.busy = true; const button = $('[data-action="agent"]', state.dialog); button.disabled = true;
    try {
      const context = JSON.stringify(state.project.files);
      if (context.length > 36_000) throw Error('Project context exceeds the local model limit. Reduce files or use the full server-based agent.');
      const messages = [
        { role: 'system', content: 'You are a careful coding assistant. Respond with one JSON object only: {"summary":"...","changes":[{"path":"relative/path.js","content":"full new source"}]}. You may edit up to 5 existing or new text files. No shell commands, no secrets, no deleting files unless required. Preserve unrelated files. Return complete contents for changed files only. Never claim your edits were tested.' },
        { role: 'user', content: 'TASK: ' + task + '\nPROJECT FILES (JSON):\n' + context }
      ];
      flash('Local AI is suggesting changes. Nothing will be applied without approval.');
      const response = await studio.engine.chat.completions.create({ messages, temperature: 0.1, max_tokens: 3000 });
      if (state.project.revision !== startingRevision || state.dirty) throw Error('Project changed while the model was working. No stale edits were applied. Please run the task again.');
      const proposal = core.parseSuggestion(response.choices?.[0]?.message?.content || '', state.project);
      const approved = await reviewChanges(proposal);
      if (!approved) { flash('AI proposal rejected. No project files changed.'); return; }
      if (state.project.revision !== startingRevision || state.dirty) throw Error('Files changed during review. No stale AI edits applied.');
      if (mutation(proposal.changes, 'Applied ' + proposal.changes.length + ' approved AI changes.')) {
        const checks = checkAll(); const fails = checks.filter(x => x.status === 'fail');
        flash('AI edits applied. ' + (fails.length ? fails.length + ' syntax issue(s) found — review or undo.' : 'Basic syntax checks have no errors; runtime and tests are not verified.'), !!fails.length);
      }
    } catch (e) { flash('AI edit not applied: ' + e.message, true); }
    finally { state.busy = false; button.disabled = false; }
  }
  async function handle(action) {
    switch (action) {
      case 'close': if (state.dirty && !saveOpen()) return; state.dialog.close(); break;
      case 'new': await replaceProject(core.starter()); break;
      case 'add': { if (state.dirty && !saveOpen()) return; const path = prompt('New file path, e.g. src/app.js'); if (path === null) return; core.safePath(path); if (Object.hasOwn(state.project.files, path)) throw Error('This file already exists.'); if (mutation([{ path, content: '' }], 'File created')) { state.current = path; render(); } break; }
      case 'rename': { if (!state.current) return; const old = state.current, path = prompt('Rename file to:', old); if (path === null || path === old) return; core.safePath(path); if (Object.hasOwn(state.project.files, path)) throw Error('Destination already exists.'); if (state.dirty && !saveOpen()) return; const contents = state.project.files[old]; if (mutation([{ path: old, delete: true }, { path, content: contents }], 'File renamed')) { state.current = path; render(); } break; }
      case 'delete': if (state.current && confirm('Delete ' + state.current + '? You can undo the last change.')) { state.dirty = false; mutation([{ path: state.current, delete: true }], 'File deleted'); } break;
      case 'save': saveOpen(); break;
      case 'check': checkAll(); break;
      case 'preview': htmlPreview(); break;
      case 'import': $('#arenaLocalImport').click(); break;
      case 'export': if (state.dirty && !saveOpen()) return; download(new Blob([core.zip(state.project)], { type: 'application/zip' }), filename() + '.zip'); flash('Downloaded a standard ZIP backup.'); break;
      case 'restore': { const raw = localStorage.getItem(BACKUP); if (!raw) return flash('No last-change checkpoint exists in this browser.', true); if (!confirm('Restore the previous project state? All changes since the last checkpoint will be replaced.')) return; const restored = core.normalize(JSON.parse(raw)); const current = state.project; persist(restored); localStorage.setItem(BACKUP, JSON.stringify(current)); state.project = restored; if (!Object.hasOwn(restored.files, state.current)) state.current = Object.keys(restored.files)[0] || null; render(); flash('Last project change undone.'); break; }
      case 'agent': await aiSuggest(); break;
      case 'load-ai': if (state.dirty && !saveOpen()) return; state.dialog.close(); if (typeof openAI === 'function') openAI(); else alert('Open Free AI engine in the sidebar and load a model.'); break;
    }
  }
  function install() {
    const nav = document.querySelector('#sidebar nav');
    if (nav && !$('#pagesWorkspaceBtn')) {
      const b = document.createElement('button'); b.id = 'pagesWorkspaceBtn'; b.className = 'nav-studio'; b.textContent = '▣ Browser coding workspace'; b.addEventListener('click', open); nav.append(b);
    }
    window.arenaOpenProjectHub = open;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
  window.ArenaPagesWorkspace = { open, checkAll };
})();
