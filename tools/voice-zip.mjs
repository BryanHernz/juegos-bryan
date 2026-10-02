import { open } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

function reject() { throw new Error('Invalid voice ZIP/index; expected a flat ZIP32 package matching catalog metadata'); }
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Read only the central directory and bounded index, never extract or rebuild
// the archive. Reject encrypted/ZIP64/nested packages and zip-slip paths.
export async function inspectVoiceZip(filePath, expected) {
  const file = await open(filePath, 'r');
  try {
    const size = (await file.stat()).size;
    async function read(offset, length) {
      if (offset < 0 || length < 0 || offset + length > size) reject();
      const bytes = Buffer.alloc(length);
      const { bytesRead } = await file.read(bytes, 0, length, offset);
      if (bytesRead !== length) reject();
      return bytes;
    }
    const tail = await read(Math.max(0, size - 65557), Math.min(size, 65557));
    const end = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (end < 0 || end + 22 > tail.length || end + 22 + tail.readUInt16LE(end + 20) !== tail.length ||
      tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6)) reject();
    const count = tail.readUInt16LE(end + 10), directorySize = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
    if (!count || count === 65535 || tail.readUInt16LE(end + 8) !== count || directorySize > 8 * 1024 ** 2 ||
      offset + directorySize !== size - tail.length + end) reject();
    const directory = await read(offset, directorySize), entries = new Map();
    let cursor = 0;
    for (let n = 0; n < count; n++) {
      if (cursor + 46 > directory.length || directory.readUInt32LE(cursor) !== 0x02014b50) reject();
      const flags = directory.readUInt16LE(cursor + 8), method = directory.readUInt16LE(cursor + 10);
      const nameLength = directory.readUInt16LE(cursor + 28);
      const next = cursor + 46 + nameLength + directory.readUInt16LE(cursor + 30) + directory.readUInt16LE(cursor + 32);
      if (next > directory.length || flags & 1 || ![0, 8].includes(method) || directory.readUInt16LE(cursor + 34)) reject();
      const name = directory.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(name) || entries.has(name)) reject();
      entries.set(name, { method, crc: directory.readUInt32LE(cursor + 16), compressed: directory.readUInt32LE(cursor + 20),
        size: directory.readUInt32LE(cursor + 24), offset: directory.readUInt32LE(cursor + 42) });
      cursor = next;
    }
    if (cursor !== directory.length) reject();
    const entry = entries.get('index.json');
    if (!entry || entry.size > 65536 || entry.compressed > 131072 || entry.offset + 30 > offset) reject();
    const local = await read(entry.offset, 30);
    if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(8) !== entry.method || local.readUInt16LE(6) & 1) reject();
    const nameLength = local.readUInt16LE(26), extraLength = local.readUInt16LE(28);
    if ((await read(entry.offset + 30, nameLength)).toString('utf8') !== 'index.json') reject();
    const dataOffset = entry.offset + 30 + nameLength + extraLength;
    if (dataOffset + entry.compressed > offset) reject();
    const compressed = await read(dataOffset, entry.compressed);
    const bytes = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: 65536 });
    if (bytes.length !== entry.size || crc32(bytes) !== entry.crc) reject();
    const index = JSON.parse(bytes.toString('utf8')), voice = index.voices?.[0];
    if (!voice || index.voices.length !== 1 || voice.id !== expected.id || voice.label !== expected.label ||
      voice.gender !== expected.gender || (voice.language ?? null) !== expected.language || index.paquete !== expected.version ||
      !Array.isArray(index.clips) || index.clips.length !== expected.clips) reject();
    const names = new Set(['index.json']);
    for (const clip of index.clips) {
      if (typeof clip !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(clip) || names.has(`${clip}.mp3`)) reject();
      names.add(`${clip}.mp3`);
    }
    if (names.size !== entries.size || [...names].some(name => !entries.has(name))) reject();
    return { clips: index.clips.length, language: voice.language ?? null, version: index.paquete };
  } finally { await file.close(); }
}
