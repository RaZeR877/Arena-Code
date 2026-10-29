/* Arena Code browser-only, text-project core. No Node, storage, network or execution dependency. */
(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  if (root) root.ArenaBrowserCore = core;
})(typeof globalThis === 'undefined' ? null : globalThis, function () {
  'use strict';
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const MAX_FILES = 100, MAX_FILE_BYTES = 400 * 1024, MAX_TOTAL_BYTES = 3 * 1024 * 1024;
  const forbidden = /(^|\/)(?:\.git|\.env(?:\..*)?|\.npmrc|node_modules|\.next|\.ssh|\.aws|\.cache|dist|build)(?:\/|$)|(?:^|\/)(?:id_rsa|id_ed25519|[^/]+\.(?:pem|p12|pfx|key))$/i;
  function safePath(path) {
    if (typeof path !== 'string' || !path || path.length > 240 || path.includes('\\') || path.includes('\0') || path.startsWith('/') || /^[a-zA-Z]:/.test(path)) throw Error('Invalid project path');
    const parts = path.split('/');
    if (parts.some(x => !x || x === '.' || x === '..' || /[\x00-\x1f]/.test(x)) || forbidden.test(path)) throw Error('Unsafe path: ' + path);
    return path;
  }
  function normalize(project) {
    if (!project || typeof project !== 'object' || Array.isArray(project) || !project.files || typeof project.files !== 'object' || Array.isArray(project.files)) throw Error('Invalid browser project');
    const name = String(project.name || 'My project').trim().slice(0, 80) || 'My project';
    const files = Object.create(null);
    let total = 0, count = 0;
    for (const [path, content] of Object.entries(project.files)) {
      safePath(path);
      if (typeof content !== 'string') throw Error('Only UTF-8 text source files are supported: ' + path);
      const len = encoder.encode(content).length;
      if (len > MAX_FILE_BYTES) throw Error('File exceeds 400 KiB: ' + path);
      total += len; count++;
      if (count > MAX_FILES || total > MAX_TOTAL_BYTES) throw Error('This browser workspace exceeds its 100-file / 3 MiB budget');
      files[path] = content;
    }
    const paths = Object.keys(files);
    if (paths.some(p => paths.some(q => q !== p && q.startsWith(p + '/')))) throw Error('File and directory paths conflict');
    return { format: 'arena-pages-project-v1', name, files, revision: Math.max(0, Number(project.revision) || 0), updatedAt: new Date().toISOString() };
  }
  function starter() {
    return normalize({ name: 'My first Arena project', files: {
      'index.html': '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width,initial-scale=1">\n  <title>Arena project</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <main><h1>Hello from Arena Code ✦</h1><p>Edit the files, then click Preview.</p><button id="hello">Try me</button></main>\n  <script src="app.js"></script>\n</body>\n</html>',
      'style.css': 'body { margin: 0; background: #111827; color: #f9fafb; font: 16px system-ui; }\nmain { max-width: 640px; margin: 10vh auto; padding: 30px; }\nbutton { background: #a78bfa; padding: 12px 18px; border: 0; border-radius: 10px; cursor: pointer; }',
      'app.js': 'document.querySelector("#hello").addEventListener("click", () => {\n  document.querySelector("h1").textContent = "It works!";\n});'
    }});
  }
  function update(project, changes) {
    if (!Array.isArray(changes) || !changes.length || changes.length > 10) throw Error('Provide 1–10 changes');
    const next = { ...project.files };
    for (const change of changes) {
      if (!change || typeof change !== 'object') throw Error('Invalid change');
      const path = safePath(change.path);
      if (change.delete === true) { if (!(path in next)) throw Error('File not found: ' + path); delete next[path]; }
      else { if (typeof change.content !== 'string') throw Error('File change must contain text'); next[path] = change.content; }
    }
    return normalize({ name: project.name, files: next, revision: (project.revision || 0) + 1 });
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : c >>> 1; return c >>> 0; });
  function crc32(bytes) { let c = -1; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
  function w16(d, o, n) { d.setUint16(o, n, true); } function w32(d, o, n) { d.setUint32(o, n, true); }
  function zip(project) {
    const normalized = normalize(project);
    const locals = [], central = []; let offset = 0;
    for (const [name, value] of Object.entries(normalized.files).sort((a, b) => a[0].localeCompare(b[0]))) {
      const filename = encoder.encode(name), data = encoder.encode(value), crc = crc32(data);
      const local = new Uint8Array(30 + filename.length + data.length), ld = new DataView(local.buffer);
      w32(ld, 0, 0x04034b50); w16(ld, 4, 20); w16(ld, 6, 0x800); w16(ld, 8, 0); w32(ld, 14, crc); w32(ld, 18, data.length); w32(ld, 22, data.length); w16(ld, 26, filename.length);
      local.set(filename, 30); local.set(data, 30 + filename.length);
      const entry = new Uint8Array(46 + filename.length), cd = new DataView(entry.buffer);
      w32(cd, 0, 0x02014b50); w16(cd, 4, 20); w16(cd, 6, 20); w16(cd, 8, 0x800); w16(cd, 10, 0); w32(cd, 16, crc); w32(cd, 20, data.length); w32(cd, 24, data.length); w16(cd, 28, filename.length); w32(cd, 42, offset); entry.set(filename, 46);
      locals.push(local); central.push(entry); offset += local.length;
    }
    const centralSize = central.reduce((n, b) => n + b.length, 0), end = new Uint8Array(22), ed = new DataView(end.buffer);
    w32(ed, 0, 0x06054b50); w16(ed, 8, central.length); w16(ed, 10, central.length); w32(ed, 12, centralSize); w32(ed, 16, offset);
    const output = new Uint8Array(offset + centralSize + end.length); let at = 0;
    for (const part of [...locals, ...central, end]) { output.set(part, at); at += part.length; }
    return output;
  }
  async function unzip(arrayBuffer, inflate) {
    const bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    if (bytes.length > 5 * 1024 * 1024) throw Error('ZIP file exceeds 5 MiB upload limit');
    const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = o => d.getUint16(o, true), u32 = o => d.getUint32(o, true);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === bytes.length) { eocd = i; break; }
    if (eocd < 0) throw Error('Invalid or unsupported ZIP footer');
    if (u16(eocd + 4) || u16(eocd + 6) || u16(eocd + 8) !== u16(eocd + 10)) throw Error('Multi-disk ZIP is not supported');
    const count = u16(eocd + 10), cdLength = u32(eocd + 12), cdStart = u32(eocd + 16);
    if (count > MAX_FILES || cdStart + cdLength > eocd) throw Error('Invalid ZIP directory');
    let p = cdStart; const files = Object.create(null); let expanded = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > cdStart + cdLength || u32(p) !== 0x02014b50) throw Error('Invalid ZIP entry directory');
      const flags = u16(p + 8), method = u16(p + 10), checksum = u32(p + 16), size = u32(p + 20), uncompressed = u32(p + 24), n = u16(p + 28), extra = u16(p + 30), comment = u16(p + 32), start = u32(p + 42);
      if (p + 46 + n + extra + comment > cdStart + cdLength) throw Error('Invalid ZIP filename');
      if (flags & 1 || ![0, 8].includes(method) || size === 0xffffffff || uncompressed === 0xffffffff) throw Error('Encrypted, unsupported or ZIP64 files are not supported');
      const name = decoder.decode(bytes.subarray(p + 46, p + 46 + n));
      p += 46 + n + extra + comment;
      if (name.endsWith('/')) { safePath(name.slice(0, -1)); continue; }
      safePath(name);
      if (Object.hasOwn(files, name)) throw Error('Duplicate ZIP entry: ' + name);
      if (uncompressed > MAX_FILE_BYTES || (expanded += uncompressed) > MAX_TOTAL_BYTES) throw Error('ZIP contents exceed browser workspace limits');
      if (start + 30 > bytes.length || u32(start) !== 0x04034b50) throw Error('Invalid ZIP local header');
      const localNameLength = u16(start + 26), localExtraLength = u16(start + 28);
      const localName = decoder.decode(bytes.subarray(start + 30, start + 30 + localNameLength));
      if (localName !== name || u16(start + 8) !== method) throw Error('Conflicting ZIP entry headers');
      const dataStart = start + 30 + localNameLength + localExtraLength;
      if (dataStart + size > cdStart) throw Error('ZIP data extends beyond directory');
      const compressed = bytes.slice(dataStart, dataStart + size);
      let output;
      if (method === 0) output = compressed;
      else if (typeof inflate === 'function') output = await inflate(compressed);
      else if (typeof DecompressionStream !== 'undefined') {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        const reader = stream.getReader(), chunks = []; let total = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > MAX_FILE_BYTES) { await reader.cancel(); throw Error('ZIP entry expands beyond 400 KiB'); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        output = new Uint8Array(total); let at = 0;
        for (const chunk of chunks) { output.set(chunk, at); at += chunk.length; }
      } else throw Error('Compressed ZIP import is unavailable in this browser; use folder import or an uncompressed ZIP');
      if (output.length !== uncompressed || crc32(output) !== checksum) throw Error('ZIP size or checksum mismatch: ' + name);
      files[name] = decoder.decode(output);
    }
    if (p !== cdStart + cdLength) throw Error('Invalid ZIP directory length');
    return normalize({ name: 'Imported project', files });
  }
  function check(path, content) {
    const extension = String(path).split('.').pop().toLowerCase();
    if (/^(?:js|cjs|mjs|jsx)$/.test(extension)) {
      if (/\b(?:import|export)\b/.test(content)) return { status: 'unverified', message: 'ES modules need a real build/language service to validate; not executed here.' };
      try { new Function(content); return { status: 'pass', message: 'JavaScript syntax parsed (not executed)' }; } catch (e) { return { status: 'fail', message: String(e.message) }; }
    }
    if (extension === 'json') { try { JSON.parse(content); return { status: 'pass', message: 'JSON parses successfully' }; } catch (e) { return { status: 'fail', message: String(e.message) }; } }
    if (extension === 'html' || extension === 'htm') return /<html\b/i.test(content) && /<body\b/i.test(content) ? { status: 'pass', message: 'Basic HTML structural check only; runtime not verified' } : { status: 'unverified', message: 'HTML structure incomplete; browser rendering may still work' };
    return { status: 'unverified', message: 'No safe in-browser parser configured for this file type' };
  }
  function parseSuggestion(raw, existing) {
    let text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = text.indexOf('{'), end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw Error('AI did not return valid JSON edits');
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed.changes) || !parsed.changes.length || parsed.changes.length > 5) throw Error('AI must propose between 1 and 5 file changes');
    const seen = new Set();
    const changes = parsed.changes.map(item => {
      const path = safePath(item.path);
      if (seen.has(path)) throw Error('Repeated edit path: ' + path);
      seen.add(path);
      if (item.delete === true) { if (!Object.hasOwn(existing.files, path)) throw Error('Cannot delete missing file: ' + path); return { path, delete: true }; }
      if (typeof item.content !== 'string' || encoder.encode(item.content).length > MAX_FILE_BYTES) throw Error('AI returned oversized or invalid file text: ' + path);
      return { path, content: item.content };
    });
    // Validation occurs before asking the user to review any changes.
    update(existing, changes);
    return { summary: String(parsed.summary || 'AI suggested project edits').slice(0, 500), changes };
  }
  return Object.freeze({ starter, safePath, normalize, update, zip, unzip, check, parseSuggestion, crc32, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES });
});
