/* Arena Code editor adapter. Monaco is loaded on demand; the local textarea remains a robust offline fallback. */
(() => {
  'use strict';
  const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min';
  const LOCAL = '/vendor/monaco';
  const state = { assetBase: CDN, loader: null, editor: null, target: null, fallback: null, gutter: null, value: '', language: 'plaintext', filePath: null, readOnly: true, suppress: false, changeHandler: null, models: new Map(), ws: null, lspPending: new Map(), lspId: 0, lspReady: false, lspLanguage: null, lspProjectId: null, lspPath: null, lspVersion: 0, lspDebounce: null, markerOwner: 'arena-lsp', providers: [], connectionState: 'fallback' };
  const languageByExt = {
    js:'javascript', mjs:'javascript', cjs:'javascript', jsx:'javascript', ts:'typescript', tsx:'typescript', json:'json', jsonc:'json', html:'html', htm:'html', css:'css', scss:'scss', less:'less', md:'markdown', py:'python', java:'java', c:'c', h:'c', cpp:'cpp', cc:'cpp', hpp:'cpp', cs:'csharp', go:'go', rs:'rust', php:'php', rb:'ruby', sh:'shell', bash:'shell', yml:'yaml', yaml:'yaml', xml:'xml', sql:'sql', dockerfile:'dockerfile', toml:'ini', ini:'ini', txt:'plaintext'
  };
  function langFor(path) { const base = String(path || '').split('/').pop().toLowerCase(); if (base === 'dockerfile') return 'dockerfile'; const ext = base.includes('.') ? base.split('.').pop() : ''; return languageByExt[ext] || 'plaintext'; }
  function uriFor(path) { return `file:///workspace/${String(path || 'untitled').split('/').map(encodeURIComponent).join('/')}`; }
  function loadMonaco() {
    if (state.loader) return state.loader;
    state.loader = new Promise(async (resolve, reject) => {
      // Prefer self-hosted assets (installed by postinstall); fall back to CDN for unpacked/no-install use.
      try { const local = await fetch(`${LOCAL}/vs/loader.js`, { method: 'HEAD', cache: 'no-store' }); state.assetBase = local.ok ? LOCAL : CDN; }
      catch { state.assetBase = CDN; }
      const configure = () => {
        try {
          window.MonacoEnvironment = window.MonacoEnvironment || {};
          window.MonacoEnvironment.getWorkerUrl = function (_moduleId, label) {
            const worker = label === 'typescript' || label === 'javascript' ? 'language/typescript/tsWorker.js' : 'editor/editor.worker.js';
            const base = state.assetBase;
            const source = `self.MonacoEnvironment={baseUrl:'${base}/'};importScripts('${base}/vs/${worker}');`;
            return `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
          };
          window.require.config({ paths: { vs: `${state.assetBase}/vs` } });
          window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
        } catch (e) { reject(e); }
      };
      if (window.monaco?.editor) { resolve(window.monaco); return; }
      if (window.require?.config) { configure(); return; }
      const script = document.createElement('script'); script.src = `${state.assetBase}/vs/loader.js`; script.async = true;
      script.onload = configure; script.onerror = () => reject(new Error('Could not load Monaco Editor. Check local assets or network access for CDN fallback.')); document.head.appendChild(script);
    });
    return state.loader;
  }
  function callback(value) { state.value = value; if (!state.suppress && state.changeHandler) state.changeHandler(value); if (state.lspReady && state.lspPath === state.filePath) notifyChange(value); }
  function setValue(value) {
    state.value = String(value ?? ''); state.suppress = true;
    if (state.editor && state.filePath) {
      const model = getOrCreateModel(state.filePath, state.language, state.value);
      if (model.getValue() !== state.value) model.setValue(state.value);
      if (state.editor.getModel() !== model) state.editor.setModel(model);
    }
    if (state.fallback && state.fallback.value !== state.value) state.fallback.value = state.value;
    if (state.gutter) { const count = Math.max(1, state.value.split('\n').length); state.gutter.textContent = Array.from({length:count},(_,i)=>String(i+1)).join('\n'); }
    state.suppress = false;
  }
  function getOrCreateModel(path, language, value) {
    const monaco = window.monaco; const uri = monaco.Uri.parse(uriFor(path)); let model = state.models.get(path);
    if (model && !model.isDisposed() && model.getLanguageId() !== language) { monaco.editor.setModelLanguage(model, language); }
    if (!model || model.isDisposed()) { model = monaco.editor.createModel(value, language, uri); state.models.set(path, model); }
    else if (model.getValue() !== value && path !== state.filePath) { model.setValue(value); }
    return model;
  }
  function setFile(path, value, readOnly = false) {
    state.filePath = path || null; state.value = String(value ?? ''); state.language = langFor(path); state.readOnly = Boolean(readOnly);
    if (state.fallback) { state.fallback.value = state.value; state.fallback.disabled = state.readOnly; }
    if (state.editor && path) {
      let model = getOrCreateModel(path, state.language, state.value);
      if (model.getValue() !== state.value) model.setValue(state.value);
      state.editor.setModel(model); state.editor.updateOptions({ readOnly: state.readOnly });
      state.suppress = true; state.value = model.getValue(); state.suppress = false;
      connectLanguageServer(path, state.language, state.value).catch(() => {});
    } else if (state.editor) { state.editor.setModel(null); closeLanguageServer(); }
    if (state.gutter) state.gutter.hidden = Boolean(state.editor);
  }
  function setMarkers(markers) {
    if (!window.monaco || !state.filePath) return;
    const model = state.editor?.getModel(); if (!model) return;
    window.monaco.editor.setModelMarkers(model, state.markerOwner, (markers || []).map(m => ({
      startLineNumber: Math.max(1, Number(m.line || m.startLineNumber) || 1), startColumn: Math.max(1, Number(m.column || m.startColumn) || 1),
      endLineNumber: Math.max(1, Number(m.endLine || m.endLineNumber || m.line || m.startLineNumber) || 1), endColumn: Math.max(2, Number(m.endColumn) || ((Number(m.column || m.startColumn) || 1) + 1)),
      message: String(m.message || 'Diagnostic').slice(0,1000), severity: m.severity === 'warning' ? window.monaco.MarkerSeverity.Warning : window.monaco.MarkerSeverity.Error, source: m.source || 'Arena'
    })));
  }
  async function mount({ onChange } = {}) {
    state.target = document.getElementById('projectMonaco'); state.fallback = document.getElementById('projectCode'); state.gutter = document.getElementById('projectLineNumbers'); state.changeHandler = onChange || state.changeHandler;
    if (!state.target || !state.fallback) return false;
    state.target.hidden = true;
    state.fallback.addEventListener('input', () => { if (!state.editor) callback(state.fallback.value); });
    try {
      const monaco = await loadMonaco();
      if (!state.target?.isConnected || !state.fallback?.isConnected) return false;
      if (!state.editor) {
        monaco.languages.typescript.javascriptDefaults.setCompilerOptions({ target: monaco.languages.typescript.ScriptTarget.ES2022, allowNonTsExtensions: true, allowJs: true, checkJs: true, strict: false, lib: ['es2022','dom'] });
        monaco.languages.typescript.typescriptDefaults.setCompilerOptions({ target: monaco.languages.typescript.ScriptTarget.ES2022, module: monaco.languages.typescript.ModuleKind.ESNext, moduleResolution: monaco.languages.typescript.ModuleResolutionKind.Bundler, strict: false, allowNonTsExtensions: true, lib: ['es2022','dom'] });
        monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false, noSuggestionDiagnostics: false });
        state.editor = monaco.editor.create(state.target, { value: state.value || state.fallback.value || '', language: state.language, theme: document.body.classList.contains('dark') ? 'vs-dark' : 'vs', automaticLayout: true, readOnly: state.readOnly, fontSize: 12, lineHeight: 20, tabSize: 2, insertSpaces: true, minimap: { enabled: true, scale: 0.8 }, scrollBeyondLastLine: false, renderWhitespace: 'selection', bracketPairColorization: { enabled: true }, guides: { indentation: true, bracketPairs: true }, folding: true, stickyScroll: { enabled: true }, smoothScrolling: true, wordWrap: 'off', cursorSmoothCaretAnimation: 'on', quickSuggestions: { other: true, comments: false, strings: true }, suggestOnTriggerCharacters: true, parameterHints: { enabled: true }, suggest: { preview: true, showMethods: true, showFunctions: true, showFields: true, showVariables: true, showWords: true, snippetsPreventQuickSuggestions: false }, ariaLabel: 'Arena Code editor' });
        state.editor.onDidChangeModelContent(() => { if (state.editor) callback(state.editor.getValue()); });
        state.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { document.getElementById('projectSave')?.click(); });
        state.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => state.editor.getAction('editor.action.formatDocument')?.run());
        state.editor.addAction({ id: 'arena-save-file', label: 'Save file', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS], run: () => document.getElementById('projectSave')?.click() });
      }
      state.fallback.hidden = true; state.gutter.hidden = true; state.target.hidden = false; state.target.classList.add('monaco-ready');
      setFile(state.filePath, state.value || state.fallback.value, state.readOnly);
      document.getElementById('projectEditorMode')?.replaceChildren(document.createTextNode('Monaco · IntelliSense enabled'));
      return true;
    } catch (error) {
      state.connectionState = 'fallback'; if (state.target) state.target.hidden = true; if (state.fallback) state.fallback.hidden = false;
      const status = document.getElementById('projectEditorMode'); if (status) status.textContent = 'Offline text editor';
      return false;
    }
  }
  function request(method, params, timeout = 7000) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN || !state.lspReady) return Promise.reject(new Error('Language server is not ready.'));
    const id = ++state.lspId; const packet = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { state.lspPending.delete(id); reject(new Error('LSP request timed out')); }, timeout);
      state.lspPending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: err => { clearTimeout(timer); reject(err); } }); state.ws.send(JSON.stringify(packet));
    });
  }
  function notify(method, params) { if (state.ws?.readyState === WebSocket.OPEN && state.lspReady) state.ws.send(JSON.stringify({ jsonrpc:'2.0', method, params })); }
  function lspTextDocument() { return { uri: uriFor(state.lspPath) }; }
  function notifyChange(value) {
    clearTimeout(state.lspDebounce); state.lspDebounce = setTimeout(() => { if (!state.lspReady || !state.lspPath) return; state.lspVersion++; notify('textDocument/didChange', { textDocument: { uri: uriFor(state.lspPath), version: state.lspVersion }, contentChanges: [{ text: value }] }); }, 140);
  }
  function closeLanguageServer() {
    clearTimeout(state.lspDebounce); state.lspReady = false; state.lspPath = null; state.lspLanguage = null; state.lspProjectId = null;
    for (const [id, req] of state.lspPending) { req.reject(new Error('Language server closed.')); state.lspPending.delete(id); }
    if (state.ws) { try { state.ws.close(); } catch {} state.ws = null; }
  }
  async function connectLanguageServer(path, language, value) {
    const languageKey = ({ python:'python', rust:'rust', go:'go', java:'java', csharp:'csharp', typescript:'typescript', javascript:'typescript' })[language];
    if (!languageKey || !window.monaco) { closeLanguageServer(); const label = document.getElementById('projectEditorMode'); if (label) label.textContent = 'Monaco · IntelliSense'; return; }
    const current = await fetch('/api/lsp/status').then(r => r.ok ? r.json() : { servers:{} }).catch(() => ({ servers:{} }));
    if (!current.servers?.[languageKey]) { closeLanguageServer(); const label = document.getElementById('projectEditorMode'); if (label) label.textContent = language === 'javascript' || language === 'typescript' ? 'Monaco · built-in JS/TS IntelliSense' : `Monaco · ${language} server not configured`; return; }
    const projectId = String(window.arenaProjectId || '');
    if (state.ws && state.ws.readyState === WebSocket.OPEN && state.lspReady && state.lspLanguage === languageKey && state.lspProjectId === projectId) {
      if (state.lspPath === path) {
        state.lspVersion++;
        notify('textDocument/didChange', { textDocument: { uri: uriFor(path), version: state.lspVersion }, contentChanges: [{ text: value }] });
      } else {
        notify('textDocument/didClose', { textDocument: lspTextDocument() });
        state.lspPath = path; state.lspVersion = 1;
        notify('textDocument/didOpen', { textDocument: { uri: uriFor(path), languageId: language, version: state.lspVersion, text: value } });
      }
      return;
    }
    closeLanguageServer(); state.lspPath = path; state.lspLanguage = languageKey; state.lspProjectId = projectId; state.lspVersion = 1;
    const base = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/lsp?projectId=${encodeURIComponent(window.arenaProjectId || '')}&language=${encodeURIComponent(languageKey)}`;
    const ws = new WebSocket(base); state.ws = ws; const label = document.getElementById('projectEditorMode'); if (label) label.textContent = `Connecting ${languageKey} language server…`;
    ws.onmessage = async event => {
      let message; try { message = JSON.parse(event.data); } catch { return; }
      if (message.method === 'arena/lspError') { if (label) label.textContent = `LSP unavailable: ${message.params?.message || 'server error'}`; return; }
      if (message.method && message.id != null && ws === state.ws) { let result = null; if (message.method === 'workspace/configuration') result = (message.params?.items || []).map(() => ({})); else if (message.method === 'client/registerCapability' || message.method === 'window/workDoneProgress/create' || message.method === 'workspace/applyEdit') result = message.method === 'workspace/applyEdit' ? { applied: false, failureReason: 'Arena LSP bridge does not permit automatic workspace edits.' } : null; ws.send(JSON.stringify({jsonrpc:'2.0',id:message.id,result})); return; }
      if (message.method === 'textDocument/publishDiagnostics' && message.params?.uri) {
        const filePath = decodeURIComponent(message.params.uri.replace(/^file:\/\/\/workspace\//, ''));
        if (filePath === state.filePath) setMarkers((message.params.diagnostics || []).map(d => ({ line: d.range?.start?.line + 1, column: d.range?.start?.character + 1, endLine: d.range?.end?.line + 1, endColumn: d.range?.end?.character + 1, message: d.message, severity: d.severity === 2 ? 'warning' : 'error', source: d.source || 'LSP' })));
      }
      if (message.id != null && state.lspPending.has(message.id)) { const p = state.lspPending.get(message.id); state.lspPending.delete(message.id); message.error ? p.reject(new Error(message.error.message || 'LSP error')) : p.resolve(message.result); }
    };
    ws.onopen = async () => {
      try {
        const initId = ++state.lspId;
        const initResult = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('LSP initialize timed out')), 7000); state.lspPending.set(initId, {resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}}); ws.send(JSON.stringify({ jsonrpc:'2.0', id:initId, method:'initialize', params:{ processId:null, rootUri:'file:///workspace', workspaceFolders:[{uri:'file:///workspace',name:'Arena Project'}], capabilities:{ textDocument:{ synchronization:{dynamicRegistration:false,willSave:false,willSaveWaitUntil:false,didSave:false}, completion:{completionItem:{snippetSupport:true,documentationFormat:['markdown','plaintext']}}, hover:{contentFormat:['markdown','plaintext']}, definition:{}, publishDiagnostics:{relatedInformation:true} }, workspace:{ configuration:true, workspaceFolders:true } }, clientInfo:{name:'Arena Code',version:'0.6.0'} } })); });
        if (!state.ws || state.ws !== ws) return;
        state.lspReady = true; ws.send(JSON.stringify({jsonrpc:'2.0',method:'initialized',params:{}}));
        notify('textDocument/didOpen',{textDocument:{uri:uriFor(path),languageId:language,version:state.lspVersion,text:value}});
        registerLspProviders(languageKey);
        if (label) label.textContent = `${languageKey} language server connected`;
      } catch (e) { if (label) label.textContent = `LSP unavailable: ${e.message}`; closeLanguageServer(); }
    };
    ws.onerror = () => { if (label) label.textContent = `${languageKey} LSP connection failed`; };
    ws.onclose = () => { if (state.ws === ws) { state.lspReady = false; for (const [id,p] of state.lspPending) { p.reject(new Error('LSP disconnected')); state.lspPending.delete(id); } } };
  }
  function registerLspProviders(language) {
    const monaco = window.monaco; const languageId = ({python:'python',rust:'rust',go:'go',java:'java',csharp:'csharp',typescript:'typescript'})[language] || language;
    if (state.providers.some(p => p.language === languageId)) return;
    const completion = monaco.languages.registerCompletionItemProvider(languageId, { triggerCharacters: ['.','(',':'], provideCompletionItems: async (model, pos) => {
      if (!state.lspReady || model.uri.toString() !== uriFor(state.lspPath)) return { suggestions: [] };
      try { let result = await request('textDocument/completion',{textDocument:lspTextDocument(),position:{line:pos.lineNumber-1,character:pos.column-1}}); const items = Array.isArray(result) ? result : (result?.items || []); const kindMap = {1:monaco.languages.CompletionItemKind.Text,2:monaco.languages.CompletionItemKind.Method,3:monaco.languages.CompletionItemKind.Function,4:monaco.languages.CompletionItemKind.Constructor,5:monaco.languages.CompletionItemKind.Field,6:monaco.languages.CompletionItemKind.Variable,7:monaco.languages.CompletionItemKind.Class,8:monaco.languages.CompletionItemKind.Interface,9:monaco.languages.CompletionItemKind.Module,10:monaco.languages.CompletionItemKind.Property,14:monaco.languages.CompletionItemKind.Keyword,15:monaco.languages.CompletionItemKind.Snippet};
        return { suggestions: items.slice(0,300).map(item => ({ label: item.label, kind: kindMap[item.kind] || monaco.languages.CompletionItemKind.Text, detail: item.detail, documentation: typeof item.documentation === 'string' ? item.documentation : item.documentation?.value, insertText: item.insertText || item.label, insertTextRules: item.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined, sortText: item.sortText, range: new monaco.Range(pos.lineNumber,pos.column,pos.lineNumber,pos.column) })) };
      } catch { return { suggestions: [] }; }
    } });
    const hover = monaco.languages.registerHoverProvider(languageId,{provideHover:async(model,pos)=>{if(!state.lspReady||model.uri.toString()!==uriFor(state.lspPath))return null;try{const r=await request('textDocument/hover',{textDocument:lspTextDocument(),position:{line:pos.lineNumber-1,character:pos.column-1}});const c=r?.contents;if(!c)return null;const values=Array.isArray(c)?c:[c];return {contents:values.map(v=>({value:typeof v==='string'?v:(v.value||JSON.stringify(v))}))};}catch{return null;}}});
    const definition = monaco.languages.registerDefinitionProvider(languageId,{provideDefinition:async(model,pos)=>{if(!state.lspReady||model.uri.toString()!==uriFor(state.lspPath))return null;try{const r=await request('textDocument/definition',{textDocument:lspTextDocument(),position:{line:pos.lineNumber-1,character:pos.column-1}});const item=Array.isArray(r)?r[0]:r;if(!item?.uri||!item.range)return null;const p=decodeURIComponent(item.uri.replace(/^file:\/\/\/workspace\//,''));return {uri:monaco.Uri.parse(uriFor(p)),range:new monaco.Range(item.range.start.line+1,item.range.start.character+1,item.range.end.line+1,item.range.end.character+1)};}catch{return null;}}});
    state.providers.push({language:languageId,completion,hover,definition});
  }
  function format() { if (state.editor) return state.editor.getAction('editor.action.formatDocument')?.run(); if (state.fallback) { const v = state.fallback.value.replace(/\t/g,'  '); state.fallback.value = v; callback(v); } }
  function focus() { if (state.editor) state.editor.focus(); else state.fallback?.focus(); }
  function dispose() { closeLanguageServer(); if (state.editor) { state.editor.dispose(); state.editor = null; } for (const model of state.models.values()) if (!model.isDisposed()) model.dispose(); state.models.clear(); state.target = null; state.fallback = null; state.gutter = null; }
  window.ArenaEditor = { mount, setValue, getValue: () => state.editor?.getValue() ?? state.fallback?.value ?? state.value, setFile, setMarkers, format, focus, dispose, get mode(){return state.editor?'monaco':'textarea';}, get language(){return state.language;} };
})();
