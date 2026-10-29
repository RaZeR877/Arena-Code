'use strict';

// Arena Code local-first development server. No third-party runtime dependencies.
// Security posture: localhost by default; do not expose this server to the public Internet.
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { spawn } = require('node:child_process');
const { makeZip, parseZip } = require('./zip-utils.cjs');
const checkpoints = require('./project-checkpoints.cjs');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const PROJECTS = path.join(DATA, 'projects');
const NO_GIT_HOOKS = path.join(DATA, 'disabled-git-hooks');
const HISTORY = path.join(DATA, 'history');
const CHECKPOINTS = path.join(DATA, 'checkpoints');
const EXEC_WORKSPACES = path.join(DATA, 'exec');
const DEPENDENCIES = path.join(DATA, 'dependencies');
const EXECUTION_BACKEND = process.env.ARENA_EXECUTION_BACKEND === 'docker' ? 'docker' : 'host';
const LSP_CONFIG = loadLspConfig();
const DOCKER_BIN = process.env.ARENA_DOCKER_BIN || 'docker';
const DOCKER_IMAGE = process.env.ARENA_DOCKER_IMAGE || 'node:22-alpine';
const DOCKER_PYTHON_IMAGE = process.env.ARENA_PYTHON_IMAGE || 'python:3.12-slim';
const MAX_HISTORY_BYTES = 100 * 1024 * 1024;
const MAX_VERSIONS_PER_FILE = 10;
const HOSTED_MODE = process.env.ARENA_HOSTED_MODE === '1';
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const API_KEY = process.env.AI_API_KEY || '';
const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
const MAX_BODY = 8 * 1024 * 1024;
const MAX_FILE = 5 * 1024 * 1024;
const MAX_FILES = 500;
const MAX_PROJECT_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
const SECRET_FILE_NAMES = new Set(['.npmrc', '.pypirc', '.git-credentials', 'id_rsa', 'id_ed25519', 'id_ecdsa']);
const CHAT_TIMEOUT_MS = 60_000;
const RUN_TIMEOUT_MS = 30_000;
const DEFAULT_MODELS = ['openai/gpt-4.1', 'anthropic/claude-sonnet-4', 'google/gemini-2.5-pro', 'deepseek/deepseek-chat'];
const configuredModels = (process.env.AI_MODELS || '').split(',').map(s => s.trim()).filter(s => /^[A-Za-z0-9][A-Za-z0-9._:/+\-]{0,119}$/.test(s));
const MODELS = [...new Set(configuredModels.length ? configuredModels : DEFAULT_MODELS)].slice(0, 12);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.zip': 'application/zip'
};
const IGNORED_DIRS = new Set(['node_modules', '.git', '.arena', 'dist', 'build', '.next', '.cache']);
const rate = new Map();
const managedProcesses = new Map();
let hostedApp = null;
if (HOSTED_MODE) {
  try { hostedApp = require('./hosted/hosted.cjs').createHostedApp(); }
  catch (error) { console.error(`Hosted mode configuration failed: ${error.message}`); process.exit(1); }
}
fs.mkdirSync(PROJECTS, { recursive: true });
fs.mkdirSync(NO_GIT_HOOKS, { recursive: true });
fs.mkdirSync(HISTORY, { recursive: true });
fs.mkdirSync(CHECKPOINTS, { recursive: true });
fs.mkdirSync(EXEC_WORKSPACES, { recursive: true });
fs.mkdirSync(DEPENDENCIES, { recursive: true });

function loadLspConfig() {
  const allowed = new Set(['python', 'typescript', 'rust', 'go', 'java', 'csharp']);
  let parsed = {};
  try { parsed = JSON.parse(process.env.ARENA_LSP_SERVERS || '{}'); } catch { console.warn('ARENA_LSP_SERVERS is invalid JSON; no external language servers will be started.'); }
  const out = {};
  for (const [language, config] of Object.entries(parsed || {})) {
    if (!allowed.has(language) || !config || typeof config.command !== 'string' || !config.command.trim() || config.command.length > 300 || !Array.isArray(config.args) || config.args.length > 16 || config.args.some(a => typeof a !== 'string' || a.length > 200)) continue;
    out[language] = { command: config.command, args: config.args.slice() };
  }
  return Object.freeze(out);
}
function json(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders });
  res.end(body);
}
function fail(res, status, message, code) { json(res, status, { error: message, ...(code ? { code } : {}) }); }
function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0; let settled = false; let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true; settled = true; chunks.length = 0;
        reject(Object.assign(new Error('Request body is too large.'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('Request body must be valid JSON.'), { status: 400 })); }
    });
    req.on('error', error => { if (!settled) { settled = true; reject(error); } });
  });
}
function rateLimit(req, limit = 600, bucket = 'api') {
  const key = `${req.socket.remoteAddress || 'unknown'}:${bucket}`; const now = Date.now();
  const entry = rate.get(key) || { start: now, count: 0 };
  if (now - entry.start > 60_000) { entry.start = now; entry.count = 0; }
  entry.count++; rate.set(key, entry);
  if (rate.size > 1000) for (const [k, v] of rate) if (now - v.start > 120_000) rate.delete(k);
  return entry.count <= limit;
}
function validProjectId(id) { return /^[a-f0-9-]{36}$/i.test(id || ''); }
function projectDir(id) {
  if (!validProjectId(id)) throw Object.assign(new Error('Invalid project ID.'), { status: 400 });
  const dir = path.resolve(PROJECTS, id);
  if (!dir.startsWith(PROJECTS + path.sep)) throw Object.assign(new Error('Invalid project path.'), { status: 400 });
  return dir;
}
function cleanRelativePath(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 500 || raw.includes('\0')) throw Object.assign(new Error('A valid relative file path is required.'), { status: 400 });
  const normalized = raw.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) throw Object.assign(new Error('Absolute paths are not allowed.'), { status: 400 });
  const segments = normalized.split('/');
  if (segments.some(s => !s || s === '.' || s === '..' || s.length > 180)) throw Object.assign(new Error('Path contains an invalid segment.'), { status: 400 });
  if (segments.some(s => IGNORED_DIRS.has(s) || s === '.arena-project.json' || s === '.env' || s.startsWith('.env.') || SECRET_FILE_NAMES.has(s.toLowerCase()) || /\.(?:pem|key)$/i.test(s))) throw Object.assign(new Error('This path is reserved or may contain secrets.'), { status: 400 });
  return segments.join('/');
}
function resolveProjectPath(id, rel, { allowMissing = false } = {}) {
  const base = projectDir(id); const safeRel = cleanRelativePath(rel); const full = path.resolve(base, ...safeRel.split('/'));
  if (!full.startsWith(base + path.sep)) throw Object.assign(new Error('Path escapes the project.'), { status: 400 });
  // Reject symlinks at every existing ancestor, including the leaf.
  let cursor = base;
  for (const segment of safeRel.split('/')) {
    cursor = path.join(cursor, segment);
    try {
      const st = fs.lstatSync(cursor);
      if (st.isSymbolicLink()) throw Object.assign(new Error('Symbolic links are not allowed in workspaces.'), { status: 400 });
    } catch (e) {
      if (e.code === 'ENOENT' && allowMissing) break;
      if (e.status) throw e;
      if (e.code === 'ENOENT') break;
      throw e;
    }
  }
  if (!allowMissing && !fs.existsSync(full)) throw Object.assign(new Error('File not found.'), { status: 404 });
  return { base, full, rel: safeRel };
}
function walkProject(dir, rel = '', out = [], budget = { bytes: 0 }) {
  if (out.length >= MAX_FILES) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    if (out.length >= MAX_FILES) break;
    if (IGNORED_DIRS.has(ent.name) || ent.name === '.env' || ent.name.startsWith('.env.')) continue;
    const abs = path.join(dir, ent.name); const relPath = rel ? `${rel}/${ent.name}` : ent.name;
    let st; try { st = fs.lstatSync(abs); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) { out.push({ path: relPath, type: 'directory' }); walkProject(abs, relPath, out, budget); }
    else if (st.isFile()) { budget.bytes += st.size; out.push({ path: relPath, type: 'file', size: st.size, modifiedAt: st.mtime.toISOString() }); }
  }
  return out;
}
function historyDir(id) { const base = path.resolve(HISTORY, id); if (!base.startsWith(HISTORY + path.sep) || !validProjectId(id)) throw Object.assign(new Error('Invalid project ID.'), { status: 400 }); return base; }
function listHistory(id) {
  const dir = historyDir(id); if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(n => /^[a-f0-9-]{36}\.json$/i.test(n)).map(n => {
    try { const meta = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); const blob = path.join(dir, `${meta.id}.bin`); return { ...meta, storedBytes: fs.existsSync(blob) ? fs.statSync(blob).size : 0 }; } catch { return null; }
  }).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
