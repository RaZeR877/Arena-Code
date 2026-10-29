'use strict';

const zlib = require('node:zlib');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function makeZip(entries, options = {}) {
  const maxFiles = options.maxFiles ?? 500;
  const maxBytes = options.maxBytes ?? 100 * 1024 * 1024;
  if (!Array.isArray(entries) || entries.length > maxFiles) throw new Error('Archive contains too many files.');
  let totalBytes = 0;
  let offset = 0;
  const localParts = [];
  const centralParts = [];
  const seen = new Set();
  const stamp = dosDateTime();

  for (const entry of entries) {
    const name = String(entry.name || '').replace(/\\/g, '/');
    if (!name || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').some(part => !part || part === '.' || part === '..') || name.includes('\0')) throw new Error('Archive contains an invalid file path.');
    if (seen.has(name)) throw new Error(`Archive contains a duplicate path: ${name}`);
    seen.add(name);
    const nameBytes = Buffer.from(name, 'utf8');
    if (nameBytes.length > 0xffff) throw new Error('Archive file name is too long.');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '');
    totalBytes += data.length;
    if (data.length > maxBytes || totalBytes > maxBytes) throw new Error('Archive contents exceed the size limit.');
    const compressed = zlib.deflateRawSync(data, { level: 6 });
    if (data.length > 0xffffffff || compressed.length > 0xffffffff || offset > 0xffffffff) throw new Error('ZIP64 archives are not supported.');
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 file names.
    local.writeUInt16LE(8, 8); // Deflate.
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // Unix, ZIP 3.0.
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }

  const localData = Buffer.concat(localParts);
  const centralData = Buffer.concat(centralParts);
  if (entries.length > 0xffff || localData.length > 0xffffffff || centralData.length > 0xffffffff) throw new Error('ZIP64 archives are not supported.');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(localData.length, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([localData, centralData, end]);
}

function parseZip(archive, options = {}) {
  const bytes = Buffer.isBuffer(archive) ? archive : Buffer.from(archive);
  const maxFiles = options.maxFiles ?? 500;
  const maxFileBytes = options.maxFileBytes ?? 5 * 1024 * 1024;
  const maxTotalBytes = options.maxTotalBytes ?? 100 * 1024 * 1024;
  if (bytes.length < 22) throw new Error('Invalid ZIP archive: file is too small.');

  const firstEnd = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= firstEnd; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Invalid ZIP archive: end-of-directory record not found.');
  const disk = bytes.readUInt16LE(eocd + 4);
  const centralDisk = bytes.readUInt16LE(eocd + 6);
  const diskEntries = bytes.readUInt16LE(eocd + 8);
  const count = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  const commentLength = bytes.readUInt16LE(eocd + 20);
  if (disk || centralDisk || diskEntries !== count || count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error('Multi-disk and ZIP64 archives are not supported.');
  if (count > maxFiles) throw new Error(`Archive has more than ${maxFiles} entries.`);
  if (eocd + 22 + commentLength !== bytes.length || centralOffset + centralSize > eocd) throw new Error('Invalid ZIP archive directory bounds.');

  const files = [];
  const paths = new Set();
  let totalBytes = 0;
  let cursor = centralOffset;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > centralOffset + centralSize || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP archive central directory.');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const checksum = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const fileCommentLength = bytes.readUInt16LE(cursor + 32);
    const diskStart = bytes.readUInt16LE(cursor + 34);
    const externalAttr = bytes.readUInt32LE(cursor + 38);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + fileCommentLength;
    if (next > centralOffset + centralSize) throw new Error('Invalid ZIP archive entry bounds.');
    if (diskStart !== 0 || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) throw new Error('Multi-disk and ZIP64 entries are not supported.');
    if (flags & 0x0001) throw new Error('Encrypted ZIP archives are not supported.');
    if (flags & ~(0x0800 | 0x0008 | 0x0006)) throw new Error('ZIP archive uses unsupported flags.');
    if (method !== 0 && method !== 8) throw new Error(`ZIP compression method ${method} is not supported.`);
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (!rawName || rawName.includes('\0')) throw new Error('ZIP archive contains an invalid path.');
    const isDirectory = rawName.endsWith('/');
    const name = rawName.replace(/\\/g, '/');
    const safeName = isDirectory ? name.slice(0, -1) : name;
    if (!safeName || safeName.startsWith('/') || /^[a-z]:/i.test(safeName) || safeName.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`ZIP archive contains an unsafe path: ${rawName}`);
    // Unix mode information is stored in the high 16 bits. Reject symlinks and special files.
    const unixMode = externalAttr >>> 16;
    const fileType = unixMode & 0o170000;
    if (fileType && ![0o100000, 0o040000].includes(fileType)) throw new Error(`Special files are not allowed in ZIP archives: ${rawName}`);
    cursor = next;
    if (isDirectory) continue; // Directories are implicit.
    if (paths.has(name)) throw new Error(`ZIP archive has duplicate path: ${name}`);
    paths.add(name);
    if (uncompressedSize > maxFileBytes) throw new Error(`ZIP entry exceeds the ${maxFileBytes} byte file limit: ${name}`);
    totalBytes += uncompressedSize;
    if (totalBytes > maxTotalBytes) throw new Error('ZIP archive expands beyond the project size limit.');
    if (localOffset + 30 > centralOffset || bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid ZIP archive local file header.');
    const localFlags = bytes.readUInt16LE(localOffset + 6);
    const localMethod = bytes.readUInt16LE(localOffset + 8);
    if (localFlags !== flags || localMethod !== method) throw new Error('ZIP archive local and central headers disagree.');
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataStart < 0 || dataEnd > centralOffset || dataEnd < dataStart) throw new Error('Invalid ZIP archive compressed data bounds.');
    const localName = bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8');
    if (localName !== rawName) throw new Error('ZIP archive entry name mismatch.');
    const compressed = bytes.subarray(dataStart, dataEnd);
    let content;
    try { content = method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed, { maxOutputLength: maxFileBytes }); }
    catch { throw new Error(`ZIP entry could not be decompressed safely: ${name}`); }
    if (content.length !== uncompressedSize) throw new Error(`ZIP entry size mismatch: ${name}`);
    if (crc32(content) !== checksum) throw new Error(`ZIP entry checksum mismatch: ${name}`);
    files.push({ name, data: content });
  }
  if (cursor !== centralOffset + centralSize) throw new Error('ZIP archive has unexpected central directory data.');
  return files;
}

module.exports = { crc32, makeZip, parseZip };
