/* Arena Code project workspace + guarded coding-agent loop. Loaded after app.js and studio.js. */
(() => {
  const PROJECT_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 5a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5Z"/><path d="M2 8h16"/></svg>';
  const state = { project: null, files: [], file: null, savedText: '', dirty: false, busy: false, preview: false, agentStop: false, processPoll: null, activeProcessId: null, hosted: false, user: null, serverStatus: null };
  const ignoredImport = /(^|\/)(node_modules|\.git|\.next|dist|build|\.cache)(\/|$)|(^|\/)\.env(?:\.|$)/i;
  const binaryExt = /\.(?:png|jpe?g|gif|webp|avif|bmp|ico|pdf|mp4|webm|mov|mp3|wav|ogg|flac|zip|gz|7z|rar|tar|woff2?|ttf|otf|eot|wasm|exe|dll|so|dylib|bin|sqlite|db)$/i;
  const toBase64 = bytes => { let raw = ''; for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(raw); };
  const looksBinary = (bytes, name) => { if (binaryExt.test(name)) return true; const sample = bytes.subarray(0, Math.min(bytes.length, 8192)); if (sample.includes(0)) return true; let odd = 0; for (const b of sample) if (b < 7 || (b > 13 && b < 32)) odd++; return sample.length > 0 && odd / sample.length > 0.08; };
  async function importLocalFiles(projectId, chosen, knownPaths = new Set()) {
    let uploaded = 0, skipped = 0;
    for (const f of chosen) {
      const rel = f.webkitRelativePath || f.name; let p = rel.split('/').slice(1).join('/') || f.name;
      if (ignoredImport.test(p) || p.split('/').some(part => !part || part === '.' || part === '..' || part === '.arena-project.json') || f.size > 5 * 1024 * 1024 || knownPaths.has(p)) { skipped++; continue; }
      const bytes = new Uint8Array(await f.arrayBuffer()); const binary = looksBinary(bytes, p);
      const data = binary ? { path: p, encoding: 'base64', content: toBase64(bytes) } : { path: p, content: await f.text() };
      await api(`${projectApi(projectId)}/file`, { method: 'PUT', body: JSON.stringify({ ...data, ...(state.hosted && state.project?.id === projectId && Number.isInteger(state.project.revision) ? { expectedRevision: state.project.revision } : {}) }) }); knownPaths.add(p); uploaded++; if (state.hosted && state.project?.id === projectId) await refreshFiles();
    }
    return { uploaded, skipped };
  }
  const api = async (path, options = {}) => {
    const res = await fetch(path, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };
  const enc = encodeURIComponent;
  const projectApi = id => `/api/projects/${enc(id)}`;
  const fileApi = (id, p) => `${projectApi(id)}/file?path=${enc(p)}`;
  const setStatus = msg => { const el = document.querySelector('#projectStatus'); if (el) el.textContent = msg; };
  const leafName = p => String(p).split('/').pop();
  const languageFor = p => ({ html: 'HTML', htm: 'HTML', css: 'CSS', js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript JSX', jsx: 'React JSX', py: 'Python', json: 'JSON', md: 'Markdown', sql: 'SQL', java: 'Java', go: 'Go', rs: 'Rust', yml: 'YAML', yaml: 'YAML', xml: 'XML', sh: 'Shell' }[String(p).split('.').pop().toLowerCase()] || 'Plain text');
  function openHostedAuth(mode = 'login') {
    const register = mode === 'register';
    modal(register ? 'Create your Arena account' : 'Sign in to Arena Code', `<p class="modal-copy">${register ? 'Create an account to save projects to the hosted workspace.' : 'Sign in to access your cloud workspaces and shared projects.'}</p><form id="hostedAuthForm" class="hosted-auth-form"><label class="hosted-form-field">Email<input class="modal-input" id="hostedEmail" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></label>${register ? '<label class="hosted-form-field">Display name<input class="modal-input" id="hostedName" autocomplete="name" maxlength="80" required placeholder="Your name"></label>' : ''}<label class="hosted-form-field">Password<input class="modal-input" id="hostedPassword" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" minlength="12" required maxlength="1024" placeholder="At least 12 characters"></label><button class="primary-btn" type="submit">${register ? 'Create account' : 'Sign in'}</button><p id="hostedAuthError" class="modal-copy" role="alert"></p></form><p class="modal-copy">${register ? 'Already have an account?' : 'New to this hosted Arena instance?'} <button id="hostedAuthToggle" class="basic-btn" type="button">${register ? 'Sign in' : 'Create account'}</button></p><div class="notice-box">Use a unique password. This hosted instance stores account credentials as salted password hashes and uses secure, HTTP-only sessions when deployed behind HTTPS.</div>`);
    $('#hostedAuthToggle').onclick = () => openHostedAuth(register ? 'login' : 'register');
    $('#hostedAuthForm').onsubmit = async e => {
      e.preventDefault(); const errorEl = $('#hostedAuthError'); const submit = $('#hostedAuthForm button[type="submit"]'); submit.disabled = true; errorEl.textContent = '';
      try { const result = await api(`/api/auth/${register ? 'register' : 'login'}`, { method:'POST', body:JSON.stringify({ email:$('#hostedEmail').value, password:$('#hostedPassword').value, ...(register ? { name:$('#hostedName').value } : {}) }) }); state.user = result.user; $('#modal').close(); toast(register ? 'Account created' : 'Signed in'); await openProjectHub(); }
      catch(err) { errorEl.textContent = err.message; }
      finally { if (submit.isConnected) submit.disabled = false; }
    };
  }
  async function openProjectHub() {
    try { state.serverStatus = await api('/api/status'); state.hosted = Boolean(state.serverStatus.hostedMode); }
    catch (err) { toast(`Could not load server status: ${err.message}`); return; }
    if (state.hosted) { try { state.user = (await api('/api/auth/me')).user; } catch { openHostedAuth('login'); return; } }
    const title = state.hosted ? 'Cloud workspaces' : 'Your projects';
    const description = state.hosted ? `Signed in as ${esc(state.user?.email || 'developer')}. Projects are stored in the hosted PostgreSQL workspace and shared access is role-controlled.` : 'Real files stored on this computer. Projects are local and are not synced to a cloud account.';
    const accountActions = state.hosted ? `<div class="project-account-row"><span class="modal-copy">${esc(state.user?.name || state.user?.email || '')}</span><button id="projectLogout" class="basic-btn">Sign out</button></div>` : '';
    modal(title, `<div class="project-hub-head"><p class="modal-copy">${description}</p>${accountActions}<div class="project-hub-actions"><button id="projectCreate" class="primary-btn">＋ New project</button><button id="projectImport" class="basic-btn">Import folder</button><button id="projectImportArchive" class="basic-btn">Import archive</button></div><input id="projectFolderInput" type="file" webkitdirectory directory multiple hidden><input id="projectArchiveInput" type="file" accept="application/zip,.zip,application/json,.json" hidden></div><div id="projectList" class="project-list"><p class="modal-copy">Loading projects…</p></div><div class="notice-box">Import only code you trust. <code>node_modules</code>, Git internals, and environment-secret files are skipped. Opening a project does not execute its code. ${state.hosted ? 'Remote builds/tests require the configured isolated runner.' : 'Running project-defined tests requires explicit confirmation.'}</div>`);
    if (state.hosted) $('#projectLogout').onclick = async () => { try { await api('/api/auth/logout', {method:'POST',body:JSON.stringify({})}); state.user = null; openHostedAuth('login'); } catch(e) { toast(e.message); } };
    $('#projectCreate').onclick = async () => {
      const name = prompt('Name this project', 'My Arena Project');
      if (name === null) return;
      try { const result = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name }) }); $('#modal').close(); await openProject(result.project.id); toast('Project created'); }
      catch (e) { toast(e.message); }
    };
    $('#projectImport').onclick = () => $('#projectFolderInput').click();
    $('#projectImportArchive').onclick = () => $('#projectArchiveInput').click();
    $('#projectArchiveInput').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        if (/\.zip$/i.test(f.name) || /application\/(?:x-)?zip/i.test(f.type)) {
          if (f.size > 8 * 1024 * 1024) throw new Error('ZIP import is limited to 8 MB compressed.');
          const name = prompt('Name the imported project', f.name.replace(/\.zip$/i, '') || 'Imported project'); if (name === null) return;
          const archive = toBase64(new Uint8Array(await f.arrayBuffer()));
          const result = await api('/api/projects/import-zip', { method: 'POST', body: JSON.stringify({ name, archive }) });
          $('#modal').close(); await openProject(result.project.id); toast(`Imported ${result.importedFiles} files from ZIP`);
        } else {
          const archive = JSON.parse(await f.text()); if (archive.format !== 'arena-project-v1' || !Array.isArray(archive.files) || archive.files.length > 500) throw new Error('Invalid Arena JSON project archive.');
          const name = prompt('Name the restored project', archive.project?.name || 'Restored project'); if (name === null) return;
          const result = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name }) }); let count = 0;
          for (const entry of archive.files) { if (!entry || typeof entry.path !== 'string' || typeof entry.content !== 'string') continue; await api(`${projectApi(result.project.id)}/file`, { method: 'PUT', body: JSON.stringify({ path: entry.path, content: entry.content, ...(entry.encoding === 'base64' ? { encoding: 'base64' } : {}) }) }); count++; }
          $('#modal').close(); await openProject(result.project.id); toast(`Restored ${count} files from Arena JSON`);
        }
      } catch (err) { toast(`Archive import failed: ${err.message}`); }
      finally { e.target.value = ''; }
    };
    $('#projectFolderInput').onchange = async e => {
      const chosen = [...e.target.files]; if (!chosen.length) return;
      const name = prompt('Name the imported project', chosen[0].webkitRelativePath?.split('/')[0] || 'Imported project');
      if (name === null) return;
      try {
        const result = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name }) });
        const counts = await importLocalFiles(result.project.id, chosen);
        toast(`Imported ${counts.uploaded} files${counts.skipped ? `; skipped ${counts.skipped}` : ''}`);
        $('#modal').close(); await openProject(result.project.id);
      } catch (err) { toast(`Import stopped: ${err.message}`); await paintProjects().catch(() => {}); }
      finally { e.target.value = ''; }
    };
    paintProjects().catch(e => { const el = $('#projectList'); if (el) el.innerHTML = `<p class="modal-copy">${esc(e.message)}</p>`; });
  }
  async function paintProjects() {
    const { projects } = await api('/api/projects'); const el = $('#projectList'); if (!el) return;
    el.innerHTML = projects.length ? projects.map(p => `<button class="project-list-item" data-project="${esc(p.id)}"><span class="project-glyph">▣</span><span class="project-list-text"><b>${esc(p.name)}</b><small>${p.fileCount} files · ${p.createdAt ? esc(new Date(p.createdAt).toLocaleDateString()) : 'local project'}</small></span><span>Open ↗</span></button>`).join('') : '<div class="project-empty">No projects yet. Create one or import a folder to get started.</div>';
    el.onclick = async e => { const b = e.target.closest('[data-project]'); if (!b) return; try { $('#modal').close(); await openProject(b.dataset.project); } catch (err) { toast(err.message); } };
  }
  async function openProject(id) {
    stopProcessPolling(); window.ArenaEditor?.dispose();
    const data = await api(`${projectApi(id)}/files`); state.project = data.project; window.arenaProjectId = id; state.files = data.files.filter(f => f.path !== '.arena-project.json'); state.file = null; state.dirty = false;
    modal(`Project / ${state.project.name}`, `<div class="project-toolbar"><button id="projectNewFile" class="basic-btn">＋ File</button><button id="projectDeleteFile" class="basic-btn">Delete file</button><button id="projectImportMore" class="basic-btn">Import files</button><button id="projectSave" class="primary-btn" disabled>Save</button><button id="projectFormat" class="basic-btn">Format</button><button id="projectPreview" class="basic-btn">Preview HTML</button><button id="projectCheck" class="basic-btn">Check syntax</button><button id="projectInstallDeps" class="basic-btn">Install deps (${state.hosted ? 'remote' : 'Docker'})</button><button id="projectBuild" class="basic-btn">Build</button><button id="projectTests" class="basic-btn">Run tests</button>${state.hosted ? `<button id="projectStartServer" class="basic-btn">Start isolated app</button><button id="projectShare" class="basic-btn" ${state.project.role === 'owner' ? '' : 'hidden'}>Share</button><button id="projectDeploy" class="basic-btn" ${state.project.role === 'owner' ? '' : 'hidden'}>Deploy</button>` : '<button id="projectStartServer" class="basic-btn">Start app</button><button id="projectDebug" class="basic-btn">Debug Node file</button><button id="projectGit" class="basic-btn">Git</button>'}<button id="projectHistory" class="basic-btn">History</button>${state.hosted ? '' : '<button id="projectCheckpoints" class="basic-btn">Checkpoints</button>'}<button id="projectExportZip" class="basic-btn">Export ZIP ↗</button><button id="projectExport" class="basic-btn">Export JSON</button><span id="projectStatus">Ready · ${esc(state.project.role || 'local')}</span><input id="projectMoreInput" type="file" webkitdirectory directory multiple hidden></div><div class="project-work-grid"><aside class="project-files"><div class="project-section-title">EXPLORER <button id="projectRefresh" title="Refresh files">↻</button></div><div id="projectTree"></div></aside><section class="project-editor"><div class="project-tab"><span id="projectFileName">Select a file</span><span class="project-tab-meta"><span id="projectLanguage"></span><small id="projectEditorMode">Loading editor…</small></span></div><div class="project-code-shell"><pre id="projectLineNumbers" aria-hidden="true">1</pre><div id="projectMonaco" hidden></div><textarea id="projectCode" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Project source code" placeholder="Choose a file from the explorer…" disabled></textarea></div><div class="project-agent"><div class="project-agent-head"><b>✦ Coding agent</b><small>Explicitly approved file edits</small></div><textarea id="projectTask" rows="2" placeholder="Ask the agent to add a feature, fix a bug, or explain the project…"></textarea><div class="project-agent-actions"><button id="projectAgentRun" class="primary-btn">Run agent task ↗</button><button id="projectAgentStop" class="basic-btn" disabled>Stop</button></div><div id="projectAgentLog" class="project-agent-log" aria-live="polite"></div></div></section><section class="project-preview"><div class="project-preview-head"><span>PREVIEW / OUTPUT</span><button id="projectClearOutput">Clear</button></div><div id="projectOutput" class="project-output"><p>Choose an HTML file and select Preview HTML. JavaScript checks validate syntax without executing the source.</p></div><iframe id="projectFrame" title="Project HTML preview" sandbox="allow-scripts allow-forms allow-downloads" hidden></iframe></section></div>`);
    $('#modal').classList.add('workspace-dialog', 'project-dialog');
    const readOnly = state.hosted && state.project.role === 'viewer';
    if (readOnly) ['projectNewFile','projectDeleteFile','projectImportMore','projectSave','projectFormat','projectInstallDeps','projectBuild','projectTests','projectStartServer','projectAgentRun','projectTask'].forEach(id => { const el = $('#'+id); if (el) el.disabled = true; });
    const code = $('#projectCode');
    const updateDirty = value => { state.dirty = String(value) !== state.savedText; $('#projectSave').disabled = !state.dirty; $('#projectFileName').textContent = `${state.file || 'Untitled'}${state.dirty ? ' •' : ''}`; paintLineNumbers(); };
    code.oninput = () => { if (!window.ArenaEditor || window.ArenaEditor.mode !== 'monaco') updateDirty(code.value); };
    window.ArenaEditor?.mount({ onChange: updateDirty });
    code.onscroll = () => { const gutter = $('#projectLineNumbers'); if (gutter) gutter.scrollTop = code.scrollTop; };
    code.onkeydown = e => { if (e.key === 'Tab') { e.preventDefault(); const t = e.target, start = t.selectionStart, end = t.selectionEnd; t.setRangeText('  ', start, end, 'end'); t.dispatchEvent(new Event('input')); } if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveCurrent(); } };
    $('#projectSave').onclick = saveCurrent;
    $('#projectNewFile').onclick = async () => { if (!(await ensureSaved())) return; const p = prompt('Relative file path (example: src/app.js)', 'src/app.js'); if (!p) return; if (state.files.some(f => f.type === 'file' && f.path === p)) return toast('That file already exists. Choose another path.'); try { const created = await api(`${projectApi(id)}/file`, { method: 'PUT', body: JSON.stringify({ path: p, content: '', ...(state.hosted && Number.isInteger(state.project.revision) ? { expectedRevision: state.project.revision } : {}) }) }); if (created.revision) state.project.revision = created.revision; await refreshFiles(); await selectFile(p); } catch (e) { toast(e.message); } };
    $('#projectRefresh').onclick = refreshFiles;
    $('#projectDeleteFile').onclick = async () => { if (!state.file) return toast('Choose a file first.'); if (state.dirty && !(await ensureSaved())) return; const target = state.file; if (!confirm(`Delete ${target} from the working project? Arena Code records the previous contents in file History when possible.`)) return; try { await api(`${fileApi(id, target)}${state.hosted && Number.isInteger(state.project.revision) ? `&expectedRevision=${enc(state.project.revision)}` : ''}`, { method: 'DELETE' }); state.file = null; state.savedText = ''; state.dirty = false; code.value = ''; code.disabled = true; $('#projectSave').disabled = true; $('#projectFileName').textContent = 'Select a file'; $('#projectLanguage').textContent = ''; await refreshFiles(); const next = state.files.find(f => f.type === 'file'); if (next) await selectFile(next.path); toast(`Deleted ${target}`); } catch (e) { toast(e.message); } };
    $('#projectImportMore').onclick = () => $('#projectMoreInput').click();
    $('#projectMoreInput').onchange = async e => { const picked = [...e.target.files]; try { const existing = new Set(state.files.filter(f => f.type === 'file').map(f => f.path)); const counts = await importLocalFiles(id, picked, existing); await refreshFiles(); toast(`Imported ${counts.uploaded} files${counts.skipped ? `; skipped ${counts.skipped}` : ''}`); } catch (err) { toast(err.message); } finally { e.target.value = ''; } };
    $('#projectFormat').onclick = () => window.ArenaEditor?.format();
    $('#projectDebug')?.addEventListener('click', debugCurrentFile);
    $('#projectPreview').onclick = previewCurrent;
    $('#projectCheck').onclick = checkCurrent;
    $('#projectInstallDeps').onclick = () => { const hasNpm = state.files.some(f => f.type === 'file' && f.path === 'package.json'); const hasPython = state.files.some(f => f.type === 'file' && f.path === 'requirements.txt'); if (hasNpm) runBuildTask('npm-install'); else if (hasPython) runBuildTask('python-install'); else toast('Add a package.json or requirements.txt before installing dependencies.'); };
    $('#projectBuild').onclick = () => runBuildTask('npm-build');
    $('#projectTests').onclick = runTests;
    $('#projectStartServer')?.addEventListener('click', startDevServer);
    $('#projectGit')?.addEventListener('click', openGitPanel);
    $('#projectShare')?.addEventListener('click', openSharePanel);
    $('#projectDeploy')?.addEventListener('click', openDeployPanel);
    $('#projectHistory').onclick = openHistoryPanel;
    $('#projectCheckpoints')?.addEventListener('click', openCheckpointsPanel);
    $('#projectExport').onclick = exportProject;
    $('#projectExportZip').onclick = exportProjectZip;
    $('#projectClearOutput').onclick = () => { $('#projectOutput').innerHTML = ''; $('#projectFrame').hidden = true; };
    $('#projectAgentRun').onclick = runAgent;
    $('#projectTask').onkeydown = e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runAgent(); } };
    $('#projectAgentStop').onclick = () => { state.agentStop = true; setAgentStatus('Stop requested — the current model request may finish before stopping.'); };
    $('#projectTree').onclick = async e => { const b = e.target.closest('[data-file]'); if (!b) return; if (!(await ensureSaved())) return; try { await selectFile(b.dataset.file); } catch (err) { toast(err.message); } };
    renderTree();
    const first = state.files.find(f => f.type === 'file' && ['README.md', 'index.html', 'package.json', 'src/index.js', 'src/main.js'].includes(f.path)) || state.files.find(f => f.type === 'file');
    if (first) await selectFile(first.path);
  }
  async function openSharePanel() {
    if (!(await ensureSaved())) return;
    const id = state.project.id;
    try {
      const { members } = await api(`${projectApi(id)}/shares`);
      modal(`Share / ${state.project.name}`, `<p class="modal-copy">Invite an existing Arena account by email. Editors can modify files and run allowed tasks; viewers are read-only.</p><form id="shareMemberForm" class="hosted-auth-form"><label class="hosted-form-field">Account email<input class="modal-input" id="shareEmail" type="email" required maxlength="254" placeholder="teammate@example.com"></label><label class="hosted-form-field">Role<select id="shareRole" class="modal-input"><option value="editor">Editor</option><option value="viewer">Viewer</option></select></label><button class="primary-btn" type="submit">Add / update access</button><p id="shareError" class="modal-copy" role="alert"></p></form><h3>Members</h3><div class="share-member-list">${members.map(m=>`<div class="share-member"><span><b>${esc(m.name || m.email)}</b><small>${esc(m.email)} · ${esc(m.role)}</small></span>${m.role !== 'owner' ? `<button class="basic-btn" data-remove-member="${esc(m.id)}">Remove</button>` : '<small>Owner</small>'}</div>`).join('')}</div><button id="shareBack" class="basic-btn">Back to editor</button>`);
      $('#shareBack').onclick = () => openProject(id);
      $('#shareMemberForm').onsubmit = async e => { e.preventDefault(); const err=$('#shareError'); try { await api(`${projectApi(id)}/shares`,{method:'POST',body:JSON.stringify({email:$('#shareEmail').value,role:$('#shareRole').value})}); toast('Workspace access updated'); await openSharePanel(); } catch(error){err.textContent=error.message;} };
      $('#modalBody').querySelectorAll('[data-remove-member]').forEach(button => button.onclick = async () => { if (!confirm('Remove this account from the workspace?')) return; try { await api(`${projectApi(id)}/shares?userId=${enc(button.dataset.removeMember)}`,{method:'DELETE'}); await openSharePanel(); } catch(e){toast(e.message);} });
    } catch (e) { toast(e.message); }
  }
  async function openDeployPanel() {
    if (!(await ensureSaved())) return;
    const id = state.project.id; const status = state.serverStatus || await api('/api/status');
    let deployments = [];
    try { deployments = (await api(`${projectApi(id)}/deployments`)).deployments || []; } catch {}
    modal(`Deploy / ${state.project.name}`, `<p class="modal-copy">Deployment exports this workspace as a ZIP to the administrator-configured deployment adapter. It does not execute deployment scripts on the Arena web server.</p><div class="notice-box">${status.deploymentConfigured ? 'A deployment adapter is configured.' : 'No deployment adapter is configured. Set ARENA_DEPLOY_WEBHOOK_URL and ARENA_DEPLOY_WEBHOOK_TOKEN on the server first.'}</div><button id="projectDeployNow" class="primary-btn" ${status.deploymentConfigured ? '' : 'disabled'}>Start deployment</button><p id="projectDeployError" class="modal-copy" role="alert"></p><h3>Recent deployments</h3><div class="share-member-list">${deployments.length ? deployments.map(d=>`<div class="share-member"><span><b>${esc(d.status)}</b><small>${esc(d.createdAt || '')} · ${esc(d.message || '')}</small></span>${d.targetUrl ? `<a href="${esc(d.targetUrl)}" target="_blank" rel="noopener">Open ↗</a>` : ''}</div>`).join('') : '<p class="modal-copy">No deployment attempts yet.</p>'}</div><button id="deployBack" class="basic-btn">Back to editor</button>`);
    $('#deployBack').onclick = () => openProject(id);
    $('#projectDeployNow').onclick = async () => { if (!confirm('Send this project archive to the configured deployment adapter?')) return; const button=$('#projectDeployNow');button.disabled=true; $('#projectDeployError').textContent='Deployment request running…'; try { const r=await api(`${projectApi(id)}/deploy`,{method:'POST',body:JSON.stringify({options:{}})}); $('#projectDeployError').textContent=r.deployment?.url ? `Deployed: ${r.deployment.url}` : (r.deployment?.message || 'Deployment adapter completed without returning a URL.'); toast('Deployment request completed'); } catch(e){$('#projectDeployError').textContent=e.message;} finally {if(button.isConnected)button.disabled=false;} };
  }
  function paintLineNumbers() { const gutter = $('#projectLineNumbers'), code = $('#projectCode'); if (!gutter || !code) return; const count = Math.max(1, code.value.split('\n').length); gutter.textContent = Array.from({ length: count }, (_, i) => String(i + 1)).join('\n'); gutter.scrollTop = code.scrollTop; }
  function renderTree() {
    const tree = $('#projectTree'); if (!tree) return;
    const files = state.files.filter(f => f.path !== '.arena-project.json');
    tree.innerHTML = files.length ? files.map(f => `<button class="project-file ${state.file === f.path ? 'active' : ''}" data-file="${esc(f.path)}" ${f.type === 'directory' ? 'disabled' : ''}><span>${f.type === 'directory' ? '▸' : fileGlyph(f.path)}</span><span>${esc(f.path)}</span>${f.type === 'file' ? `<small>${Math.max(1, Math.ceil(f.size / 1024))}k</small>` : ''}</button>`).join('') : '<p class="project-empty">No files in this project.</p>';
  }
  function fileGlyph(p) { return ({html:'◈',css:'#',js:'JS',ts:'TS',json:'{}',md:'M',py:'Py',png:'▧',svg:'◇'}[String(p).split('.').pop().toLowerCase()] || '·'); }
  async function refreshFiles() { const data = await api(`${projectApi(state.project.id)}/files`); state.project = data.project || state.project; state.files = data.files.filter(f => f.path !== '.arena-project.json'); renderTree(); }
  async function selectFile(p) {
    const result = await api(fileApi(state.project.id, p)); state.file = p; state.savedText = result.encoding === 'base64' ? '[binary asset]' : result.content; state.dirty = false;
    const binary = result.encoding === 'base64'; const readOnly = binary || (state.hosted && state.project.role === 'viewer'); const content = binary ? `Binary asset · ${result.size.toLocaleString()} bytes\n\nThis asset is preserved as a binary file. It is not editable in the text editor; use Import to replace it.` : result.content; $('#projectCode').disabled = readOnly; $('#projectCode').value = content; window.ArenaEditor?.setFile(p, content, readOnly); $('#projectSave').disabled = true; const debugButton = $('#projectDebug'); if (debugButton) debugButton.disabled = readOnly || !/\.(?:js|cjs|mjs)$/i.test(p); $('#projectFormat').disabled = readOnly; $('#projectAgentRun').disabled = readOnly; $('#projectTask').disabled = readOnly; paintLineNumbers();
    $('#projectFileName').textContent = p; $('#projectLanguage').textContent = result.encoding === 'base64' ? 'Binary asset' : languageFor(p); setStatus(`${result.size.toLocaleString()} bytes · saved`); renderTree();
    $('#projectFrame').hidden = true;
  }
  async function ensureSaved() { if (!state.dirty) return true; if (!confirm('You have unsaved changes. Save before continuing?')) return false; await saveCurrent(); return !state.dirty; }
  async function saveCurrent() {
    if (!state.file) { toast('Choose a file first.'); return; }
    const content = window.ArenaEditor?.getValue() ?? $('#projectCode').value;
    try { const saved = await api(`${projectApi(state.project.id)}/file`, { method: 'PUT', body: JSON.stringify({ path: state.file, content, ...(state.hosted && Number.isInteger(state.project.revision) ? { expectedRevision: state.project.revision } : {}) }) }); if (saved.revision) state.project.revision = saved.revision; state.savedText = content; state.dirty = false; $('#projectSave').disabled = true; $('#projectFileName').textContent = state.file; setStatus('Saved to this computer'); await refreshFiles(); toast('File saved'); }
    catch (e) { toast(`Save failed: ${e.message}`); }
  }
  async function previewCurrent() {
    if (state.dirty && !(await ensureSaved())) return;
    let htmlPath = state.file && /\.html?$/i.test(state.file) ? state.file : null;
    if (!htmlPath) htmlPath = state.files.find(f => f.type === 'file' && /(^|\/)index\.html?$/i.test(f.path))?.path;
    if (!htmlPath) return toast('No HTML file found in this project.');
    try {
      const file = await api(fileApi(state.project.id, htmlPath)); const frame = $('#projectFrame');
      const output = $('#projectOutput'); output.innerHTML = `<p>Previewing <b>${esc(htmlPath)}</b>. The preview is sandboxed and does not have access to the editor workspace.</p>`;
      const parentPath = htmlPath.includes('/') ? `${htmlPath.split('/').slice(0, -1).map(enc).join('/')}/` : '';
      const baseTag = `<base href="/api/projects/${enc(state.project.id)}/assets/${parentPath}">`; const html = /<head\b[^>]*>/i.test(file.content) ? file.content.replace(/<head\b[^>]*>/i, tag => tag + baseTag) : baseTag + file.content;
      frame.hidden = false; frame.srcdoc = html; setStatus(`Preview: ${htmlPath}`);
    } catch (e) { toast(e.message); }
  }
  async function checkCurrent() {
    if (!state.file) return toast('Choose a source file first.');
    const ext = state.file.split('.').pop().toLowerCase();
    const actions = { js: 'node-check', cjs: 'node-check', mjs: 'node-check', json: 'json-check', py: 'python-check' };
    const action = actions[ext];
    if (!action) return toast('Syntax checks currently support JavaScript, JSON, and Python files.');
    if (state.dirty) { await saveCurrent(); if (state.dirty) return; }
    const language = action === 'node-check' ? 'JavaScript' : action === 'json-check' ? 'JSON' : 'Python';
    setStatus(`Checking ${language} syntax…`);
    try {
      const r = await api(`${projectApi(state.project.id)}/run`, { method: 'POST', body: JSON.stringify({ action, path: state.file }) });
      const diagnosticText = `${r.stderr || ''}${r.stdout || ''}`;
      if (r.ok) window.ArenaEditor?.setMarkers([]);
      else { const match = diagnosticText.match(/(?:line\s+|:)(\d+)(?::(\d+))?/i); if (match) window.ArenaEditor?.setMarkers([{line:Number(match[1]),column:Number(match[2]||1),message:diagnosticText.slice(-1200),severity:'error',source:language}]); }
      showOutput(r.ok ? `PASS · ${language} syntax is valid.` : `FAIL · ${language} syntax error.`, diagnosticText, r.ok ? 'success' : 'error');
      setStatus(r.ok ? 'Syntax check passed' : 'Syntax check failed');
    } catch (e) { showOutput('CHECK FAILED', e.message, 'error'); setStatus('Syntax check failed'); }
  }
  function stopProcessPolling() {
    if (state.processPoll) clearInterval(state.processPoll);
    state.processPoll = null; state.activeProcessId = null;
  }
  function renderManagedProcess(entry) {
    const output=$('#projectOutput');if(!output)return;
    const hosted=Boolean(state.hosted);
    const port=Number(entry.port);
    const localUrl=Number.isInteger(port)&&port>0&&port<65536?`http://127.0.0.1:${port}`:'';
    const hostedUrl=hosted&&typeof entry.previewUrl==='string'&&entry.previewUrl.startsWith(`/api/projects/${state.project.id}/preview/`)?entry.previewUrl:'';
    const url=hosted?hostedUrl:localUrl;
    const running=['starting','running','stopping'].includes(entry.status);
    output.innerHTML=`<div class="project-output-title ${running?'':entry.status==='stopped'?'success':'error'}">${esc(`DEV SERVER · ${String(entry.status).toUpperCase()}`)}</div><p>${esc(`Script: npm run ${entry.script||'dev'}`)}${url?` · <a href="${esc(url)}" target="_blank" rel="noopener">Open preview ↗</a>`:''}</p><div class="project-git-actions"><button id="projectStopManagedProcess" class="basic-btn" ${running?'':'disabled'}>Stop app</button><button id="projectRefreshManagedProcess" class="basic-btn">Refresh</button>${hostedUrl?'<button id="projectShowHostedPreview" class="basic-btn">Show in preview</button>':''}</div><pre id="managedProcessLogs" class="project-git-output">${esc(entry.output||'Application is starting…')}</pre>${entry.debuggerUrl?`<p><a target="_blank" rel="noopener" href="${esc(entry.debuggerUrl)}">Open Node.js Inspector ↗</a></p>`:''}<p class="modal-copy">${hosted?'Hosted preview runs in a short-lived network-isolated container. Assets are streamed up to 16 MiB. A WebSocket bridge exists for compatible clients, but browser HMR may be restricted by preview sandboxing. The read-only snapshot must be restarted after edits.':'This local process runs as your OS user. It may access local files and the network; stop it when finished.'}</p>`;
    $('#projectShowHostedPreview')?.addEventListener('click',()=>{const frame=$('#projectFrame');frame.removeAttribute('srcdoc');frame.src=hostedUrl;frame.hidden=false;setStatus('Isolated preview opened.');});
    $('#projectStopManagedProcess')?.addEventListener('click',async()=>{
      if(!confirm('Stop this project process and its child processes?'))return;
      try{const result=await api(`${projectApi(state.project.id)}/process`,{method:'POST',body:JSON.stringify({action:'stop',processId:entry.id})});renderManagedProcess(result.process);if(state.processPoll){clearInterval(state.processPoll);state.processPoll=null;}const frame=$('#projectFrame');if(frame){frame.hidden=true;frame.removeAttribute('src');}setStatus('Preview stopped.');}
      catch(error){toast(`Could not stop app: ${error.message}`);}
    });
    $('#projectRefreshManagedProcess')?.addEventListener('click',()=>pollManagedProcess(entry.id));
  }
  async function pollManagedProcess(processId) {
    if (!state.project || !processId) return;
    try {
      const data = await api(`${projectApi(state.project.id)}/process`);
      const entry = data.processes.find(p => p.id === processId);
      if (!entry) { stopProcessPolling(); return; }
      const logs = $('#managedProcessLogs'); if (logs) { logs.textContent = entry.output || 'Waiting for the script to emit output…'; logs.scrollTop = logs.scrollHeight; }
      if (entry.debuggerUrl && !$('#debuggerLink') && logs) logs.insertAdjacentHTML('afterend', `<p><a id="debuggerLink" target="_blank" rel="noopener" href="${esc(entry.debuggerUrl)}">Open Node.js Inspector ↗</a></p>`);
      const title = $('#projectOutput .project-output-title'); if (title) title.textContent = `DEV SERVER · ${String(entry.status).toUpperCase()}`;
      const stop = $('#projectStopManagedProcess'); if (stop) stop.disabled = !['starting', 'running', 'stopping'].includes(entry.status);
      if (!['starting', 'running', 'stopping'].includes(entry.status) && state.processPoll) { clearInterval(state.processPoll); state.processPoll = null; }
    } catch (error) {
      const logs = $('#managedProcessLogs'); if (logs) logs.textContent += `\n[arena] Poll failed: ${error.message}`;
    }
  }
  async function startDevServer() {
    if (state.dirty) { await saveCurrent(); if (state.dirty) return; }
    let pkg;
    try { pkg = JSON.parse((await api(fileApi(state.project.id, 'package.json'))).content); }
    catch { return toast('Create a valid package.json with a dev, start, or preview script first.'); }
    const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
    const options = ['dev', 'start', 'preview'].filter(name => typeof scripts[name] === 'string' && scripts[name].trim());
    if (!options.length) return toast('No dev, start, or preview script was found in package.json.');
    const suggested = options.includes('dev') ? 'dev' : options[0];
    const script = prompt(`Which project script should Arena start?\nAvailable: ${options.join(', ')}`, suggested);
    if (script === null) return;
    if (!options.includes(script.trim())) return toast(`Choose one of: ${options.join(', ')}.`);
    let previewPort = 4173;
    if (state.hosted) {
      const requested = prompt('Preview listener port (3000, 4173, 5173, 8000, or 8080):', '4173');
      if (requested === null) return;
      previewPort = Number(requested);
      if (![3000, 4173, 5173, 8000, 8080].includes(previewPort)) return toast('Choose an allowed preview port.');
    }
    const warning = state.hosted ? `Arena will run the selected npm script in an isolated Docker container with networking disabled, a read-only project snapshot, and a limited lifetime. The project must listen on 127.0.0.1:${previewPort}. Dependencies must be installed through the isolated runner first.` : `Arena will run the package.json script "${script.trim()}" on this computer as your OS user. It may read/write accessible files, access the network, or ignore the requested localhost binding. Only continue for a project you trust. Dependencies must already be installed.`;
    if (!confirm(`${warning}\n\nStart the script now?`)) return;
    try {
      setStatus(`Starting ${script.trim()}…`);
      const result = await api(`${projectApi(state.project.id)}/process`, { method: 'POST', body: JSON.stringify({ action: 'start', script: script.trim(), ...(state.hosted ? { port: previewPort } : {}) }) });
      state.activeProcessId = result.process.id; renderManagedProcess(result.process);
      if (state.processPoll) clearInterval(state.processPoll);
      state.processPoll = setInterval(() => pollManagedProcess(result.process.id), 1500);
      await pollManagedProcess(result.process.id); setStatus(`Started ${script.trim()}`); if(state.hosted){const preview=$('#projectShowHostedPreview');if(preview)preview.click();}
    } catch (error) { toast(`Could not start app: ${error.message}`); setStatus('App start failed'); }
  }


  async function runBuildTask(action) {
    if (state.dirty) { await saveCurrent(); if (state.dirty) return; }
    const status = state.serverStatus || await api('/api/status').catch(() => ({ executionBackend: 'disabled' }));
    const backend = state.hosted ? status.runnerConfigured ? 'remote-runner' : 'disabled' : status.executionBackend;
    if (!['docker','remote-runner'].includes(backend)) return toast(state.hosted ? 'Hosted execution is disabled until the administrator configures the isolated runner.' : 'For isolation, enable ARENA_EXECUTION_BACKEND=docker and restart Arena before installing dependencies or running builds.');
    const install = action === 'npm-install' || action === 'python-install';
    const python = action.startsWith('python-');
    const actionLabel = ({'npm-install':'Install npm dependencies','python-install':'Install Python dependencies','npm-build':'Build project'})[action] || action;
    const text = action === 'npm-install'
      ? 'Packages will be downloaded in an isolated container with lifecycle scripts disabled. Build/test actions use an offline container and read-only dependency cache.'
      : action === 'python-install'
        ? 'Python dependencies are installed from requirements.txt using binary wheels only, inside a disposable network-enabled container. No source-package build scripts are run.'
        : 'Arena will run npm run build in a disposable container without network access. Only a dependency cache created by Arena is mounted read-only; the build script is project code.';
    if (!confirm(`${actionLabel}?\n\n${text}\n\nBackend: ${backend}. Continue?`)) return;
    const label = install ? 'INSTALL DEPENDENCIES' : 'BUILD PROJECT';
    showOutput(label, install ? (python ? 'Installing Python binary wheels in a disposable isolated container…' : 'Installing npm packages in a disposable isolated container…') : 'Running npm run build in a disposable offline container…', ''); setStatus(install ? 'Installing dependencies…' : 'Building project…');
    try {
      const r = await api(`${projectApi(state.project.id)}/run`, { method:'POST', body:JSON.stringify({action}) });
      const backendLabel = r.backend || backend;
      showOutput(r.ok ? `PASS · ${install ? 'Dependencies installed' : 'Build passed'} (${backendLabel})` : `${r.timedOut ? 'TIMEOUT' : 'FAIL'} · ${install ? 'Dependency install' : 'Build'}`, `${r.stdout || ''}${r.stderr || ''}`, r.ok ? 'success' : 'error');
      setStatus(r.ok ? (install ? 'Dependencies cached' : 'Build passed') : (install ? 'Dependency install failed' : 'Build failed'));
    } catch (e) { showOutput(`${label} FAILED`,e.message,'error'); setStatus(`${label} failed`); }
  }
  async function debugCurrentFile() {
    if (!state.file || !/\.(?:js|cjs|mjs)$/i.test(state.file)) return toast('Choose a JavaScript, CommonJS, or ES module file first.');
    if (state.dirty) { await saveCurrent(); if (state.dirty) return; }
    const warning = `Arena will launch ${state.file} with Node.js Inspector listening only on localhost. This executes the file as your OS user and can access files and network resources available to that user. Only debug code you trust.`;
    if (!confirm(`${warning}\n\nStart the Node debugger?`)) return;
    try {
      const result = await api(`${projectApi(state.project.id)}/process`, { method: 'POST', body: JSON.stringify({ action: 'start-debug', path: state.file }) });
      state.activeProcessId = result.process.id; renderManagedProcess(result.process);
      if (state.processPoll) clearInterval(state.processPoll);
      state.processPoll = setInterval(() => pollManagedProcess(result.process.id), 1500);
      await pollManagedProcess(result.process.id); setStatus(`Debugging ${state.file}`);
    } catch (error) { toast(`Could not start debugger: ${error.message}`); }
  }
  async function runTests() {
    if (state.dirty) { await saveCurrent(); if (state.dirty) return; }
    const status = state.serverStatus || await api('/api/status').catch(() => ({ executionBackend: 'disabled' }));
    const hasPackage = state.files.some(f => f.type === 'file' && f.path === 'package.json');
    const hasPythonTests = state.files.some(f => f.type === 'file' && /^(?:test_.*\.py|.*_test\.py|tests\/)/i.test(f.path));
    const action = hasPackage ? 'npm-test' : hasPythonTests ? 'python-test' : null;
    if (!action) return toast('No supported test setup found. Add package.json with a test script or Python unittest files.');
    const backend = state.hosted ? status.runnerConfigured ? 'remote-runner' : 'disabled' : status.executionBackend;
    if (state.hosted && backend !== 'remote-runner') return toast('Hosted tests are disabled until the administrator configures the isolated runner.');
    if (action === 'python-test' && !['docker','remote-runner'].includes(backend)) return toast('Python tests require the isolated Docker runner. Set ARENA_EXECUTION_BACKEND=docker and restart Arena, or configure a hosted runner.');
    const isolated = backend === 'docker' || backend === 'remote-runner';
    const name = action === 'npm-test' ? 'npm test' : 'Python unittest';
    const warning = isolated
      ? 'Arena sends a disposable project copy to an isolated container with networking disabled and resource limits. Dependencies are not installed automatically; run Install deps first. This is not a guarantee of safely running malicious code.'
      : 'The project test script runs on this computer as your OS user. It may access your files, consume resources, or use the network. Continue only if you trust this project.';
    if (!confirm(`Run ${name} using the ${isolated ? 'isolated Docker runner' : 'host test runner'}?\n\n${warning}`)) return;
    setStatus('Running tests (bounded timeout)…'); showOutput('RUNNING TESTS', `Running ${name} using ${isolated ? backend : 'host execution'}. Do not close the workspace.`, '');
    try { const r = await api(`${projectApi(state.project.id)}/run`, { method: 'POST', body: JSON.stringify({ action }) }); showOutput(r.ok ? `PASS · ${name} (${r.backend || backend || 'host'})` : (r.timedOut ? `TIMEOUT · ${name}` : `FAIL · ${name}`), `${r.stdout || ''}${r.stderr || ''}`, r.ok ? 'success' : 'error'); setStatus(r.ok ? 'Tests passed' : 'Tests failed'); }
    catch (e) { showOutput('TEST RUN FAILED', e.message, 'error'); setStatus('Tests failed'); }
  }
  async function openHistoryPanel() {
    if (!state.file) return toast('Select a file first.');
    if (state.dirty) { await saveCurrent(); if (state.dirty) return; }
    const targetPath = state.file; $('#projectFrame').hidden = true; $('#projectOutput').textContent = 'Loading version history…';
    try {
      const data = await api(`${projectApi(state.project.id)}/history?path=${enc(targetPath)}`);
      const output = $('#projectOutput');
      if (!data.versions.length) { output.innerHTML = `<p>No saved versions for <b>${esc(targetPath)}</b> yet. Arena Code records prior contents when a file is overwritten, deleted, or restored.</p>`; return; }
      output.innerHTML = `<p>Previous contents of <b>${esc(targetPath)}</b>. Restoring a version saves the current file as another version first.</p><div class="project-history-list">${data.versions.map(v => `<button class="project-history-item" data-version="${esc(v.id)}"><span><b>${esc(new Date(v.createdAt).toLocaleString())}</b><small>${Number(v.size).toLocaleString()} bytes</small></span><span>Restore ↶</span></button>`).join('')}</div>`;
      output.querySelectorAll('[data-version]').forEach(button => button.onclick = async () => {
        const version = data.versions.find(v => v.id === button.dataset.version); if (!version) return;
        if (!confirm(`Restore ${targetPath} from ${new Date(version.createdAt).toLocaleString()}? The current content will be saved as a version before restore.`)) return;
        try { const restored = await api(`${projectApi(state.project.id)}/history`, { method: 'POST', body: JSON.stringify({ path: targetPath, versionId: version.id, ...(state.hosted && Number.isInteger(state.project.revision) ? { expectedRevision: state.project.revision } : {}) }) }); if (restored.revision) state.project.revision = restored.revision; await refreshFiles(); await selectFile(targetPath); toast('Previous file version restored'); }
        catch (e) { toast(`Restore failed: ${e.message}`); }
      });
    } catch (e) { $('#projectOutput').textContent = `Could not load file history: ${e.message}`; }
  }
  async function openCheckpointsPanel() {
    if (state.hosted) return toast('Project checkpoints are currently local-only.');
    if (!state.project) return;
    if (!(await ensureSaved())) return;
    const projectId = state.project.id;
    $('#projectFrame').hidden = true;
    const output = $('#projectOutput');
    output.textContent = 'Loading project checkpoints…';
    try {
      const result = await api(`${projectApi(projectId)}/checkpoints`);
      const rows = result.checkpoints.map(item => `<button class="project-history-item" data-checkpoint="${esc(item.id)}"><span><b>${esc(item.name)}</b><small>${esc(new Date(item.createdAt).toLocaleString())} · ${Number(item.files)} files · ${Number(item.bytes)} bytes</small></span><span>Restore ↶</span></button>`).join('');
      output.innerHTML = `<h3>Project checkpoints</h3><p>Save a complete local snapshot before a risky edit. Restoring replaces the current project files; stop running development servers first. Only the latest eight snapshots are kept.</p><button id="projectCreateCheckpoint" class="primary-btn">＋ Create checkpoint</button><div class="project-history-list">${rows || '<p>No project checkpoints yet.</p>'}</div>`;
      $('#projectCreateCheckpoint').onclick = async () => {
        const name = prompt('Checkpoint name:', `Before changes · ${new Date().toLocaleString()}`);
        if (name === null) return;
        try { await api(`${projectApi(projectId)}/checkpoints`, { method: 'POST', body: JSON.stringify({ action: 'create', name }) }); toast('Project checkpoint saved'); await openCheckpointsPanel(); }
        catch (e) { toast(`Checkpoint failed: ${e.message}`); }
      };
      for (const element of output.querySelectorAll('[data-checkpoint]')) element.onclick = async () => {
        const item = result.checkpoints.find(v => v.id === element.dataset.checkpoint);
        if (!item || !confirm(`Restore checkpoint "${item.name}"? This replaces the current project files and removes files created since the snapshot.`)) return;
        try { await api(`${projectApi(projectId)}/checkpoints`, { method: 'POST', body: JSON.stringify({ action:'restore', checkpointId:item.id, confirm:true }) });
          state.file = null; state.dirty = false; await refreshFiles(); const first = state.files.find(f => f.type === 'file'); if (first) await selectFile(first.path); toast('Project restored from checkpoint'); await openCheckpointsPanel(); }
        catch (e) { toast(`Restore failed: ${e.message}`); }
      };
    } catch (e) { output.textContent = `Could not load project checkpoints: ${e.message}`; }
  }
  async function gitAction(action, extra = {}) {
    return await api(`${projectApi(state.project.id)}/git`, { method: 'POST', body: JSON.stringify({ action, ...extra }) });
  }
  async function openGitPanel() {
    if (state.dirty) await saveCurrent(); if (state.dirty) return;
    $('#projectFrame').hidden = true;
    $('#projectOutput').innerHTML = `<p>Git runs locally. Repository metadata is hidden from Explorer. Commits disable repository hooks for safety; your global Git identity must be configured.</p><div class="project-git-actions"><button id="gitInit" class="basic-btn">Initialize Git</button><button id="gitRefresh" class="basic-btn">Status</button><button id="gitDiff" class="basic-btn">Show diff</button><button id="gitStage" class="basic-btn">Stage all</button></div><div class="project-git-commit"><input id="gitMessage" class="modal-input" placeholder="Commit message (required)"><button id="gitCommit" class="primary-btn">Commit staged</button></div><pre id="projectGitOutput" class="project-git-output">Loading Git status…</pre><div class="notice-box">Review the diff before staging/committing. Environment-secret files are excluded from staging. Generated code can still contain secrets under other filenames.</div>`;
    const out = $('#projectGitOutput');
    const act = async (action, extra) => { out.textContent = `Running git ${action}…`; try { const r = await gitAction(action, extra); out.textContent = `${r.ok ? 'SUCCESS' : 'GIT REPORTED AN ERROR'}${r.timedOut ? ' (timed out)' : ''}\n${r.stdout || ''}${r.stderr ? `\n${r.stderr}` : ''}`; if (action === 'init' || action === 'stage' || action === 'commit') await refreshFiles(); if (action !== 'diff') setStatus(r.ok ? `Git ${action} complete` : `Git ${action} needs attention`); } catch (e) { out.textContent = `Git request failed: ${e.message}`; } };
    $('#gitInit').onclick = () => confirm('Initialize a Git repository in this project?') && act('init');
    $('#gitRefresh').onclick = () => act('status');
    $('#gitDiff').onclick = () => act('diff');
    $('#gitStage').onclick = () => confirm('Stage all project changes except environment-secret files?') && act('stage');
    $('#gitCommit').onclick = () => { const message = $('#gitMessage').value.trim(); if (!message) return toast('Enter a commit message.'); if (confirm('Commit currently staged changes? Repository hooks will be disabled for this commit.')) act('commit', { message }); };
    act('status');
  }
  function showOutput(title, body, status) {
    $('#projectFrame').hidden = true;
    $('#projectOutput').innerHTML = `<div class="project-output-title ${status}">${esc(title)}</div><pre>${esc(body || '(no output)')}</pre>`;
  }
  async function exportProjectZip() {
    if (state.dirty && !(await ensureSaved())) return;
    try {
      const response = await fetch(`${projectApi(state.project.id)}/archive.zip`);
      if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || `ZIP export failed (${response.status})`); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = `${state.project.name.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'arena-project'}.zip`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500); toast('Exported standard ZIP archive');
    } catch (e) { toast(`ZIP export failed: ${e.message}`); }
  }
  async function exportProject() {
    if (state.dirty && !(await ensureSaved())) return;
    try { const { files } = await api(`${projectApi(state.project.id)}/files`); const payload = { format: 'arena-project-v1', exportedAt: new Date().toISOString(), project: state.project, files: [] };
      for (const f of files.filter(f => f.type === 'file' && f.path !== '.arena-project.json')) { const item = await api(fileApi(state.project.id, f.path)); payload.files.push({ path: item.path, content: item.content, ...(item.encoding === 'base64' ? { encoding: 'base64' } : {}) }); }
      download(`${state.project.name.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'arena-project'}.arena.json`, JSON.stringify(payload, null, 2), 'application/json'); toast(`Exported ${payload.files.length} files as JSON archive`);
    } catch (e) { toast(e.message); }
  }
  function setAgentStatus(text) { const el = $('#projectAgentLog'); if (el) { const line = document.createElement('div'); line.textContent = text; el.append(line); el.scrollTop = el.scrollHeight; } }
  function makeReviewDiff(before, after) {
    const newLines = String(after).split('\n');
    if (before === null) {
      const preview = newLines.slice(0, 70).map(line => `+ ${line}`).join('\n');
      return `New file · ${newLines.length} lines\n\n${preview}${newLines.length > 70 ? '\n… preview truncated' : ''}`;
    }
    const oldLines = String(before).split('\n');
    let start = 0; while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
    let endOld = oldLines.length - 1, endNew = newLines.length - 1;
    while (endOld >= start && endNew >= start && oldLines[endOld] === newLines[endNew]) { endOld--; endNew--; }
    const removed = Math.max(0, endOld - start + 1), added = Math.max(0, endNew - start + 1);
    if (oldLines.length + newLines.length > 5000 || removed + added > 140) return `File summary: ${oldLines.length} → ${newLines.length} lines; changed region is too large for an inline diff. New content preview:\n${newLines.slice(0, 35).map(x => `+ ${x}`).join('\n')}${newLines.length > 35 ? '\n… preview truncated' : ''}`;
    const from = Math.max(0, start - 3), beforeEnd = Math.min(oldLines.length, endOld + 4), afterEnd = Math.min(newLines.length, endNew + 4);
    const context = oldLines.slice(from, start).map(x => `  ${x}`);
    const remove = oldLines.slice(start, endOld + 1).map(x => `- ${x}`);
    const add = newLines.slice(start, endNew + 1).map(x => `+ ${x}`);
    const tail = newLines.slice(endNew + 1, afterEnd).map(x => `  ${x}`);
    const lines = [...context, ...remove, ...add, ...tail];
    return `Changed region · ${oldLines.length} → ${newLines.length} lines\n\n${lines.join('\n').slice(0, 8500)}${lines.join('\n').length > 8500 ? '\n… diff truncated' : ''}`;
  }
  function agentModel() { if (typeof studio !== 'undefined' && studio.source === 'browser') return studio.ready ? 'browser' : null; if (typeof studio !== 'undefined' && studio.providerDemo) return null; return typeof models !== 'undefined' ? models[0] : 'openai/gpt-4.1'; }
  async function callAgentModel(messages) {
    const source = agentModel();
    if (!source) throw new Error('No real AI engine is configured. Load the free local model in “Free AI engine” or configure AI_API_KEY on the server. Demo templates are not used by the agent.');
    if (source === 'browser') {
      const completion = await studio.engine.chat.completions.create({ messages, temperature: 0.15, max_tokens: 1800 });
      return completion.choices?.[0]?.message?.content || '';
    }
    const r = await api('/api/chat', { method: 'POST', body: JSON.stringify({ model: source, messages }) });
    if (r.demo || !r.text) throw new Error('The server did not return a real model response.');
    return r.text;
  }
  function parseAgentAction(text) {
    let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const first = t.indexOf('{'), last = t.lastIndexOf('}'); if (first < 0 || last <= first) throw new Error('Agent did not return a JSON tool action. Try again with a shorter task.');
    const obj = JSON.parse(t.slice(first, last + 1));
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Invalid agent action.');
    return obj;
  }
  async function runAgent() {
    if (state.busy) return;
    if (state.dirty) { await saveCurrent(); if (state.dirty) return; }
    const task = $('#projectTask').value.trim(); if (!task) return toast('Describe the task for the coding agent first.');
    if (!agentModel()) { openAI(); toast('Configure a real AI engine first.'); return; }
    state.busy = true; state.agentStop = false; $('#projectAgentRun').disabled = true; $('#projectAgentStop').disabled = false; $('#projectAgentLog').textContent = '';
    const prompt = `PROJECT: ${state.project.name}\nTASK: ${task}\n\nYou operate the user's local project through tools. First inspect relevant files. Return exactly one JSON object and no prose per turn. Allowed actions:\n{"tool":"list_files"}\n{"tool":"read_file","path":"relative/path"}\n{"tool":"search_files","query":"literal text to find"}\n{"tool":"write_file","path":"relative/path","content":"complete file content","reason":"why this change is needed"}\n{"tool":"delete_file","path":"relative/path","reason":"why removal is needed"}\n{"tool":"node_check","path":"relative/file.js"}\n{"tool":"json_check","path":"relative/file.json"}\n{"tool":"python_check","path":"relative/file.py"}\n{"tool":"patch_file","path":"relative/file.js","find":"unique exact text","replace":"replacement text","reason":"why this small patch is needed"}\n{"tool":"npm_test"}\n{"done":true,"message":"summary of changes and verification, honestly stating what was not tested"}\nNever use absolute paths, ../, environment files, node_modules, .git, or hidden secrets. Avoid deleting files unless essential. Prefer patch_file for precise unique-text changes and write_file only when a complete file replacement is appropriate. Do one action per turn. Do not claim tests passed without tool output. Keep any one text file under 200 KB. Do not attempt to read binary assets. Finish within 24 actions. After any edit, run npm_test when a test script exists. If it fails, inspect the errors and make a focused repair; do not call done:true until a subsequent run passes, or explicitly report the failure.`;
    const messages = [{ role: 'system', content: 'You are an autonomous software engineering agent running inside Arena Code. You must inspect project files before changing them. Reply with one strict JSON object only, no markdown, no explanation outside JSON. No shell tool exists. Use only the documented actions. Be conservative and do not invent tool results.' }, { role: 'user', content: prompt }];
    setAgentStatus('Starting task. Inspecting project…');
    if (!state.hosted) {
      try { const saved = await api(`${projectApi(state.project.id)}/checkpoints`, { method:'POST', body:JSON.stringify({ action:'create', name:`Before agent task · ${new Date().toISOString()}` }) });
        setAgentStatus(`Safety checkpoint created: ${saved.checkpoint.id}. Restore it through Checkpoints if the task goes wrong.`); }
      catch (error) { setAgentStatus(`Safety checkpoint unavailable: ${error.message}. Review and back up your project before approving risky changes.`); }
    }
    let finished = false, mutations = 0, lastVerifiedMutation = -1, testFailures = 0, testDeclined = false;
    let hasTestScript = false;
    try { const pkg = JSON.parse((await api(fileApi(state.project.id, 'package.json'))).content); hasTestScript = typeof pkg?.scripts?.test === 'string' && Boolean(pkg.scripts.test.trim()); } catch {}
    try {
      for (let step = 1; step <= 24; step++) {
        if (state.agentStop) { setAgentStatus('Stopped by user.'); break; }
        setStatus(`Agent step ${step}/24`);
        const contextMessages = messages.length > 10 ? [messages[0], messages[1], ...messages.slice(-8)] : messages;
        const raw = await callAgentModel(contextMessages);
        if (state.agentStop) { setAgentStatus('Stopped after the current model request; no new tool action was applied.'); break; }
        messages.push({ role: 'assistant', content: raw });
        let action;
        try { action = parseAgentAction(raw); }
        catch (e) { messages.push({ role: 'user', content: `Tool result: ${e.message} Return a valid JSON object using one allowed action.` }); setAgentStatus(`Step ${step}: invalid action format; asking model to retry.`); continue; }
        if (action.done === true) {
          if (mutations > 0 && hasTestScript && lastVerifiedMutation !== mutations && !testDeclined && testFailures < 3) {
            setAgentStatus('Checking the result before accepting the model’s completion…');
            let testResult;
            try { testResult = await executeAgentTool({tool:'npm_test'}); } catch(error) { testResult={ok:false,error:error.message}; }
            if(state.agentStop){setAgentStatus('Stopped before applying any further repair.');break;}
            if(testResult.ok){lastVerifiedMutation=mutations;setAgentStatus('Final npm test passed on the current project revision.');}
            else if(testResult.error==='User declined test execution.'){testDeclined=true;setAgentStatus('Tests were declined; this task cannot be labeled verified.');}
            else {testFailures++;setAgentStatus(`Verification failed (${testFailures}/3). Asking the agent to inspect the error and repair its changes.`);messages.push({role:'user',content:`The current revision did NOT pass npm test. Failure: ${JSON.stringify(testResult).slice(0,5000)}. Inspect files and repair. Do not claim completion until tests pass.`});continue;}
          }
          finished = true;
          setAgentStatus(`Finished${mutations===0?' (no file edits)':!hasTestScript?' (no test script available)':lastVerifiedMutation===mutations?' (tests passed)':' (UNVERIFIED)'}: ${String(action.message || 'Task ended.').slice(0, 1800)}`);
          break;
        }
        if (typeof action.tool !== 'string') { messages.push({ role: 'user', content: 'Tool result: action must include a tool field or done:true.' }); continue; }
        let result;
        try { result = await executeAgentTool(action); }
        catch (e) { result = { ok: false, error: e.message }; }
        if (result.ok && ['write_file','patch_file','delete_file'].includes(action.tool)) mutations++;
        if (action.tool==='npm_test') { if(result.ok)lastVerifiedMutation=mutations;else if(result.error==='User declined test execution.')testDeclined=true;else testFailures++; }
        const summary = JSON.stringify(result);
        messages.push({ role: 'user', content: `Tool result for ${action.tool}: ${summary.slice(0, 14_000)}. Now choose the next single action or finish.` });
        setAgentStatus(`${step}. ${action.tool} → ${result.ok ? 'success' : 'needs attention'}${result.path ? ` (${result.path})` : ''}${result.message ? `: ${result.message}` : ''}`);
        await refreshFiles();
        if (!state.file) { const nextFile = state.files.find(f => f.type === 'file'); if (nextFile) await selectFile(nextFile.path); }
      }
      if (!state.agentStop && !finished) setAgentStatus('Stopped after the 24-action limit or three failed verifications. The task may be incomplete; review the changes and run checks.');
      if (!state.agentStop) setStatus(finished ? 'Agent task finished' : 'Agent action limit reached');
    } catch (e) { setAgentStatus(`Agent error: ${e.message}`); setStatus('Agent stopped with an error'); }
    finally { state.busy = false; if ($('#projectAgentRun')) $('#projectAgentRun').disabled = false; if ($('#projectAgentStop')) $('#projectAgentStop').disabled = true; }
  }
  async function executeAgentTool(action) {
    if (action.tool === 'list_files') return { ok: true, files: (await api(`${projectApi(state.project.id)}/files`)).files.filter(f => f.path !== '.arena-project.json').map(f => ({ path: f.path, type: f.type, size: f.size })) };
    if (action.tool === 'read_file') { if (typeof action.path !== 'string') throw new Error('path is required'); const f = await api(fileApi(state.project.id, action.path)); if (f.encoding === 'base64') return { ok: true, path: f.path, binary: true, size: f.size, message: 'Binary asset; do not interpret its base64 as source code.' }; return { ok: true, path: f.path, content: f.content.slice(0, 5_000), truncated: f.content.length > 5_000 }; }
    if (action.tool === 'search_files') {
      if (typeof action.query !== 'string' || !action.query.trim()) throw new Error('query is required');
      let found = []; const needle = action.query.toLowerCase();
      const files = (await api(`${projectApi(state.project.id)}/files`)).files.filter(f => f.type === 'file' && f.path !== '.arena-project.json').slice(0, 120);
      for (const file of files) { if (state.agentStop) break; if (file.size > 150_000) continue; let data; try { data = await api(fileApi(state.project.id, file.path)); } catch { continue; }
        const lines = data.content.split('\n'); for (let i = 0; i < lines.length; i++) if (lines[i].toLowerCase().includes(needle)) { found.push({ path: file.path, line: i + 1, text: lines[i].slice(0, 300) }); if (found.length >= 40) return { ok: true, matches: found }; }
      }
      return { ok: true, matches: found };
    }
    if (action.tool === 'write_file') {
      if (typeof action.path !== 'string' || typeof action.content !== 'string') throw new Error('path and complete content are required');
      if (action.content.length > 200_000) throw new Error('File too large for agent writes (maximum 200 KB).');
      if (/(^|\/)(\.env(?:\.|$)|node_modules|\.git|\.arena-project\.json)(\/|$)/i.test(action.path) || action.path.split(/[\\/]/).includes('..')) throw new Error('Agent is not allowed to modify sensitive or reserved paths.');
      if (binaryExt.test(action.path)) throw new Error('The agent cannot rewrite binary assets. Import the replacement asset through the project workspace.');
      const previous = await api(fileApi(state.project.id, action.path)).catch(e => e.message.includes('not found') ? null : Promise.reject(e));
      if (previous?.encoding === 'base64') throw new Error('This path currently contains a binary asset. Replace it through file import instead of a text agent action.');
      const preview = makeReviewDiff(previous?.content ?? null, action.content);
      const approved = confirm(`Agent wants to ${previous ? 'replace' : 'create'} ${action.path}.\n\nReason: ${String(action.reason || 'Not provided').slice(0, 300)}\n\n${preview}\n\nApply this file change? Arena Code saves the prior file version in History when possible; this is not a complete project backup.`);
      if (!approved) return { ok: false, path: action.path, error: 'User rejected this file change.' };
      const saved = await api(`${projectApi(state.project.id)}/file`, { method: 'PUT', body: JSON.stringify({ path: action.path, content: action.content, ...(state.hosted && Number.isInteger(state.project.revision) ? { expectedRevision: state.project.revision } : {}) }) }); if (saved.revision) state.project.revision = saved.revision; await refreshFiles();
      if (state.file === action.path) { state.savedText = action.content; state.dirty = false; $('#projectCode').value = action.content; window.ArenaEditor?.setValue(action.content); $('#projectSave').disabled = true; }
      return { ok: true, path: action.path, message: previous ? 'Existing file replaced after approval.' : 'New file created after approval.' };
    }
    if (action.tool === 'patch_file') {
      if (typeof action.path !== 'string' || typeof action.find !== 'string' || !action.find.length || typeof action.replace !== 'string') throw new Error('path, non-empty find, and replace strings are required.');
      if (action.find.length > 100_000 || action.replace.length > 150_000) throw new Error('Patch is too large. Keep find under 100 KB and replacement under 150 KB.');
      const previous = await api(fileApi(state.project.id, action.path));
      if (previous.encoding === 'base64') throw new Error('Binary files cannot be patched by the coding agent.');
      const first = previous.content.indexOf(action.find);
      if (first < 0) throw new Error('Exact text to replace was not found; inspect the current file and retry.');
      if (previous.content.indexOf(action.find, first + action.find.length) >= 0) throw new Error('Exact text occurs more than once. Use a larger unique context or edit the full file.');
      const updated = previous.content.slice(0, first) + action.replace + previous.content.slice(first + action.find.length);
      const preview = makeReviewDiff(previous.content, updated);
      const approved = confirm(`Agent requests a small patch to ${action.path}.\n\nReason: ${String(action.reason || 'Not provided').slice(0, 300)}\n\n${preview}\n\nApply this patch?`);
      if (!approved) return { ok: false, path: action.path, error: 'User rejected this patch.' };
      const saved = await api(`${projectApi(state.project.id)}/file`, { method: 'PUT', body: JSON.stringify({ path: action.path, content: updated, ...(state.hosted && Number.isInteger(state.project.revision) ? { expectedRevision: state.project.revision } : {}) }) }); if (saved.revision) state.project.revision = saved.revision; await refreshFiles();
      if (state.file === action.path) { state.savedText = updated; state.dirty = false; $('#projectCode').value = updated; window.ArenaEditor?.setValue(updated); $('#projectSave').disabled = true; }
      return { ok: true, path: action.path, message: 'Unique exact-text patch applied after approval.' };
    }
    if (action.tool === 'delete_file') {
      if (typeof action.path !== 'string') throw new Error('path is required');
      if (!confirm(`Agent requests deletion of ${action.path}. Reason: ${String(action.reason || 'Not provided').slice(0, 250)}\n\nDelete this file?`)) return { ok: false, error: 'User rejected file deletion.' };
      await api(`${fileApi(state.project.id, action.path)}${state.hosted && Number.isInteger(state.project.revision) ? `&expectedRevision=${enc(state.project.revision)}` : ''}`, { method: 'DELETE' }); await refreshFiles(); if (state.file === action.path) { state.file = null; state.dirty = false; state.savedText = ''; $('#projectCode').value = ''; $('#projectCode').disabled = true; $('#projectSave').disabled = true; $('#projectFileName').textContent = 'Select a file'; $('#projectLanguage').textContent = ''; }
      return { ok: true, path: action.path };
    }
    if (['node_check', 'json_check', 'python_check'].includes(action.tool)) {
      const f = typeof action.path === 'string' ? action.path : state.file; if (!f) throw new Error('path required');
      if (state.dirty) await saveCurrent(); if (state.dirty) throw new Error('Save failed; refusing to check stale content.');
      const checkAction = ({ node_check: 'node-check', json_check: 'json-check', python_check: 'python-check' })[action.tool];
      const r = await api(`${projectApi(state.project.id)}/run`, { method: 'POST', body: JSON.stringify({ action: checkAction, path: f }) });
      showOutput(r.ok ? `PASS · ${f}` : `FAIL · ${f}`, `${r.stdout || ''}${r.stderr || ''}`, r.ok ? 'success' : 'error'); return { ok: r.ok, path: f, output: `${r.stdout || ''}${r.stderr || ''}`.slice(0, 4000) };
    }
    if (action.tool === 'npm_test') {
      const status = await api('/api/status').catch(() => ({ executionBackend: 'host' }));
      const isolated = ['docker','remote-runner'].includes(status.executionBackend);
      const warning = isolated
        ? 'Arena will copy the project to a disposable Docker container with networking disabled and resource limits. Docker and the image must already be installed; dependencies are not installed automatically. This is partial isolation, not a guarantee of safely running malicious code.'
        : 'This runs the project-defined test script on your computer as your OS user. It may access your files and network. Continue only if you trust this project.';
      if (!confirm(`The coding agent requests npm test using the ${isolated ? 'isolated test runner' : 'host test runner'}.\n\n${warning}`)) return { ok: false, error: 'User declined test execution.' };
      if (state.dirty) await saveCurrent(); if (state.dirty) throw new Error('Save failed; refusing to test stale content.');
      const r = await api(`${projectApi(state.project.id)}/run`, { method: 'POST', body: JSON.stringify({ action: 'npm-test' }) }); showOutput(r.ok ? `PASS · npm test (${r.backend || status.executionBackend || 'host'})` : 'FAIL · npm test', `${r.stdout || ''}${r.stderr || ''}`, r.ok ? 'success' : 'error'); return { ok: r.ok, backend: r.backend || status.executionBackend, output: `${r.stdout || ''}${r.stderr || ''}`.slice(0, 4000), timedOut: r.timedOut };
    }
    throw new Error(`Unsupported tool: ${action.tool}`);
  }
  // Make the project workspace reachable from the main navigation and command center.
  const nav = document.querySelector('nav');
  if (nav) nav.insertAdjacentHTML('beforeend', `<button class="nav-studio" id="projectWorkspaceBtn">${PROJECT_ICON}Projects & coding agent <span class="new-tag">BETA</span></button>`);
  $('#projectWorkspaceBtn')?.addEventListener('click', openProjectHub);
  $('#modal')?.addEventListener('close', stopProcessPolling);
  window.arenaOpenProjectHub = openProjectHub;
})();
