'use strict';
const PREFIX = 'releases/cartonLleno/voices';
const CATALOG_PATH = `${PREFIX}/catalog.json`;
const voiceIdPattern = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error('invalid_voice_catalog');
}
function validateVoice(v) {
  exact(v, ['id', 'name', 'label', 'version', 'language', 'gender', 'clips', 'size', 'bytes', 'sha256', 'filename', 'generation', 'downloadEndpoint']);
  if (typeof v.id !== 'string' || !voiceIdPattern.test(v.id) || typeof v.label !== 'string' ||
    !v.label.trim() || v.label.length > 160 || v.name !== v.label ||
    typeof v.version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v.version) ||
    (v.language !== null && (typeof v.language !== 'string' || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(v.language) || v.language.length > 64)) ||
    typeof v.gender !== 'string' || !v.gender.length || v.gender.length > 24 ||
    !Number.isSafeInteger(v.clips) || v.clips < 1 || v.clips > 100000 ||
    !Number.isSafeInteger(v.size) || v.size < 1 || v.size > 512 * 1024 ** 2 || v.bytes !== v.size ||
    typeof v.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(v.sha256) ||
    typeof v.filename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,155}\.zip$/.test(v.filename) ||
    typeof v.generation !== 'string' || !/^[1-9]\d{0,24}$/.test(v.generation) ||
    v.downloadEndpoint !== `/api/v1/apps/cartonLleno/voices/${v.id}/download`) throw new Error('invalid_voice');
  return v;
}
function validateCatalog(c) {
  exact(c, ['schemaVersion', 'app', 'updatedAt', 'voces']);
  if (c.schemaVersion !== 1 || c.app !== 'cartonLleno' || typeof c.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(c.updatedAt)) || new Date(c.updatedAt).toISOString() !== c.updatedAt ||
    !Array.isArray(c.voces) || !c.voces.length || c.voces.length > 100 ||
    Buffer.byteLength(JSON.stringify(c), 'utf8') > 65536) throw new Error('invalid_voice_catalog');
  const ids = new Set();
  for (const v of c.voces) {
    validateVoice(v);
    if (ids.has(v.id)) throw new Error('duplicate_voice');
    ids.add(v.id);
  }
  return c;
}
function voiceObjectPath(v) { return `${PREFIX}/${v.id}/${v.sha256}.zip`; }
module.exports = { CATALOG_PATH, voiceIdPattern, validateVoice, validateCatalog, voiceObjectPath };