function removeHistoryVersion(id, version) { const dir = historyDir(id); for (const ext of ['.json', '.bin']) try { fs.unlinkSync(path.join(dir, `${version}${ext}`)); } catch {} }
function saveHistory(id, rel, bytes) {
  if (!bytes || !bytes.length) return false;
  const dir = historyDir(id); fs.mkdirSync(dir, { recursive: true });
  const existing = listHistory(id); const same = existing.filter(v => v.path === rel);
  for (const v of same.slice(MAX_VERSIONS_PER_FILE - 1)) removeHistoryVersion(id, v.id);
  let entries = listHistory(id); let total = entries.reduce((n, v) => n + v.storedBytes, 0);
  while (total + bytes.length > MAX_HISTORY_BYTES && entries.length) { const oldest = entries.pop(); total -= oldest.storedBytes; removeHistoryVersion(id, oldest.id); }
  if (total + bytes.length > MAX_HISTORY_BYTES) return false;
  const idValue = crypto.randomUUID(); const record = { id: idValue, path: rel, createdAt: new Date().toISOString(), size: bytes.length };
  fs.writeFileSync(path.join(dir, `${idValue}.bin`), bytes, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, `${idValue}.json`), JSON.stringify(record), { mode: 0o600 });
  return true;
}
function projectInfo(dir) {
  let meta = { name: path.basename(dir), createdAt: null };
  try { const p = JSON.parse(fs.readFileSync(path.join(dir, '.arena-project.json'), 'utf8')); if (typeof p.name === 'string') meta.name = p.name; meta.createdAt = p.createdAt || null; } catch {}
  const listing = walkProject(dir);
  return { id: path.basename(dir), name: meta.name, createdAt: meta.createdAt, fileCount: listing.filter(x => x.type === 'file' && x.path !== '.arena-project.json').length };
}
function isBinaryPath(rel) { return /\.(?:png|jpe?g|gif|webp|avif|bmp|ico|pdf|mp4|webm|mov|mp3|wav|ogg|flac|zip|gz|7z|rar|tar|woff2?|ttf|otf|eot|wasm|exe|dll|so|dylib|bin|sqlite|db)$/i.test(rel); }
function countBytes(dir) {
  let total = 0;
  for (const item of walkProject(dir)) if (item.type === 'file') total += item.size;
  return total;
}
function safeName(s) { return String(s || 'Untitled project').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled project'; }
function reserveLocalPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}
function processSummary(entry) {
  return { id: entry.id, projectId: entry.projectId, script: entry.script, path: entry.path || null, port: entry.port, debugPort: entry.debugPort || null, debuggerUrl: entry.debuggerUrl || null, url: entry.url,
    startedAt: entry.startedAt, status: entry.status, exitCode: entry.exitCode, output: entry.output.slice(-24_000) };
}
function pushManagedOutput(entry, chunk) {
  entry.output = (entry.output + chunk.toString('utf8')).slice(-32_000);
}
function terminateManagedProcess(entry) {
  if (!entry || !entry.child || entry.child.exitCode !== null || ['stopped', 'failed', 'exited'].includes(entry.status)) return;
  entry.status = 'stopping';
  if (process.platform === 'win32') {
    try { const killer = spawn('taskkill', ['/pid', String(entry.child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); killer.unref(); }
    catch { try { entry.child.kill('SIGTERM'); } catch {} }
  } else {
    try { process.kill(-entry.child.pid, 'SIGTERM'); } catch { try { entry.child.kill('SIGTERM'); } catch {} }
  }
  if (entry.killTimer) clearTimeout(entry.killTimer);
  entry.killTimer = setTimeout(() => {
    if (entry.child.exitCode !== null) return;
    if (process.platform === 'win32') {
      try { const killer = spawn('taskkill', ['/pid', String(entry.child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); killer.unref(); }
      catch { try { entry.child.kill('SIGKILL'); } catch {} }
    } else { try { process.kill(-entry.child.pid, 'SIGKILL'); } catch { try { entry.child.kill('SIGKILL'); } catch {} } }
  }, 1_200);
  entry.killTimer.unref();
}
function pruneManagedProcesses() {
  if (managedProcesses.size <= 50) return;
  for (const [id, entry] of managedProcesses) {
    if (managedProcesses.size <= 40) break;
    if (['stopped', 'failed', 'exited'].includes(entry.status)) managedProcesses.delete(id);
  }
}
function requireLocalHost(req, res) {
  // A secondary guard: browsers cannot use cross-origin API calls to this local server.
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const u = new URL(origin);
    const host = req.headers.host || '';
    if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]') && (u.host === host || u.port === String(PORT))) return true;
  } catch {}
  json(res, 403, { error: 'Cross-origin API requests are not allowed.' }); return false;
}
async function handleApi(req, res, url) {
  if (!requireLocalHost(req, res)) return true;
  if (url.pathname === '/api/status' && req.method === 'GET') {
    json(res, 200, { demo: !API_KEY, providerConfigured: Boolean(API_KEY), executionBackend: EXECUTION_BACKEND,
      models: MODELS, workspaceStorage: 'local-filesystem', localOnlyRecommended: true, lspServers: Object.keys(LSP_CONFIG),
      limits: { maxFileBytes: MAX_FILE, maxFiles: MAX_FILES, maxProjectBytes: MAX_PROJECT_BYTES, maxArchiveBytes: MAX_ARCHIVE_BYTES },
      features: { zipImportExport: true, localGit: true, approvalBasedAgent: true, devServerLifecycle: true, jsonPythonSyntaxChecks: true, monacoEditor: true, lspBridge: true, nodeDebugger: true, dockerBuild: EXECUTION_BACKEND === 'docker', dependencyInstall: EXECUTION_BACKEND === 'docker' } }); return true;
  }
  if (url.pathname === '/api/lsp/status' && req.method === 'GET') { json(res, 200, { servers: Object.fromEntries(Object.keys(LSP_CONFIG).map(key => [key, true])), instructions: 'Only administrators who run this local Arena server can configure ARENA_LSP_SERVERS. Commands are never accepted from browser requests.' }); return true; }
  if (url.pathname.startsWith('/api/')) {
    if (!rateLimit(req, url.pathname === '/api/chat' ? 20 : 600, url.pathname === '/api/chat' ? 'chat' : 'api')) { fail(res, 429, 'Too many requests. Try again shortly.', 'RATE_LIMITED'); return true; }
  }
  if (url.pathname === '/api/projects' && req.method === 'GET') {
    const projects = fs.readdirSync(PROJECTS, { withFileTypes: true }).filter(d => d.isDirectory() && validProjectId(d.name)).map(d => projectInfo(path.join(PROJECTS, d.name)));
    json(res, 200, { projects }); return true;
  }
  if (url.pathname === '/api/projects' && req.method === 'POST') {
    const data = await readBody(req, 16 * 1024);
    const id = crypto.randomUUID(); const dir = projectDir(id); fs.mkdirSync(dir, { recursive: false });
    const name = safeName(data.name); fs.writeFileSync(path.join(dir, '.arena-project.json'), JSON.stringify({ name, createdAt: new Date().toISOString() }, null, 2));
    fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n\nCreated with Arena Code.\n`);
    json(res, 201, { project: projectInfo(dir) }); return true;
  }
  if (url.pathname === '/api/projects/import-zip' && req.method === 'POST') {
    const body = await readBody(req, Math.ceil(MAX_ARCHIVE_BYTES * 4 / 3) + 128 * 1024);
    if (typeof body.archive !== 'string' || body.archive.length > Math.ceil(MAX_ARCHIVE_BYTES * 4 / 3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.archive)) { fail(res, 400, 'Provide a valid base64 ZIP archive up to 8 MB.'); return true; }
    const archive = Buffer.from(body.archive, 'base64');
    if (!archive.length || archive.length > MAX_ARCHIVE_BYTES) { fail(res, 413, 'ZIP archive must be between 1 byte and 8 MB.'); return true; }
    let entries;
    try { entries = parseZip(archive, { maxFiles: MAX_FILES, maxFileBytes: MAX_FILE, maxTotalBytes: MAX_PROJECT_BYTES }); }
    catch (error) { fail(res, 400, `ZIP import rejected: ${String(error.message || 'invalid archive').slice(0, 300)}`, 'INVALID_ARCHIVE'); return true; }
    const safeEntries = []; const seen = new Set(); const allFiles = new Set(); let total = 0;
    try {
      for (const entry of entries) {
        const rel = cleanRelativePath(entry.name);
        if (rel === '.arena-project.json') throw new Error('Archive includes a reserved metadata file.');
        if (seen.has(rel)) throw new Error(`Duplicate project path: ${rel}`);
        seen.add(rel); allFiles.add(rel); total += entry.data.length;
        if (entry.data.length > MAX_FILE) throw new Error(`File is too large: ${rel}`);
        safeEntries.push({ path: rel, data: entry.data });
      }
      for (const rel of allFiles) {
        const segments = rel.split('/');
        for (let i = 1; i < segments.length; i++) if (allFiles.has(segments.slice(0, i).join('/'))) throw new Error(`A file conflicts with a directory path: ${segments.slice(0, i).join('/')}`);
      }
      if (safeEntries.length > MAX_FILES || total > MAX_PROJECT_BYTES) throw new Error('Archive exceeds project limits.');
    } catch (error) { fail(res, 400, `ZIP import rejected: ${String(error.message || 'invalid paths').slice(0, 300)}`, 'INVALID_ARCHIVE'); return true; }
    const id = crypto.randomUUID(); const dir = projectDir(id); const name = safeName(body.name || 'Imported project');
    try {
      fs.mkdirSync(dir, { recursive: false });
      fs.writeFileSync(path.join(dir, '.arena-project.json'), JSON.stringify({ name, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
      for (const entry of safeEntries) {
        const full = path.resolve(dir, ...entry.path.split('/'));
        if (!full.startsWith(dir + path.sep)) throw new Error('Archive path escaped project root.');
        fs.mkdirSync(path.dirname(full), { recursive: true, mode: 0o700 });
        fs.writeFileSync(full, entry.data, { mode: 0o600, flag: 'wx' });
      }
      json(res, 201, { project: projectInfo(dir), importedFiles: safeEntries.length, importedBytes: total });
    } catch (error) { fs.rmSync(dir, { recursive: true, force: true }); fail(res, 400, `ZIP import failed: ${String(error.message || 'write failed').slice(0, 300)}`); }
    return true;
  }
  const zipExportMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/archive\.zip$/);
  if (zipExportMatch && (req.method === 'GET' || req.method === 'HEAD')) {
    const dir = projectDir(zipExportMatch[1]);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { fail(res, 404, 'Project not found.'); return true; }
    try {
      const files = walkProject(dir).filter(item => item.type === 'file' && item.path !== '.arena-project.json' && !item.path.split('/').some(part => SECRET_FILE_NAMES.has(part.toLowerCase()) || /\.(?:pem|key)$/i.test(part)));
      if (files.length > MAX_FILES) { fail(res, 413, 'Project has too many files to export.'); return true; }
      const entries = []; let bytes = 0;
      for (const item of files) {
        if (item.size > MAX_FILE) { fail(res, 413, `Project file exceeds the archive limit: ${item.path}`); return true; }
        const resolved = resolveProjectPath(zipExportMatch[1], item.path); const data = fs.readFileSync(resolved.full); bytes += data.length;
        if (bytes > MAX_PROJECT_BYTES) { fail(res, 413, 'Project is too large to export.'); return true; }
        entries.push({ name: item.path, data });
      }
      const archive = makeZip(entries, { maxFiles: MAX_FILES, maxBytes: MAX_PROJECT_BYTES });
      const name = safeName(projectInfo(dir).name).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'arena-project';
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': archive.length, 'Content-Disposition': `attachment; filename=\"${name}.zip\"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      if (req.method === 'HEAD') res.end(); else res.end(archive);
    } catch (error) { fail(res, 500, `Could not export ZIP archive: ${String(error.message || 'export failed').slice(0, 300)}`); }
    return true;
  }
  const checkpointMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/checkpoints$/);
  if (checkpointMatch) {
    const id = checkpointMatch[1]; const dir = projectDir(id);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { fail(res, 404, 'Project not found.'); return true; }
    if (req.method === 'GET') { json(res, 200, { checkpoints: checkpoints.listings(CHECKPOINTS, id) }); return true; }
    if (req.method !== 'POST') { fail(res, 405, 'Method not allowed.'); return true; }
    const body = await readBody(req, 4096);
    if (body.action === 'create') {
      const checkpoint = checkpoints.create({ root: CHECKPOINTS, projectId: id, projectDir: dir, name: body.name,
        listFiles: () => walkProject(dir), resolveFile: rel => resolveProjectPath(id, rel) });
      json(res, 201, { ok: true, checkpoint }); return true;
    }
    if (body.action === 'restore') {
      if (body.confirm !== true) { fail(res, 400, 'Restoring a checkpoint requires explicit confirmation.'); return true; }
      if ([...managedProcesses.values()].some(p => p.projectId === id && ['starting', 'running', 'stopping'].includes(p.status))) {
        fail(res, 409, 'Stop the project development process before restoring a checkpoint.'); return true;
      }
      const result = checkpoints.restore({ root: CHECKPOINTS, projectId: id, projectDir: dir,
        checkpointId: body.checkpointId, validatePath: cleanRelativePath });
      json(res, 200, result); return true;
    }
    fail(res, 400, 'Unknown checkpoint action.'); return true;
  }
  const assetMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/assets\/(.+)$/);
  if (assetMatch) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { fail(res, 405, 'Method not allowed.'); return true; }
    let rel; try { rel = decodeURIComponent(assetMatch[2]); } catch { fail(res, 400, 'Invalid asset path.'); return true; }
    const file = resolveProjectPath(assetMatch[1], rel);
    const st = fs.statSync(file.full);
    if (!st.isFile()) { fail(res, 404, 'Asset not found.'); return true; }
    if (st.size > MAX_FILE) { fail(res, 413, 'Asset exceeds the workspace limit.'); return true; }
    const ext = path.extname(file.full).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file.full).pipe(res);
    return true;
  }
  const historyMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/history$/);
  if (historyMatch) {
    const id = historyMatch[1]; const dir = projectDir(id);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { fail(res, 404, 'Project not found.'); return true; }
    if (req.method === 'GET') {
      const rel = cleanRelativePath(url.searchParams.get('path') || '');
      json(res, 200, { path: rel, versions: listHistory(id).filter(v => v.path === rel).map(({ id: versionId, path: versionPath, createdAt, size }) => ({ id: versionId, path: versionPath, createdAt, size })) }); return true;
    }
    if (req.method !== 'POST') { fail(res, 405, 'Method not allowed.'); return true; }
    const body = await readBody(req, 16 * 1024);
    let rel; try { rel = cleanRelativePath(body.path || ''); } catch (e) { fail(res, e.status || 400, e.message); return true; }
    if (typeof body.versionId !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.versionId)) { fail(res, 400, 'A valid version ID is required.'); return true; }
    const record = listHistory(id).find(v => v.id === body.versionId && v.path === rel);
    if (!record) { fail(res, 404, 'File version not found.'); return true; }
    const hist = historyDir(id); const backupPath = path.join(hist, `${record.id}.bin`);
    if (!fs.existsSync(backupPath)) { fail(res, 404, 'File version data is missing.'); return true; }
    const target = resolveProjectPath(id, rel, { allowMissing: true });
    if (fs.existsSync(target.full) && fs.statSync(target.full).isFile()) saveHistory(id, rel, fs.readFileSync(target.full));
    const bytes = fs.readFileSync(backupPath); fs.mkdirSync(path.dirname(target.full), { recursive: true }); fs.writeFileSync(target.full, bytes, { mode: 0o600 });
    json(res, 200, { ok: true, path: rel, size: bytes.length, restoredVersion: record.id }); return true;
  }
  const processMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/process$/);
  if (processMatch) {
    const id = processMatch[1]; const dir = projectDir(id);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { fail(res, 404, 'Project not found.'); return true; }
    if (req.method === 'GET') {
      const processes = [...managedProcesses.values()].filter(p => p.projectId === id).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 5).map(processSummary);
      json(res, 200, { processes }); return true;
    }
    if (req.method !== 'POST') { fail(res, 405, 'Method not allowed.'); return true; }
    const body = await readBody(req, 16 * 1024);
    if (body.action === 'stop') {
      const entry = managedProcesses.get(String(body.processId || ''));
      if (!entry || entry.projectId !== id) { fail(res, 404, 'Managed process not found.'); return true; }
      terminateManagedProcess(entry); json(res, 202, { ok: true, process: processSummary(entry) }); return true;
    }
    if (body.action === 'start-debug') {
      let file; try { file = resolveProjectPath(id, body.path || ''); } catch (error) { fail(res, error.status || 400, error.message); return true; }
      if (!/\.(?:js|cjs|mjs)$/i.test(file.rel) || !fs.statSync(file.full).isFile()) { fail(res, 400, 'Node debugging only supports existing .js, .cjs, or .mjs files.'); return true; }
      const alreadyRunning = [...managedProcesses.values()].find(p => p.projectId === id && ['starting', 'running', 'stopping'].includes(p.status));
      if (alreadyRunning) { json(res, 409, { error: 'A project process is already running.', process: processSummary(alreadyRunning) }); return true; }
      let port; try { port = await reserveLocalPort(); } catch { fail(res, 500, 'Could not reserve a localhost inspector port.'); return true; }
      const processId = crypto.randomUUID();
      const entry = { id: processId, projectId: id, script: `debug ${file.rel}`, path: file.rel, port: null, debugPort: port, debuggerUrl: null, url: null, startedAt: new Date().toISOString(), status: 'starting', exitCode: null, output: '', child: null, killTimer: null };
      const env = { PATH: process.env.PATH || '', SYSTEMROOT: process.env.SYSTEMROOT || '', WINDIR: process.env.WINDIR || '', HOME: process.env.HOME || '', USERPROFILE: process.env.USERPROFILE || '', TMP: process.env.TMP || '', TEMP: process.env.TEMP || '', GIT_TERMINAL_PROMPT: '0' };
      try {
        entry.child = spawn(process.execPath, [`--inspect=127.0.0.1:${port}`, file.full], { cwd: dir, env, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        managedProcesses.set(processId, entry); pruneManagedProcesses();
        const outputHandler = chunk => { pushManagedOutput(entry, chunk); const found = entry.output.match(/ws:\/\/127\.0\.0\.1:(\d+)\/([A-Za-z0-9-]+)/); if (found) entry.debuggerUrl = `devtools://devtools/bundled/inspector.html?ws=127.0.0.1:${found[1]}/${found[2]}`; };
        entry.child.stdout.on('data', outputHandler); entry.child.stderr.on('data', outputHandler);
        entry.child.once('spawn', () => { if (entry.status === 'starting') entry.status = 'running'; });
        entry.child.once('error', error => { entry.status = 'failed'; entry.exitCode = 127; pushManagedOutput(entry, `\n[arena] Failed to start Node debugger: ${error.message}\n`); });
        entry.child.once('close', code => { if (entry.killTimer) clearTimeout(entry.killTimer); entry.exitCode = code ?? 1; entry.status = entry.status === 'stopping' || code === 0 ? 'stopped' : 'exited'; pushManagedOutput(entry, `\n[arena] Debug process ended with code ${entry.exitCode}.\n`); });
        pushManagedOutput(entry, `[arena] Debugging ${file.rel} with Node Inspector bound to 127.0.0.1:${port}.\n`);
        json(res, 202, { ok: true, process: processSummary(entry) });
      } catch (error) { if (entry.child) terminateManagedProcess(entry); fail(res, 500, 'Could not start Node debugger.'); }
      return true;
    }
    if (body.action !== 'start') { fail(res, 400, 'Unknown process action.'); return true; }
    const script = typeof body.script === 'string' ? body.script : 'dev';
    if (!['dev', 'start', 'preview'].includes(script)) { fail(res, 400, 'Only the conventional dev, start, or preview scripts can be launched from this workspace.'); return true; }
    const packagePath = path.join(dir, 'package.json');
    if (!fs.existsSync(packagePath)) { fail(res, 400, 'This project has no package.json.'); return true; }
    let pkg; try { pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8')); } catch { fail(res, 400, 'package.json is invalid JSON.'); return true; }
    if (!pkg.scripts || typeof pkg.scripts[script] !== 'string' || !pkg.scripts[script].trim()) { fail(res, 400, `No ${script} script is defined in package.json.`); return true; }
    const alreadyRunning = [...managedProcesses.values()].find(p => p.projectId === id && ['starting', 'running', 'stopping'].includes(p.status));
    if (alreadyRunning) { json(res, 409, { error: 'A project script is already running.', process: processSummary(alreadyRunning) }); return true; }
    let port;
    try { port = await reserveLocalPort(); } catch { fail(res, 500, 'Could not reserve a local development port.'); return true; }
    const processId = crypto.randomUUID();
    const entry = { id: processId, projectId: id, script, port, url: `http://127.0.0.1:${port}`, startedAt: new Date().toISOString(), status: 'starting', exitCode: null, output: '', child: null, killTimer: null };
    const env = { PATH: process.env.PATH || '', SYSTEMROOT: process.env.SYSTEMROOT || '', WINDIR: process.env.WINDIR || '', HOME: process.env.HOME || '', USERPROFILE: process.env.USERPROFILE || '', TMP: process.env.TMP || '', TEMP: process.env.TEMP || '', CI: '1', BROWSER: 'none', HOST: '127.0.0.1', HOSTNAME: '127.0.0.1', PORT: String(port), ARENA_CODE: '1' };
    try {
      const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      entry.child = spawn(command, ['run', script], { cwd: dir, env, shell: process.platform === 'win32', detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      managedProcesses.set(processId, entry); pruneManagedProcesses();
      entry.child.stdout.on('data', chunk => pushManagedOutput(entry, chunk));
      entry.child.stderr.on('data', chunk => pushManagedOutput(entry, chunk));
      entry.child.once('spawn', () => { if (entry.status === 'starting') entry.status = 'running'; });
      entry.child.once('error', error => { entry.status = 'failed'; entry.exitCode = 127; pushManagedOutput(entry, `\n[arena] Failed to start process: ${error.message}\n`); });
      entry.child.once('close', code => { if (entry.killTimer) clearTimeout(entry.killTimer); entry.exitCode = code ?? 1; entry.status = entry.status === 'stopping' || code === 0 ? 'stopped' : 'exited'; pushManagedOutput(entry, `\n[arena] Process ended with code ${entry.exitCode}.\n`); });
      pushManagedOutput(entry, `[arena] Running npm run ${script} with HOST=127.0.0.1 and PORT=${port}. This project script can still ignore these environment values.\n`);
      json(res, 202, { ok: true, process: processSummary(entry) });
    } catch (error) { if (entry.child) terminateManagedProcess(entry); fail(res, 500, 'Could not start the project script.'); }
    return true;
  }
  const gitMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/git$/);
  if (gitMatch && req.method === 'POST') {
    const id = gitMatch[1]; const dir = projectDir(id);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { fail(res, 404, 'Project not found.'); return true; }
    const body = await readBody(req, 16 * 1024); const action = body.action;
    let result;
    if (action === 'init') {
      result = await runProcess('git', ['init', '--initial-branch=main'], dir, 10_000);
    } else if (action === 'status') {
      result = await runProcess('git', ['status', '--short', '--branch'], dir, 10_000);
    } else if (action === 'diff') {
      const unstaged = await runProcess('git', ['diff', '--no-ext-diff', '--no-textconv'], dir, 10_000);
      const staged = await runProcess('git', ['diff', '--cached', '--no-ext-diff', '--no-textconv'], dir, 10_000);
      result = { code: unstaged.code || staged.code, stdout: `--- Unstaged changes ---\n${unstaged.stdout}\n--- Staged changes ---\n${staged.stdout}`, stderr: [unstaged.stderr, staged.stderr].filter(Boolean).join('\n'), timedOut: unstaged.timedOut || staged.timedOut };
    } else if (action === 'stage') {
      result = await runProcess('git', ['add', '--all', '--', '.', ':(exclude)**/.env', ':(exclude)**/.env.*'], dir, 15_000);
    } else if (action === 'commit') {
      const message = typeof body.message === 'string' ? body.message.trim().slice(0, 200) : '';
      if (!message) { fail(res, 400, 'A commit message is required.'); return true; }
      result = await runProcess('git', ['-c', `core.hooksPath=${NO_GIT_HOOKS}`, 'commit', '--no-gpg-sign', '-m', message], dir, 20_000);
    } else { fail(res, 400, 'Unknown Git action.'); return true; }
    json(res, 200, { ok: result.code === 0, ...result }); return true;
  }
  const m = url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(files|file|run))?$/);
  if (m) {
    const id = m[1]; const suffix = m[2] || '';
    const dir = projectDir(id);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { fail(res, 404, 'Project not found.'); return true; }
    if (suffix === 'files' && req.method === 'GET') { json(res, 200, { project: projectInfo(dir), files: walkProject(dir).filter(f => f.path !== '.arena-project.json') }); return true; }
    if (suffix === 'file' && req.method === 'GET') {
      const file = resolveProjectPath(id, url.searchParams.get('path') || ''); const st = fs.statSync(file.full);
      if (!st.isFile()) { fail(res, 400, 'Path is not a file.'); return true; }
      if (st.size > MAX_FILE) { fail(res, 413, `This file exceeds the ${MAX_FILE} byte workspace limit.`); return true; }
      const bytes = fs.readFileSync(file.full); const binary = isBinaryPath(file.rel) || bytes.includes(0);
      json(res, 200, { path: file.rel, encoding: binary ? 'base64' : 'utf8', content: binary ? bytes.toString('base64') : bytes.toString('utf8'), size: st.size, modifiedAt: st.mtime.toISOString() }); return true;
    }
    if (suffix === 'file' && req.method === 'PUT') {
      const body = await readBody(req, Math.ceil(MAX_FILE * 4 / 3) + 32 * 1024);
      if (typeof body.path !== 'string' || typeof body.content !== 'string') { fail(res, 400, 'Both path and content are required.'); return true; }
      const file = resolveProjectPath(id, body.path, { allowMissing: true });
      let bytes;
      if (body.encoding === 'base64') {
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.content)) { fail(res, 400, 'Invalid base64 file content.'); return true; }
        bytes = Buffer.from(body.content, 'base64');
      } else bytes = Buffer.from(body.content, 'utf8');
      if (bytes.length > MAX_FILE) { fail(res, 413, `File exceeds the ${MAX_FILE} byte workspace limit.`); return true; }
      if (fs.existsSync(file.full) && !fs.statSync(file.full).isFile()) { fail(res, 400, 'Path is not a file.'); return true; }
      if (!fs.existsSync(file.full) && walkProject(dir).filter(x => x.type === 'file' && x.path !== '.arena-project.json').length >= MAX_FILES) { fail(res, 413, 'Project file limit reached.'); return true; }
      const currentBytes = countBytes(dir); const oldSize = fs.existsSync(file.full) ? fs.statSync(file.full).size : 0;
      if (currentBytes - oldSize + bytes.length > MAX_PROJECT_BYTES) { fail(res, 413, 'Project storage limit reached.'); return true; }
      const backupSaved = fs.existsSync(file.full) ? saveHistory(id, file.rel, fs.readFileSync(file.full)) : false;
      fs.mkdirSync(path.dirname(file.full), { recursive: true }); fs.writeFileSync(file.full, bytes, { mode: 0o600 });
      json(res, 200, { ok: true, path: file.rel, size: bytes.length, backupSaved, modifiedAt: fs.statSync(file.full).mtime.toISOString() }); return true;
    }
    if (suffix === 'file' && req.method === 'DELETE') {
      const file = resolveProjectPath(id, url.searchParams.get('path') || '');
      if (!fs.statSync(file.full).isFile()) { fail(res, 400, 'Only files can be deleted.'); return true; }
      const backupSaved = saveHistory(id, file.rel, fs.readFileSync(file.full));
      fs.unlinkSync(file.full); json(res, 200, { ok: true, path: file.rel, backupSaved }); return true;
    }
    if (suffix === 'run' && req.method === 'POST') {
      const body = await readBody(req, 16 * 1024);
      if (body.action === 'node-check') {
        const file = resolveProjectPath(id, body.path || '');
        if (!/\.(?:js|cjs|mjs)$/.test(file.rel) || !fs.statSync(file.full).isFile()) { fail(res, 400, 'node-check only accepts .js, .cjs, or .mjs files.'); return true; }
        const result = await runProcess(process.execPath, ['--check', file.full], dir, 10_000);
        json(res, 200, { ok: result.code === 0, ...result }); return true;
      }
      if (body.action === 'json-check') {
        const file = resolveProjectPath(id, body.path || '');
        if (!/\.json$/i.test(file.rel) || !fs.statSync(file.full).isFile()) { fail(res, 400, 'json-check only accepts .json files.'); return true; }
        try { JSON.parse(fs.readFileSync(file.full, 'utf8')); json(res, 200, { ok: true, code: 0, stdout: 'Valid JSON.\n', stderr: '', timedOut: false }); }
        catch (error) { json(res, 200, { ok: false, code: 1, stdout: '', stderr: `${error.message}\n`, timedOut: false }); }
        return true;
      }
      if (body.action === 'python-check') {
        const file = resolveProjectPath(id, body.path || '');
        if (!/\.py$/i.test(file.rel) || !fs.statSync(file.full).isFile()) { fail(res, 400, 'python-check only accepts .py files.'); return true; }
        const python = process.env.ARENA_PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
        const script = 'import ast, pathlib, sys; p=pathlib.Path(sys.argv[1]); ast.parse(p.read_text(encoding=\'utf-8\'), filename=str(p)); print(\'Valid Python syntax.\')';
        const result = await runProcess(python, ['-c', script, file.full], dir, 10_000);
        json(res, 200, { ok: result.code === 0, ...result }); return true;
      }
      if (['python-test', 'python-install'].includes(body.action)) {
        if (EXECUTION_BACKEND !== 'docker') { fail(res, 400, `${body.action} requires ARENA_EXECUTION_BACKEND=docker. Python project code and dependencies must not be executed on the Arena host by default.`); return true; }
        const result = await runDockerPythonProjectAction(id, dir, body.action);
        json(res, 200, { ok: result.code === 0, backend: 'docker', action: body.action, ...result }); return true;
      }
      if (['npm-test', 'npm-build', 'npm-install'].includes(body.action)) {
        if (!fs.existsSync(path.join(dir, 'package.json'))) { fail(res, 400, 'No package.json was found.'); return true; }
        if (body.action === 'npm-install' && EXECUTION_BACKEND !== 'docker') { fail(res, 400, 'Dependency installation is available only with ARENA_EXECUTION_BACKEND=docker. This runs npm in a disposable network-enabled container, with lifecycle scripts disabled.'); return true; }
        if (EXECUTION_BACKEND === 'docker') {
          const result = await runDockerProjectAction(id, dir, body.action);
          json(res, 200, { ok: result.code === 0, backend: 'docker', action: body.action, ...result }); return true;
        }
        if (body.action !== 'npm-test') { fail(res, 400, `${body.action} requires the Docker execution backend to avoid running dependency/build code on the Arena host.`); return true; }
        const result = await runHostNpmTest(dir);
        json(res, 200, { ok: result.code === 0, backend: 'host', action: body.action, ...result }); return true;
      }
      fail(res, 400, 'Unknown run action.'); return true;
    }
    if (!suffix && req.method === 'DELETE') {
      fail(res, 405, 'Deleting an entire project is disabled to prevent accidental data loss.'); return true;
    }
    fail(res, 405, 'Method not allowed.'); return true;
  }
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    const data = await readBody(req);
    if (!API_KEY) { json(res, 200, { demo: true, reason: 'NO_PROVIDER_CONFIGURED' }); return true; }
    if (!Array.isArray(data.messages) || data.messages.length < 1 || data.messages.length > 40) { fail(res, 400, 'Messages must be an array with 1–40 entries.'); return true; }
    const messages = [];
    for (const item of data.messages) {
      if (!item || !['system', 'user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || item.content.length > 120_000) { fail(res, 400, 'A message has an invalid role or content.'); return true; }
      messages.push({ role: item.role, content: item.content });
    }
    const model = typeof data.model === 'string' && MODELS.includes(data.model) ? data.model : MODELS[0];
    try {
      const response = await fetch(`${AI_BASE_URL}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: 'You are Arena Code, a practical coding assistant. Be accurate and clearly state uncertainty. For a web artifact, give complete code in a fenced code block. Never claim code was tested unless it actually was.' }, ...messages], max_tokens: 5000 }), signal: AbortSignal.timeout(CHAT_TIMEOUT_MS) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { const upstream = response.status >= 500 ? 502 : 400; fail(res, upstream, `AI provider request failed (${response.status}). ${String(payload.error?.message || 'Check provider configuration.').slice(0, 500)}`, 'PROVIDER_ERROR'); return true; }
      const text = payload.choices?.[0]?.message?.content;
      if (typeof text !== 'string') { fail(res, 502, 'AI provider returned an unexpected response.', 'INVALID_PROVIDER_RESPONSE'); return true; }
      json(res, 200, { text, demo: false, model });
    } catch (error) { fail(res, error.name === 'TimeoutError' ? 504 : 502, error.name === 'TimeoutError' ? 'AI provider request timed out.' : 'Could not reach the AI provider. Check the server network and provider settings.', 'PROVIDER_UNAVAILABLE'); }
    return true;
  }
  if (url.pathname.startsWith('/api/')) { fail(res, 404, 'API route not found.'); return true; }
  return false;
}
async function runHostNpmTest(dir) {
  const npmCli = process.env.npm_execpath;
  return npmCli && fs.existsSync(npmCli)
    ? runProcess(process.execPath, [npmCli, 'test'], dir, RUN_TIMEOUT_MS)
    : runProcess(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test'], dir, RUN_TIMEOUT_MS, process.platform === 'win32');
}
function copyProjectToExecutionWorkspace(source, destination, requirePackage = true) {
  const budget = { files: 0, bytes: 0 };
  function visit(src, dst) {
    fs.mkdirSync(dst, { recursive: true, mode: 0o700 });
    let entries;
    try { entries = fs.readdirSync(src, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const name = entry.name; const lower = name.toLowerCase();
      if (IGNORED_DIRS.has(name) || lower === '.env' || lower.startsWith('.env.') || name === '.arena-project.json') continue;
      const from = path.join(src, name); const to = path.join(dst, name);
      let st; try { st = fs.lstatSync(from); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) { visit(from, to); continue; }
      if (!st.isFile()) continue;
      budget.files++; budget.bytes += st.size;
      if (budget.files > MAX_FILES || budget.bytes > MAX_PROJECT_BYTES) throw new Error('Project exceeds the execution workspace limits.');
      fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
      fs.copyFileSync(from, to); try { fs.chmodSync(to, 0o600); } catch {}
    }
  }
  visit(source, destination);
  if (requirePackage && !fs.existsSync(path.join(destination, 'package.json'))) throw new Error('No package.json was copied into the execution workspace.');
}
function dependencyFingerprint(projectDirPath) {
  const hash = crypto.createHash('sha256');
  for (const name of ['package.json', 'package-lock.json', 'npm-shrinkwrap.json']) {
    const file = path.join(projectDirPath, name);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) { hash.update(name); hash.update(fs.readFileSync(file)); }
  }
  return hash.digest('hex').slice(0, 32);
}
function dependencyCachePath(projectId, projectDirPath) {
  return path.join(DEPENDENCIES, projectId, dependencyFingerprint(projectDirPath));
}
function measureAndValidateDependencyTree(root, maxFiles = 150_000, maxBytes = 800 * 1024 * 1024) {
  let files = 0, bytes = 0;
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      files++; if (files > maxFiles) throw new Error('Dependency tree contains too many entries; limit is 150,000.');
      const full = path.join(dir, entry.name); const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) {
        const target = fs.readlinkSync(full);
        if (path.isAbsolute(target)) throw new Error('Dependency tree contains an absolute symlink; refusing to cache it.');
        const resolved = path.resolve(path.dirname(full), target);
        if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('Dependency tree contains a symlink that escapes node_modules.');
      } else if (st.isDirectory()) visit(full);
      else if (st.isFile()) { bytes += st.size; if (bytes > maxBytes) throw new Error('Dependency tree exceeds the 800 MiB cache limit.'); }
    }
  };
  visit(root); return { files, bytes };
}
function dependencyCacheExists(cacheDir, fingerprint) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(cacheDir, '.arena-dependencies.json'), 'utf8'));
    return manifest.fingerprint === fingerprint && fs.statSync(path.join(cacheDir, 'node_modules')).isDirectory();
  } catch { return false; }
}
async function runDockerProjectAction(projectId, projectDirPath, action) {
  const image = await runProcess(DOCKER_BIN, ['image', 'inspect', DOCKER_IMAGE], ROOT, 10_000);
  if (image.code !== 0) return { code: 127, stdout: image.stdout, stderr: `Docker image ${DOCKER_IMAGE} is not available locally. Install Docker and pull the image before enabling the Docker backend.\n${image.stderr}`.slice(-12_000), timedOut: image.timedOut };
  const sandbox = fs.mkdtempSync(path.join(EXEC_WORKSPACES, `${projectId.slice(0, 8)}-${action}-`));
  const containerName = `arena-${action.replace(/[^a-z]/g,'')}-${projectId.slice(0, 8)}-${crypto.randomUUID().slice(0, 8)}`;
  const fingerprint = dependencyFingerprint(projectDirPath);
  const cacheDir = dependencyCachePath(projectId, projectDirPath);
  let result = { code: 1, stdout: '', stderr: '', timedOut: false };
  try {
    copyProjectToExecutionWorkspace(projectDirPath, sandbox);
    const installing = action === 'npm-install';
    const command = installing
      ? (fs.existsSync(path.join(projectDirPath, 'package-lock.json')) || fs.existsSync(path.join(projectDirPath, 'npm-shrinkwrap.json')) ? ['ci', '--ignore-scripts'] : ['install', '--ignore-scripts'])
      : action === 'npm-build' ? ['run', 'build'] : ['test'];
    if (installing) {
      // Cache is keyed to the manifest and lockfile. Install scripts are disabled by default.
      fs.mkdirSync(path.dirname(cacheDir), { recursive: true });
      if (dependencyCacheExists(cacheDir, fingerprint)) return { code: 0, stdout: 'Dependencies already installed for this package manifest.\n', stderr: '', timedOut: false, dependenciesCached: true, cacheKey: fingerprint };
    } else if (dependencyCacheExists(cacheDir, fingerprint)) {
      // The cache is a distinct, read-only mount; it is never exposed via the project file API.
      // Build/test output is written only to the disposable source copy.
    }
    const args = [
      'run', '--rm', '--name', containerName,
      installing ? '--network=bridge' : '--network=none',
      '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--memory=768m', '--memory-swap=768m', '--cpus=1', '--pids-limit=128',
      '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=128m',
      '--mount', `type=bind,source=${sandbox},target=/workspace`,
      '--workdir', '/workspace', '--env', 'CI=1', '--env', 'HOME=/tmp', '--env', 'npm_config_cache=/tmp/npm-cache',
      '--env', 'npm_config_audit=false', '--env', 'npm_config_fund=false'
    ];
    if (!installing && dependencyCacheExists(cacheDir, fingerprint)) args.push('--mount', `type=bind,source=${path.join(cacheDir, 'node_modules')},target=/workspace/node_modules,readonly`);
    args.push(DOCKER_IMAGE, 'npm', ...command);
    result = await runProcess(DOCKER_BIN, args, ROOT, installing ? 180_000 : 60_000);
    if (installing && result.code === 0) {
      const modulesDir = path.join(sandbox, 'node_modules');
      if (!fs.existsSync(modulesDir) || !fs.statSync(modulesDir).isDirectory()) throw new Error('npm completed but did not create node_modules.');
      const stats = measureAndValidateDependencyTree(modulesDir);
      const tempCache = path.join(path.dirname(cacheDir), `.cache-${crypto.randomUUID()}`);
      try {
        fs.mkdirSync(tempCache, { recursive: true, mode: 0o700 });
        fs.cpSync(modulesDir, path.join(tempCache, 'node_modules'), { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true });
        fs.writeFileSync(path.join(tempCache, '.arena-dependencies.json'), JSON.stringify({ fingerprint, installedAt: new Date().toISOString(), ...stats }), { mode: 0o600 });
        fs.rmSync(cacheDir, { recursive: true, force: true }); fs.renameSync(tempCache, cacheDir);
      } catch (error) { fs.rmSync(tempCache, { recursive: true, force: true }); throw error; }
      result.stdout = `${result.stdout || ''}\n[Arena] Dependencies cached outside the project; lifecycle scripts were disabled. Cache key: ${fingerprint}.\n`;
      result.dependenciesCached = true; result.cacheKey = fingerprint; result.dependencyCount = stats.files;
    }
    if (!installing && result.code === 0) result.stdout = `${result.stdout || ''}\n[Arena] ${action === 'npm-build' ? 'Build' : 'Tests'} ran against a disposable project copy${dependencyCacheExists(cacheDir, fingerprint) ? ' with the read-only dependency cache' : ' without a cached dependency tree'}.\n`;
    return result;
  } catch (error) {
    return { code: 1, stdout: result.stdout || '', stderr: `${result.stderr || ''}\n${error.message}`.slice(-12_000), timedOut: result.timedOut || false };
  } finally {
    await runProcess(DOCKER_BIN, ['rm', '--force', containerName], ROOT, 5_000).catch(() => {});
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

function pythonDependencyFingerprint(projectDirPath) {
  const hash = crypto.createHash('sha256');
  for (const name of ['requirements.txt', 'pyproject.toml']) {
    const file = path.join(projectDirPath, name);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) { hash.update(name); hash.update(fs.readFileSync(file)); }
  }
  return hash.digest('hex').slice(0, 32);
}
function pythonDependencyCache(projectId, projectDirPath) {
  const fingerprint = pythonDependencyFingerprint(projectDirPath);
  return { fingerprint, dir: path.join(DEPENDENCIES, projectId, `python-${fingerprint}`) };
}
function pythonCacheExists(cacheDir, fingerprint) {
  try { const manifest = JSON.parse(fs.readFileSync(path.join(cacheDir, '.arena-python-dependencies.json'), 'utf8')); return manifest.fingerprint === fingerprint && fs.statSync(path.join(cacheDir, 'python-deps')).isDirectory(); } catch { return false; }
}
async function runDockerPythonProjectAction(projectId, projectDirPath, action, targetPath = '') {
  const image = await runProcess(DOCKER_BIN, ['image', 'inspect', DOCKER_PYTHON_IMAGE], ROOT, 10_000);
  if (image.code !== 0) return { code: 127, stdout: image.stdout, stderr: `Docker image ${DOCKER_PYTHON_IMAGE} is not available locally. Pull the image before enabling Python execution.\n${image.stderr}`.slice(-12_000), timedOut: image.timedOut };
  const sandbox = fs.mkdtempSync(path.join(EXEC_WORKSPACES, `${projectId.slice(0, 8)}-${action}-`));
  const containerName = `arena-${action.replace(/[^a-z]/g,'')}-${projectId.slice(0, 8)}-${crypto.randomUUID().slice(0, 8)}`;
  const cache = pythonDependencyCache(projectId, projectDirPath); const installing = action === 'python-install'; let result = { code: 1, stdout: '', stderr: '', timedOut: false };
  try {
    copyProjectToExecutionWorkspace(projectDirPath, sandbox, false);
    if (action === 'python-install' && !fs.existsSync(path.join(sandbox, 'requirements.txt'))) throw new Error('Python dependency installation requires a root requirements.txt file.');
    if (action === 'python-test' && !walkProject(sandbox).some(x => x.type === 'file' && /^(?:test_.*\.py|.*_test\.py|tests\/)/i.test(x.path))) throw new Error('No Python unittest files were found in this project.');
    fs.mkdirSync(path.dirname(cache.dir), { recursive: true, mode: 0o700 });
    if (installing && pythonCacheExists(cache.dir, cache.fingerprint)) return { code: 0, stdout: 'Python dependencies already installed for this requirements manifest.\n', stderr: '', timedOut: false, dependenciesCached: true, cacheKey: cache.fingerprint };
    const hasCache = !installing && pythonCacheExists(cache.dir, cache.fingerprint);
    const args = ['run','--rm','--name',containerName, installing ? '--network=bridge' : '--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=768m','--memory-swap=768m','--cpus=1','--pids-limit=128','--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=128m','--mount',`type=bind,source=${sandbox},target=/workspace`,'--workdir','/workspace','--env','HOME=/tmp'];
    if (hasCache) args.push('--mount',`type=bind,source=${path.join(cache.dir,'python-deps')},target=/workspace/.arena-pydeps,readonly`,'--env','PYTHONPATH=/workspace/.arena-pydeps');
    args.push(DOCKER_PYTHON_IMAGE);
    if (installing) args.push('python','-m','pip','install','--only-binary=:all:','--no-compile','--disable-pip-version-check','--no-cache-dir','-r','requirements.txt','--target','/workspace/python-deps');
    else args.push('python','-m','unittest','discover','-v');
    result = await runProcess(DOCKER_BIN, args, ROOT, installing ? 240_000 : 90_000);
    if (installing && result.code === 0 && !result.timedOut) {
      const deps = path.join(sandbox, 'python-deps'); if (!fs.existsSync(deps) || !fs.statSync(deps).isDirectory()) throw new Error('pip completed but did not create the expected dependency directory.');
      const stats = measureAndValidateDependencyTree(deps); const tempCache = `${cache.dir}.tmp-${crypto.randomUUID()}`;
      try { fs.mkdirSync(tempCache,{recursive:true,mode:0o700}); fs.cpSync(deps,path.join(tempCache,'python-deps'),{recursive:true,dereference:false,verbatimSymlinks:true,errorOnExist:true}); fs.writeFileSync(path.join(tempCache,'.arena-python-dependencies.json'),JSON.stringify({fingerprint:cache.fingerprint,installedAt:new Date().toISOString(),...stats}),{mode:0o600}); fs.rmSync(cache.dir,{recursive:true,force:true}); fs.renameSync(tempCache,cache.dir); }
      catch(error) { fs.rmSync(tempCache,{recursive:true,force:true}); throw error; }
      result.stdout = `${result.stdout || ''}\n[Arena] Python wheels cached outside the project; source distributions are disallowed. Cache key: ${cache.fingerprint}.\n`;
      result.dependenciesCached = true; result.cacheKey = cache.fingerprint; result.dependencyCount = stats.files;
    }
    return { ...result, dependenciesCached: hasCache };
  } catch (error) { return { code: 1, stdout: result.stdout || '', stderr: `${result.stderr || ''}\n${error.message}`.slice(-12_000), timedOut: result.timedOut || false }; }
  finally { await runProcess(DOCKER_BIN, ['rm','--force',containerName], ROOT, 5_000).catch(() => {}); fs.rmSync(sandbox,{recursive:true,force:true}); }
}

function wsFrame(data, opcode = 1) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  let header;
  if (payload.length < 126) { header = Buffer.alloc(2); header[1] = payload.length; }
  else if (payload.length <= 65535) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(payload.length, 2); }
  else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
  header[0] = 0x80 | opcode; return Buffer.concat([header, payload]);
}
function wsClose(socket, code = 1000, reason = '') {
  if (socket.destroyed) return;
  const msg = Buffer.from(reason).subarray(0, 120); const payload = Buffer.alloc(2 + msg.length); payload.writeUInt16BE(code, 0); msg.copy(payload, 2);
  try { socket.write(wsFrame(payload, 8)); } catch {} socket.end();
}
function parseClientFrames(buffer, callback) {
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const start = offset; const b1 = buffer[offset++], b2 = buffer[offset++]; const fin = Boolean(b1 & 0x80), opcode = b1 & 0x0f, masked = Boolean(b2 & 0x80), reserved = Boolean(b1 & 0x70); let length = b2 & 0x7f;
    if (!fin || reserved || (opcode !== 1 && opcode !== 8 && opcode !== 9 && opcode !== 10) || !masked) return { remaining: Buffer.alloc(0), error: 'Unsupported WebSocket frame.' };
    if (length === 126) { if (buffer.length - offset < 2) return { remaining: buffer.subarray(start), error: null }; length = buffer.readUInt16BE(offset); offset += 2; }
    else if (length === 127) { if (buffer.length - offset < 8) return { remaining: buffer.subarray(start), error: null }; const big = buffer.readBigUInt64BE(offset); offset += 8; if (big > 2_000_000n) return { remaining: Buffer.alloc(0), error: 'Frame too large.' }; length = Number(big); }
    if (length > 2_000_000) return { remaining: Buffer.alloc(0), error: 'Frame too large.' };
    if ([8, 9, 10].includes(opcode) && length > 125) return { remaining: Buffer.alloc(0), error: 'Control frame too large.' };
    if (opcode === 8 && length === 1) return { remaining: Buffer.alloc(0), error: 'Invalid close frame.' };
    if (buffer.length - offset < 4 + length) return { remaining: buffer.subarray(start), error: null };
    const mask = buffer.subarray(offset, offset + 4); offset += 4; const payload = Buffer.from(buffer.subarray(offset, offset + length)); offset += length;
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    callback(opcode, payload);
  }
  return { remaining: buffer.subarray(offset), error: null };
}
function mapLspUris(value, rootDir, direction) {
  if (Array.isArray(value)) return value.map(v => mapLspUris(v, rootDir, direction));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && /(?:uri|Uri)$/.test(key) && item.startsWith('file:')) {
      try {
        const u = new URL(item);
        if (direction === 'in' && u.protocol === 'file:' && (u.pathname === '/workspace' || u.pathname.startsWith('/workspace/'))) {
          const rel = decodeURIComponent(u.pathname.slice('/workspace'.length)).replace(/^\//, '');
          const target = path.resolve(rootDir, ...rel.split('/').filter(Boolean));
          out[key] = target === rootDir || target.startsWith(rootDir + path.sep) ? pathToFileURL(target).href : item;
        } else if (direction === 'out' && u.protocol === 'file:') {
          const target = path.resolve(fileURLToPath(u));
          if (target === rootDir || target.startsWith(rootDir + path.sep)) {
            const rel = path.relative(rootDir, target).split(path.sep).filter(Boolean).map(encodeURIComponent).join('/'); out[key] = `file:///workspace${rel ? '/' + rel : ''}`;
          } else out[key] = 'file:///workspace/__external__';
        } else out[key] = item;
      } catch { out[key] = item; }
    } else out[key] = mapLspUris(item, rootDir, direction);
  }
  return out;
}
function handleLspUpgrade(req, socket, head, url) {
  if (Object.keys(LSP_CONFIG).length === 0) { socket.destroy(); return; }
  const host = req.headers.host || '';
  if (req.headers.origin) { try { if (new URL(req.headers.origin).host !== host) { socket.destroy(); return; } } catch { socket.destroy(); return; } }
  const language = url.searchParams.get('language') || ''; const id = url.searchParams.get('projectId') || '';
  if (!Object.hasOwn(LSP_CONFIG, language) || !validProjectId(id)) { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key']; if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') { socket.destroy(); return; }
  let dir; try { dir = projectDir(id); if (!fs.statSync(dir).isDirectory()) throw new Error('missing'); } catch { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const config = LSP_CONFIG[language];
  let child; let wsBuffer = Buffer.alloc(0), stdoutBuffer = Buffer.alloc(0), closed = false;
  const childEnv = { PATH: process.env.PATH || '', HOME: process.env.HOME || '', USERPROFILE: process.env.USERPROFILE || '', SYSTEMROOT: process.env.SYSTEMROOT || '', WINDIR: process.env.WINDIR || '', TMP: process.env.TMP || '', TEMP: process.env.TEMP || '', LANG: process.env.LANG || 'C.UTF-8' };
  const sendJson = obj => { if (!socket.destroyed) socket.write(wsFrame(JSON.stringify(obj))); };
  const sendLsp = obj => { const mapped = mapLspUris(obj, dir, 'in'); const body = Buffer.from(JSON.stringify(mapped)); child.stdin.write(Buffer.from(`Content-Length: ${body.length}\r\n\r\n`)); child.stdin.write(body); };
  const cleanup = () => { if (closed) return; closed = true; try { if (child && child.exitCode === null) child.kill('SIGTERM'); } catch {} };
  try { child = spawn(config.command, config.args, { cwd: dir, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); }
  catch (error) { sendJson({ jsonrpc:'2.0', method:'arena/lspError', params:{message:'Could not start configured language server.'} }); wsClose(socket, 1011, 'LSP spawn failed'); return; }
  child.once('error', error => { sendJson({jsonrpc:'2.0',method:'arena/lspError',params:{message:`Language server could not start: ${String(error.message).slice(0,180)}`}}); wsClose(socket,1011,'LSP spawn failed'); cleanup(); });
  child.stderr.on('data', chunk => { const text = chunk.toString('utf8').slice(-1000); sendJson({jsonrpc:'2.0',method:'arena/lspLog',params:{message:text}}); });
  child.stdout.on('data', chunk => {
    stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
    if (stdoutBuffer.length > 2_200_000) { wsClose(socket,1009,'LSP output too large'); cleanup(); return; }
    while (true) {
      const divider = stdoutBuffer.indexOf('\r\n\r\n'); if (divider < 0) break;
      const header = stdoutBuffer.subarray(0, divider).toString('ascii'); const match = header.match(/Content-Length:\s*(\d+)/i); if (!match) { wsClose(socket,1011,'Invalid LSP framing'); cleanup(); return; }
      const length = Number(match[1]); if (!Number.isSafeInteger(length) || length < 0 || length > 2_000_000) { wsClose(socket,1009,'LSP payload too large'); cleanup(); return; }
      const start = divider + 4; if (stdoutBuffer.length < start + length) break;
      let message; try { message = JSON.parse(stdoutBuffer.subarray(start, start + length).toString('utf8')); } catch { wsClose(socket,1011,'Invalid LSP JSON'); cleanup(); return; }
      stdoutBuffer = stdoutBuffer.subarray(start + length); sendJson(mapLspUris(message, dir, 'out'));
    }
  });
  child.once('close', code => { sendJson({jsonrpc:'2.0',method:'arena/lspExit',params:{code}}); wsClose(socket,1000,'Language server exited'); cleanup(); });
  socket.on('data', chunk => {
    wsBuffer = Buffer.concat([wsBuffer, chunk]);
    if (wsBuffer.length > 2_100_000) { wsClose(socket,1009,'WebSocket data too large'); cleanup(); return; }
    const parsed = parseClientFrames(wsBuffer, (opcode, payload) => {
      if (opcode === 8) { wsClose(socket,1000); cleanup(); return; }
      if (opcode === 9) { if (!socket.destroyed) socket.write(wsFrame(payload,10)); return; }
      if (opcode !== 1) return;
      let message; try { message = JSON.parse(payload.toString('utf8')); } catch { wsClose(socket,1007,'Invalid JSON'); cleanup(); return; }
      const allowed = new Set(['initialize','initialized','shutdown','exit','textDocument/didOpen','textDocument/didChange','textDocument/didClose','textDocument/completion','textDocument/hover','textDocument/definition','textDocument/references','textDocument/formatting','textDocument/rangeFormatting','textDocument/rename','textDocument/signatureHelp','textDocument/documentSymbol','textDocument/foldingRange','workspace/didChangeConfiguration','workspace/didChangeWatchedFiles','workspace/configuration']);
      if (typeof message.method !== 'string' || !allowed.has(message.method)) { if (message.id != null) sendJson({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method is not permitted by Arena LSP bridge.'}}); return; }
      try { if (child?.stdin?.writable) sendLsp(message); else if (message.id != null) sendJson({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:'Language server is not writable.'}}); } catch (error) { if (message.id != null) sendJson({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:'Could not forward LSP request.'}}); }
    });
    if (parsed.error) { wsClose(socket,1002,parsed.error); cleanup(); } else wsBuffer = parsed.remaining;
  });
  socket.on('error', cleanup); socket.on('close', cleanup);
  if (head?.length) socket.unshift(head);
}
function runProcess(command, args, cwd, timeoutMs, useShell = false) {
  return new Promise(resolve => {
    let stdout = '', stderr = '', timedOut = false;
    const child = spawn(command, args, { cwd, shell: useShell, detached: process.platform !== 'win32', windowsHide: true, env: { PATH: process.env.PATH || '', SYSTEMROOT: process.env.SYSTEMROOT || '', WINDIR: process.env.WINDIR || '', HOME: process.env.HOME || '', USERPROFILE: process.env.USERPROFILE || '', TMP: process.env.TMP || '', TEMP: process.env.TEMP || '', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } });
    const append = (base, chunk) => (base + chunk.toString()).slice(-12_000);
    child.stdout.on('data', c => { stdout = append(stdout, c); }); child.stderr.on('data', c => { stderr = append(stderr, c); });
    const terminateTree = signal => {
      if (process.platform === 'win32') {
        try { const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); killer.unref(); } catch { try { child.kill(signal); } catch {} }
      } else { try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} } }
    };
    const timer = setTimeout(() => { timedOut = true; terminateTree('SIGTERM'); setTimeout(() => { terminateTree('SIGKILL'); }, 1000).unref(); }, timeoutMs);
    child.on('error', e => { clearTimeout(timer); resolve({ code: 127, stdout, stderr: stderr || e.message, timedOut }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr, timedOut }); });
  });
}
if (!['127.0.0.1', '::1', 'localhost'].includes(HOST) && process.env.ARENA_ALLOW_REMOTE !== '1') {
  console.error('Refusing to bind Arena Code to a remote interface by default. Use HOST=127.0.0.1 or explicitly set ARENA_ALLOW_REMOTE=1 after reviewing the security risks.');
  process.exit(1);
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) { if (HOSTED_MODE) await hostedApp.handle(req, res, url); else await handleApi(req, res, url); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { fail(res, 405, 'Method not allowed.'); return; }
    let decoded; try { decoded = decodeURIComponent(url.pathname); } catch { fail(res, 400, 'Invalid URL path.'); return; }
    if (decoded.includes('\0') || decoded.includes('\\')) { fail(res, 400, 'Invalid URL path.'); return; }
    const relative = decoded === '/' ? 'index.html' : decoded.slice(1);
    const full = path.resolve(PUBLIC, relative);
    if (full !== PUBLIC && !full.startsWith(PUBLIC + path.sep)) { fail(res, 403, 'Forbidden.'); return; }
    let stat; try { stat = fs.statSync(full); } catch { fail(res, 404, 'Not found.'); return; }
    if (!stat.isFile()) { fail(res, 404, 'Not found.'); return; }
    const ext = path.extname(full).toLowerCase();
    if (!MIME[ext]) { fail(res, 404, 'File type not served.'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300', 'Content-Length': stat.size });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(full).pipe(res);
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    fail(res, error.status || 500, error.status ? error.message : 'Internal server error.');
  }
});
server.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (HOSTED_MODE && /^\/api\/projects\/[a-f0-9-]{36}\/preview\//i.test(url.pathname)) {
      hostedApp.handlePreviewUpgrade(req,socket,head,url).catch(()=>{if(!socket.destroyed)socket.destroy();});return;
    }
    if (url.pathname !== '/api/lsp') { socket.destroy(); return; }
    if (HOSTED_MODE) {
      // In hosted mode, workspace authorization is checked before the app proxies
      // the upgrade to the isolated language-server runner.
      hostedApp.handleLspUpgrade(req, socket, head, url).catch(() => { if (!socket.destroyed) socket.destroy(); });
      return;
    }
    handleLspUpgrade(req, socket, head, url);
  } catch { socket.destroy(); }
});
function startServer() {
  server.listen(PORT, HOST, () => {
    console.log(`Arena Code ${HOSTED_MODE ? '(hosted mode)' : '(local mode)'} ready at http://${HOST}:${PORT}`);
    if (HOST !== '127.0.0.1' && HOST !== '::1' && HOST !== 'localhost' && !HOSTED_MODE) console.warn('WARNING: Arena Code is bound to a non-local interface. Local mode is not intended for public exposure.');
    if (API_KEY) console.log(`AI provider configured (${AI_BASE_URL}); the API key is only read from the server environment.`);
  });
}
if (HOSTED_MODE) hostedApp.init().then(startServer).catch(error => { console.error(`Could not initialize hosted database: ${error.message}`); process.exit(1); });
else startServer();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { for (const entry of managedProcesses.values()) terminateManagedProcess(entry); server.close(() => { if (hostedApp) hostedApp.close().finally(() => process.exit(0)); else process.exit(0); }); setTimeout(() => process.exit(0), 1800).unref(); });
