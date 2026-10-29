'use strict';
// Bounded, local-only, full-project snapshots. Deliberately not enabled on hosted workspaces.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { makeZip, parseZip } = require('./zip-utils.cjs');
const MAX_SNAPSHOTS = 8;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_PROJECT_BYTES = 100 * 1024 * 1024;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 500;
function problem(status, message) { return Object.assign(new Error(message), { status }); }
function snapshotDir(root, projectId) {
  if (!/^[a-f0-9-]{36}$/i.test(projectId)) throw problem(400, 'Invalid project ID.');
  return path.join(root, projectId);
}
function listings(root, projectId) {
  const dir = snapshotDir(root, projectId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(n => /^[a-f0-9-]{36}\.json$/i.test(n)).map(n => {
    try {
      const obj = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
      if (obj.id + '.json' !== n || typeof obj.createdAt !== 'string' || typeof obj.name !== 'string') return null;
      const file = path.join(dir, `${obj.id}.zip`);
      return fs.existsSync(file) ? { id: obj.id, name: obj.name, createdAt: obj.createdAt, bytes: fs.statSync(file).size, files: obj.files } : null;
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function create({ root, projectId, projectDir, name, listFiles, resolveFile }) {
  if (typeof name !== 'string' || !name.trim() || name.length > 80 || /[\x00-\x1f]/.test(name)) throw problem(400, 'A checkpoint name of 1–80 characters is required.');
  const entries = []; let total = 0;
  for (const item of listFiles()) {
    if (item.type !== 'file' || item.path === '.arena-project.json') continue;
    if (entries.length >= MAX_FILES || item.size > MAX_FILE_BYTES) throw problem(413, 'Project exceeds checkpoint file limits.');
    // The workspace explorer may see credentials manually placed on disk,
    // even though the editor refuses to write them. Never archive secrets.
    if (item.path.split('/').some(part => part === '.env' || part.startsWith('.env.') || ['.npmrc', '.pypirc', '.git-credentials', 'id_rsa', 'id_ed25519', 'id_ecdsa'].includes(part.toLowerCase()) || /\.(?:pem|key)$/i.test(part))) continue;
    const file = resolveFile(item.path);
    const data = fs.readFileSync(file.full);
    total += data.length;
    if (total > MAX_PROJECT_BYTES) throw problem(413, 'Project exceeds checkpoint size limit.');
    entries.push({ name: file.rel, data });
  }
  const zip = makeZip(entries, { maxFiles: MAX_FILES, maxBytes: MAX_PROJECT_BYTES });
  if (zip.length > MAX_SNAPSHOT_BYTES) throw problem(413, 'Checkpoint archive exceeds 8 MB. Export the project ZIP to back up larger projects.');
  const id = crypto.randomUUID();
  const record = { id, name: name.trim(), createdAt: new Date().toISOString(), files: entries.length };
  const dir = snapshotDir(root, projectId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, `${id}.zip`), zip, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(record), { flag: 'wx', mode: 0o600 });
  for (const old of listings(root, projectId).slice(MAX_SNAPSHOTS)) {
    for (const suffix of ['.json', '.zip']) fs.rmSync(path.join(dir, `${old.id}${suffix}`), { force: true });
  }
  return { ...record, bytes: zip.length };
}
function restore({ root, projectId, projectDir, checkpointId, validatePath }) {
  if (typeof checkpointId !== 'string' || !/^[a-f0-9-]{36}$/i.test(checkpointId)) throw problem(400, 'Invalid checkpoint ID.');
  const dir = snapshotDir(root, projectId);
  const known = listings(root, projectId).find(x => x.id === checkpointId);
  if (!known) throw problem(404, 'Checkpoint not found.');
  const archive = fs.readFileSync(path.join(dir, `${checkpointId}.zip`));
  if (archive.length > MAX_SNAPSHOT_BYTES) throw problem(413, 'Checkpoint is too large.');
  const entries = parseZip(archive, { maxFiles: MAX_FILES, maxFileBytes: MAX_FILE_BYTES, maxTotalBytes: MAX_PROJECT_BYTES });
  const seen = new Set();
  for (const entry of entries) {
    const safe = validatePath(entry.name);
    if (safe !== entry.name || seen.has(safe)) throw problem(400, 'Checkpoint contains invalid or duplicate paths.');
    seen.add(safe);
    for (const parent of safe.split('/').slice(0, -1).map((_, i) => safe.split('/').slice(0, i + 1).join('/'))) {
      if (seen.has(parent)) throw problem(400, 'Checkpoint path conflicts with a file.');
    }
  }
  for (const rel of seen) {
    const segments = rel.split('/');
    for (let i = 1; i < segments.length; i++) if (seen.has(segments.slice(0, i).join('/'))) throw problem(400, 'Checkpoint path conflicts with a file.');
  }
  if (!fs.existsSync(path.join(projectDir, '.arena-project.json'))) throw problem(400, 'Project metadata is missing.');
  const temp = `${projectDir}.restore-${crypto.randomUUID()}`;
  const backup = `${projectDir}.previous-${crypto.randomUUID()}`;
  let originalMoved = false, restoredMoved = false;
  try {
    fs.mkdirSync(temp, { mode: 0o700 });
    fs.copyFileSync(path.join(projectDir, '.arena-project.json'), path.join(temp, '.arena-project.json'));
    for (const entry of entries) {
      const out = path.join(temp, ...entry.name.split('/'));
      if (!out.startsWith(temp + path.sep)) throw problem(400, 'Checkpoint path escaped workspace.');
      fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
      fs.writeFileSync(out, entry.data, { flag: 'wx', mode: 0o600 });
    }
    fs.renameSync(projectDir, backup); originalMoved = true;
    fs.renameSync(temp, projectDir); restoredMoved = true;
    // Preserve local-only and generated top-level material that is deliberately
    // excluded from checkpoints (Git metadata, dependencies, environment keys).
    // A checkpoint restores source code; it must not destroy an existing Git
    // repository or secrets merely because they were not archived.
    for (const name of fs.readdirSync(backup)) {
      if (name === '.arena-project.json' || name === '.' || name === '..') continue;
      if (!(name === '.git' || name === '.arena' || name === 'node_modules' || name === 'dist' || name === 'build' || name === '.next' || name === '.cache' || name === '.env' || name.startsWith('.env.') || name === '.npmrc' || name === '.pypirc')) continue;
      const from = path.join(backup, name), target = path.join(projectDir, name);
      // All archive paths were validated using the same reserved-path policy,
      // so no restored archive entry should conflict with these names.
      if (!fs.existsSync(target)) fs.renameSync(from, target);
    }
    fs.rmSync(backup, { recursive: true, force: true });
    return { ok: true, restoredFiles: entries.length, checkpoint: known };
  } catch (error) {
    if (originalMoved && !restoredMoved) { try { fs.renameSync(backup, projectDir); } catch {} }
    throw error;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
module.exports = { listings, create, restore };
