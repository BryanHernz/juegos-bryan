import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
export async function inspectApk(file) {
  const zip = await readFile(file);
  let end = zip.length - 22;
  while (end >= Math.max(0, zip.length - 65557) && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || zip.readUInt32LE(end) !== 0x06054b50) throw new Error('Invalid ZIP');
  let offset = zip.readUInt32LE(end + 16), manifest;
  const architectures = new Set();
  for (let n = 0; n < zip.readUInt16LE(end + 10); n++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP directory');
    const nameLength = zip.readUInt16LE(offset + 28), extra = zip.readUInt16LE(offset + 30), comment = zip.readUInt16LE(offset + 32);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const abi = /^lib\/([^/]+)\/libflutter\.so$/.exec(name)?.[1];
    if (abi) architectures.add(abi);
    if (name === 'AndroidManifest.xml') {
      const local = zip.readUInt32LE(offset + 42), size = zip.readUInt32LE(offset + 20), method = zip.readUInt16LE(offset + 10);
      if (zip.readUInt32LE(offset + 24) > 1024 * 1024) throw new Error('Oversized manifest');
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const bytes = zip.subarray(start, start + size);
      manifest = method === 0 ? bytes : method === 8 ? inflateRawSync(bytes, { maxOutputLength: 1024 * 1024 }) : undefined;
    }
    offset += 46 + nameLength + extra + comment;
  }
  if (!manifest || manifest.readUInt16LE(0) !== 3) throw new Error('Invalid Android XML');
  let strings = [], position = manifest.readUInt16LE(2), result;
  while (position < manifest.length) {
    const type = manifest.readUInt16LE(position), header = manifest.readUInt16LE(position + 2), size = manifest.readUInt32LE(position + 4);
    if (size < 8 || position + size > manifest.length) throw new Error('Invalid XML chunk');
    if (type === 1) {
      const count = manifest.readUInt32LE(position + 8), utf8 = manifest.readUInt32LE(position + 16) & 0x100;
      const start = position + manifest.readUInt32LE(position + 20);
      strings = Array.from({ length: count }, (_, i) => {
        let p = start + manifest.readUInt32LE(position + header + i * 4);
        if (utf8) {
          p += manifest[p] & 0x80 ? 2 : 1;
          let length = manifest[p++]; if (length & 0x80) length = ((length & 0x7f) << 8) | manifest[p++];
          return manifest.subarray(p, p + length).toString('utf8');
        }
        let length = manifest.readUInt16LE(p); p += 2;
        if (length & 0x8000) { length = ((length & 0x7fff) << 16) | manifest.readUInt16LE(p); p += 2; }
        return manifest.subarray(p, p + length * 2).toString('utf16le');
      });
    } else if (type === 0x102 && strings[manifest.readUInt32LE(position + 20)] === 'manifest') {
      const start = position + 16 + manifest.readUInt16LE(position + 24), count = manifest.readUInt16LE(position + 28);
      const stride = manifest.readUInt16LE(position + 26), attributes = {};
      for (let i = 0; i < count; i++) {
        const at = start + i * stride, name = strings[manifest.readUInt32LE(at + 4)], kind = manifest[at + 15], data = manifest.readUInt32LE(at + 16);
        attributes[name] = kind === 3 ? strings[data] : data;
      }
      result = { versionName: attributes.versionName, versionCode: attributes.versionCode, architectures: [...architectures] };
    }
    position += size;
  }
  if (!result || typeof result.versionName !== 'string' || !Number.isSafeInteger(result.versionCode)) throw new Error('Missing APK version');
  return result;
}
