import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudAdapter, hashFile } from './publish-release.mjs';
import { inspectVoiceZip } from './voice-zip.mjs';
import { CATALOG_PATH, validateCatalog, validateVoice, voiceObjectPath } from '../functions/voices-contract.cjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
class VoicePublicationError extends Error {}
function fail(message) { throw new VoicePublicationError(message); }
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail('Invalid voice publication input');
}
function catalogRecord(voice, generation) {
  const { localPath, ...entry } = voice;
  void localPath;
  return { ...entry, generation };
}
function sameVoice(voice, stored) {
  return stored && Object.entries(catalogRecord(voice, stored.generation)).every(([key, value]) => stored[key] === value);
}

export async function prepareVoices(input, directory) {
  exact(input, ['schemaVersion', 'app', 'updatedAt', 'expectedCatalogSha256', 'voces']);
  if (input.schemaVersion !== 1 || input.app !== 'cartonLleno' ||
    !(input.expectedCatalogSha256 === null || (typeof input.expectedCatalogSha256 === 'string' && /^[a-f0-9]{64}$/.test(input.expectedCatalogSha256))) ||
    !Array.isArray(input.voces) || !input.voces.length) fail('Invalid voice publication input');
  const root = await realpath(directory), voices = [];
  for (const entry of input.voces) {
    exact(entry, ['id', 'label', 'gender', 'clips', 'version', 'language', 'size', 'sha256', 'filename', 'path']);
    if (typeof entry.path !== 'string' || path.isAbsolute(entry.path)) fail('Voice path must be relative to input directory');
    const localPath = await realpath(path.resolve(root, entry.path));
    if (!localPath.startsWith(root + path.sep)) fail('Voice path escapes input directory');
    const { path: source, ...fields } = entry;
    void source;
    const voice = { ...fields, name: entry.label, bytes: entry.size, localPath,
      downloadEndpoint: `/api/v1/apps/cartonLleno/voices/${entry.id}/download` };
    validateVoice(catalogRecord(voice, '1'));
    const info = await stat(localPath);
    if (!info.isFile() || info.size !== entry.size || await hashFile(localPath) !== entry.sha256) fail('Local voice SHA256/size mismatch');
    await inspectVoiceZip(localPath, voice);
    voices.push(voice);
  }
  validateCatalog({ schemaVersion: 1, app: 'cartonLleno', updatedAt: input.updatedAt, voces: voices.map(v => catalogRecord(v, '1')) });
  return { updatedAt: input.updatedAt, expectedCatalogSha256: input.expectedCatalogSha256, voces: voices };
}

export async function publishVoices(plan, { mode, storage } = {}) {
  if (!['dry-run', 'verify', 'publish'].includes(mode)) fail('Invalid voice publication mode');
  if (mode === 'dry-run') return { mode, writes: false, catalog: CATALOG_PATH, expectedCatalogSha256: plan.expectedCatalogSha256,
    voces: plan.voces.map(v => ({ ...catalogRecord(v, null), object: voiceObjectPath(v) })) };
  await storage.assertPrivate();
  const old = await storage.read(CATALOG_PATH);
  let previous;
  if (old) {
    if (sha(old.bytes) !== old.sha256) fail('Existing voice catalog hash mismatch');
    previous = validateCatalog(JSON.parse(old.bytes));
  }
  const changed = plan.voces.some(v => !sameVoice(v, previous?.voces.find(p => p.id === v.id)));
  if (mode === 'verify' && changed) fail('Voice catalog does not identify the requested packages');
  if (changed && (old?.sha256 ?? null) !== plan.expectedCatalogSha256) fail('Catalog changed since preparation; refresh expectedCatalogSha256');
  if (changed && previous && Date.parse(plan.updatedAt) <= Date.parse(previous.updatedAt)) fail('Changed catalog updatedAt must advance');
  for (const voice of plan.voces) {
    const prior = previous?.voces.find(v => v.id === voice.id);
    if (prior?.version === voice.version && prior.sha256 !== voice.sha256) fail('Voice version reused with different ZIP bytes; publish a new voice version');
  }
  const entries = new Map(previous?.voces.map(v => [v.id, v]) ?? []);
  const preview = new Map(entries);
  for (const voice of plan.voces) preview.set(voice.id, catalogRecord(voice, '1'));
  validateCatalog({ schemaVersion: 1, app: 'cartonLleno', updatedAt: plan.updatedAt, voces: [...preview.values()] });
  for (const voice of plan.voces) {
    const object = voiceObjectPath(voice);
    let stored = await storage.readMetadata(object);
    if (!stored) {
      if (mode === 'verify') fail('Private voice ZIP missing');
      if (await hashFile(voice.localPath) !== voice.sha256) fail('Local voice changed before upload');
      await storage.uploadVoice(object, voice);
      stored = await storage.readMetadata(object);
    }
    if (!stored || stored.size !== voice.size || stored.sha256 !== voice.sha256 ||
      await storage.hash(object, stored.generation) !== voice.sha256) fail('Remote voice SHA256/size mismatch');
    const entry = catalogRecord(voice, stored.generation);
    if (!changed && !sameVoice(voice, previous.voces.find(v => v.id === voice.id))) fail('Catalog metadata mismatch');
    if (!changed && previous.voces.find(v => v.id === voice.id).generation !== stored.generation) fail('Voice generation changed');
    entries.set(voice.id, entry);
  }
  const catalog = changed ? { schemaVersion: 1, app: 'cartonLleno', updatedAt: plan.updatedAt,
    voces: [...entries.values()].sort((a, b) => a.id.localeCompare(b.id)) } : previous;
  validateCatalog(catalog);
  const bytes = changed ? jsonBytes(catalog) : old.bytes;
  if (bytes.length > 65536) fail('Voice catalog exceeds 64 KiB');
  if (changed) {
    // Only this catalog is mutable. ZIPs use content-addressed names and create-only writes.
    try { await storage.write(CATALOG_PATH, bytes, old?.generation ?? 0); }
    catch { fail('Catalog write failed: concurrent publication or missing scoped catalog-replacement IAM; no ZIP was overwritten'); }
  }
  const checked = await storage.read(CATALOG_PATH);
  if (!checked || !checked.bytes.equals(bytes) || checked.sha256 !== sha(bytes)) fail('Published voice catalog verification failed');
  return { mode, verified: true, changed, catalog: CATALOG_PATH, catalogSha256: checked.sha256,
    catalogGeneration: checked.generation, voces: validateCatalog(JSON.parse(checked.bytes)).voces };
}

export async function main(args) {
  const [flag, inputPath, bucketName, ...extra] = args;
  const mode = flag?.replace(/^--/, '');
  if (!['dry-run', 'verify', 'publish'].includes(mode) || !inputPath || extra.length ||
    (mode !== 'dry-run' && bucketName !== 'nova-star-bd0d9-nexo-releases')) fail('Usage: node tools/publish-voices.mjs --dry-run|--verify|--publish input.json [nova-star-bd0d9-nexo-releases]');
  const plan = await prepareVoices(JSON.parse(await readFile(inputPath, 'utf8')), path.dirname(path.resolve(inputPath)));
  const result = await publishVoices(plan, { mode, storage: mode === 'dry-run' ? undefined : await cloudAdapter(bucketName) });
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    // Never print provider exceptions (may include signed URLs or credentials).
    console.error(error instanceof VoicePublicationError ? error.message : 'Voice publication stopped: input, ZIP, integrity or provider failure. No GitHub changes were made.');
    process.exitCode = 1;
  });
}
