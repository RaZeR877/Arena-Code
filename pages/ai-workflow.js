/* Safe browser-local AI workflow. The model proposes edits; never grants write or execution permissions. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./browser-core.js') : root.ArenaBrowserCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ArenaAIWorkflow = api;
})(typeof globalThis === 'undefined' ? null : globalThis, function (core) {
  'use strict';
  if (!core) throw Error('Arena AI workflow requires browser project core');
  const WORDS = new Set(['the','and','with','that','this','from','for','add','make','file','code','new','app','project','into','when','please','change','update','src']);
  function terms(value) { return [...new Set(String(value).toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [])].filter(x => !WORDS.has(x)); }
  function rankFiles(project, task, current) {
    const query = terms(task);
    return Object.entries(project.files).map(([path, text]) => {
      const name = path.toLowerCase(), snippet = text.slice(0, 2500).toLowerCase();
      let score = path === current ? 9 : 0;
      if (name === 'index.html') score += 2;
      if (name === 'package.json' && /test|build|dependency|npm|package/.test(task.toLowerCase())) score += 7;
      if (query.some(term => name.includes(term))) score += 8;
      for (const term of query) if (snippet.includes(term)) score += 1;
      return { path, text, score };
    }).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  }
  function context(project, task, current, limit = 26000) {
    const max = Math.max(2000, Math.min(Number(limit) || 26000, 42000));
    const ranked = rankFiles(project, task, current);
    const fileTree = Object.keys(project.files).sort();
    const prefix = 'TASK:\n' + String(task).slice(0, 3000) + '\nFILE TREE:\n' + fileTree.join('\n') + '\nSELECTED SOURCES:\n';
    if (prefix.length >= max) throw Error('Project file list is too large for local AI context');
    let remaining = max - prefix.length, sections = [], paths = [], truncated = [];
    for (const { path, text } of ranked) {
      const header = `\nFILE ${JSON.stringify(path)} (${text.length} characters):\n`;
      if (remaining < header.length + 100) { truncated.push(path); continue; }
      const capacity = Math.min(text.length, remaining - header.length - 100);
      if (capacity < 100 && text.length > capacity) { truncated.push(path); continue; }
      const excerpt = text.slice(0, capacity);
      sections.push(header + excerpt + (capacity < text.length ? '\n[TRUNCATED; do not assume remaining lines]' : '') + '\nEND FILE\n');
      remaining -= header.length + excerpt.length + 70;
      paths.push(path);
      if (capacity < text.length) truncated.push(path);
    }
    return { text: prefix + sections.join(''), included: paths, omitted: fileTree.filter(p => !paths.includes(p)), truncated, bytes: max - remaining };
  }
  const system = 'You are editing a real user project. Output ONLY strict JSON: {"summary":"brief change explanation","changes":[{"path":"relative/path.js","content":"COMPLETE updated file text"}]}. Maximum five changed files. Preserve unrelated code, imports, behaviors, filenames and project conventions. Only edit files you can see in the supplied context. Never include markdown fences, explanations outside JSON, tool calls, secrets, or shell commands. Do not claim tests ran. If necessary context is missing, return JSON with {"summary":"Missing context: name needed files","changes":[]} and stop.';
  function checksFor(proposal) {
    const results = proposal.changes.filter(x => !x.delete).map(x => ({ path: x.path, ...core.check(x.path, x.content) }));
    return { results, failures: results.filter(x => x.status === 'fail'), unverified: results.filter(x => x.status === 'unverified') };
  }
  function normalizeResponse(result) {
    const content = result?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.filter(p => p && typeof p.text === 'string').map(p => p.text).join('\n');
    throw Error('Model returned no text. Check available memory or try a different model.');
  }
  async function propose({ engine, project, task, current, onProgress, tokenLimit = 3800, contextLimit = 26000 }) {
    if (!engine?.chat?.completions?.create) throw Error('A real local model must be loaded before suggesting edits');
    const base = context(project, task, current, contextLimit);
    const messages = [{ role: 'system', content: system }, { role: 'user', content: base.text + '\nOnly modify files whose complete content is included. Request missing context instead.' }];
    const started = Date.now();
    let error = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      onProgress?.(`AI pass ${attempt}/2 — generating a proposed patch (never applied automatically).`);
      let response, proposal;
      try {
        response = await engine.chat.completions.create({ messages, temperature: 0.1, max_tokens: tokenLimit });
        const raw = normalizeResponse(response);
        proposal = core.parseSuggestion(raw, project);
        const allowed = new Set(base.included.filter(p => !base.truncated.includes(p)));
        for (const change of proposal.changes) if (Object.hasOwn(project.files, change.path) && !allowed.has(change.path)) throw Error('Model tried to rewrite a file outside complete context: ' + change.path);
        const checks = checksFor(proposal);
        if (!checks.failures.length) return { proposal, checks, attempts: attempt, elapsedMs: Date.now() - started, context: { included: base.included, omitted: base.omitted, truncated: base.truncated } };
        error = checks.failures.map(x => `${x.path}: ${x.message}`).join('; ');
      } catch (e) { error = String(e.message || e); }
      if (attempt === 1) {
        messages.push({ role: 'assistant', content: 'The previous proposed edit was invalid.' });
        messages.push({ role: 'user', content: `RETRY: ${String(error).slice(0, 1800)}. Return corrected strict JSON with complete files. Do not claim tests ran.` });
      }
    }
    throw Error('AI could not produce a safe, syntactically valid proposal after two attempts: ' + String(error).slice(0, 300));
  }
  // A small, honest on-device evaluation: valid structured edits and syntax, NOT functional correctness.
  const cases = Object.freeze([
    { name: 'Two-file UI change', task: 'Create a badge with id="arenaBadge" in index.html and give it an event handler in app.js. Change both files.', mustChange: ['index.html','app.js'], required: { 'index.html': /arenaBadge/, 'app.js': /arenaBadge/ } },
    { name: 'Code and style edit', task: 'Add a CSS class named status-good in style.css and use it in index.html. Change both files.', mustChange: ['index.html','style.css'], required: { 'index.html': /status-good/, 'style.css': /status-good/ } }
  ]);
  async function evaluate(engine, onProgress) {
    const results = [];
    for (const scenario of cases) {
      onProgress?.('Checking ' + scenario.name + ' with the actual loaded model…');
      const seed = core.starter(); const now = Date.now();
      try {
        const result = await propose({ engine, project: seed, task: scenario.task, current: 'index.html', onProgress, tokenLimit: 3500 });
        const next = core.update(seed, result.proposal.changes);
        const paths = new Set(result.proposal.changes.map(x => x.path));
        const fileCoverage = scenario.mustChange.every(p => paths.has(p));
        const markers = Object.entries(scenario.required).every(([p, pattern]) => pattern.test(next.files[p] || ''));
        const passed = fileCoverage && markers && !result.checks.failures.length;
        results.push({ name: scenario.name, structured: true, passesStructuralChecks: passed, attempts: result.attempts, elapsedMs: Date.now() - now, reason: passed ? 'Requested files and identifiers are present; runtime behavior not tested.' : 'Missing required files/identifiers.' });
      } catch (e) { results.push({ name: scenario.name, structured: false, passesStructuralChecks: false, elapsedMs: Date.now() - now, reason: String(e.message || e).slice(0, 350) }); }
    }
    return { type: 'arena-browser-structural-evaluation-v1', model: 'unknown', runAt: new Date().toISOString(), score: results.filter(x => x.passesStructuralChecks).length, total: results.length, results, caveat: 'Structural output assessment only. No functional execution; do not compare to SWE-bench or agent benchmarks.' };
  }
  return Object.freeze({ context, rankFiles, propose, checksFor, evaluate, cases });
});
