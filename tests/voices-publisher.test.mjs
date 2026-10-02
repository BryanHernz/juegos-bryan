import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareVoices, publishVoices } from '../tools/publish-voices.mjs';
import { CATALOG_PATH, voiceObjectPath } from '../functions/voices-contract.cjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// Small valid ZIP32 packages made with Python zipfile; test audio is never published.
const packages = [
  'UEsDBBQAAAAAACZpQl3h3Vi9fwAAAH8AAAAKAAAAaW5kZXguanNvbnsidmVyc2lvbiI6IDIsICJ2b2ljZXMiOiBbeyJpZCI6ICJ2b2ljZS10ZXN0IiwgImxhYmVsIjogIlZveiBkZSBwcnVlYmEiLCAiZ2VuZGVyIjogIkYifV0sICJjbGlwcyI6IFsiY2xpcDAxIl0sICJwYXF1ZXRlIjogInYxIn1QSwMEFAAAAAAAJmlCXdrHYxEPAAAADwAAAAoAAABjbGlwMDEubXAzdGVzdC1vbmx5LWF1ZGlvUEsBAhQAFAAAAAAAJmlCXeHdWL1/AAAAfwAAAAoAAAAAAAAAAAAAAIABAAAAAGluZGV4Lmpzb25QSwECFAAUAAAAAAAmaUJd2sdjEQ8AAAAPAAAACgAAAAAAAAAAAAAAgAGnAAAAY2xpcDAxLm1wM1BLBQYAAAAAAgACAHAAAADeAAAAAAA=',
  'UEsDBBQAAAAAACZpQl24Yx6/fwAAAH8AAAAKAAAAaW5kZXguanNvbnsidmVyc2lvbiI6IDIsICJ2b2ljZXMiOiBbeyJpZCI6ICJ2b2ljZS10ZXN0IiwgImxhYmVsIjogIlZveiBkZSBwcnVlYmEiLCAiZ2VuZGVyIjogIkYifV0sICJjbGlwcyI6IFsiY2xpcDAxIl0sICJwYXF1ZXRlIjogInYyIn1QSwMEFAAAAAAAJmlCXdrHYxEPAAAADwAAAAoAAABjbGlwMDEubXAzdGVzdC1vbmx5LWF1ZGlvUEsBAhQAFAAAAAAAJmlCXbhjHr9/AAAAfwAAAAoAAAAAAAAAAAAAAIABAAAAAGluZGV4Lmpzb25QSwECFAAUAAAAAAAmaUJd2sdjEQ8AAAAPAAAACgAAAAAAAAAAAAAAgAGnAAAAY2xpcDAxLm1wM1BLBQYAAAAAAgACAHAAAADeAAAAAAA=',
].map(value => Buffer.from(value, 'base64'));

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'nexo-voice-test-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('nexo-voice-test-'));
    await rm(directory, { recursive: true, force: true });
  });
  await writeFile(path.join(directory, 'voice.zip'), packages[0]);
  const input = { schemaVersion: 1, app: 'cartonLleno', updatedAt: '2026-10-02T00:00:00.000Z', expectedCatalogSha256: null,
    voces: [{ id: 'voice-test', label: 'Voz de prueba', gender: 'F', language: null, clips: 1, version: 'v1',
      size: packages[0].length, sha256: sha(packages[0]), filename: 'voice-test.zip', path: 'voice.zip' }] };
  const plan = await prepareVoices(input, directory), rows = new Map();
  let sequence = 10, uploads = 0, writes = 0;
  const storage = {
    assertPrivate: async () => {}, read: async key => rows.get(key) ?? null,
    readMetadata: async key => rows.get(key) ?? null, hash: async key => sha(rows.get(key).bytes),
    uploadVoice: async (key, voice) => {
      assert.ok(!rows.has(key), 'create-only');
      const bytes = await readFile(voice.localPath);
      rows.set(key, { bytes, size: bytes.length, generation: String(++sequence), sha256: sha(bytes) }); uploads++;
    },
    write: async (key, bytes, generation) => {
      assert.equal(rows.get(key)?.generation ?? 0, generation, 'catalog CAS');
      rows.set(key, { bytes, size: bytes.length, generation: String(++sequence), sha256: sha(bytes) }); writes++;
    },
  };
  return { directory, input, plan, rows, storage, uploads: () => uploads, writes: () => writes };
}

test('voice dry-run reads local hashes/index but never calls providers or writes', async t => {
  const f = await fixture(t);
  const result = await publishVoices(f.plan, { mode: 'dry-run' });
  assert.equal(result.writes, false);
  assert.equal(result.voces[0].object, voiceObjectPath(f.plan.voces[0]));
  assert.equal(result.voces[0].version, 'v1');
  assert.equal(result.voces[0].generation, null);
  assert.equal(f.writes(), 0);
});
test('voice publish is immutable/idempotent; verify does no writes; app latest untouched', async t => {
  const f = await fixture(t), options = { mode: 'publish', storage: f.storage };
  const first = await publishVoices(f.plan, options);
  assert.equal(first.changed, true);
  assert.equal(first.voces[0].label, 'Voz de prueba');
  assert.equal(first.voces[0].bytes, packages[0].length);
  assert.equal(first.voces[0].generation, '11');
  assert.equal((await publishVoices(f.plan, options)).changed, false);
  await publishVoices(f.plan, { ...options, mode: 'verify' });
  assert.equal(f.uploads(), 1); assert.equal(f.writes(), 1);
  assert.ok([...f.rows.keys()].every(key => key.startsWith('releases/cartonLleno/voices/')));
  assert.doesNotMatch(f.rows.get(CATALOG_PATH).bytes.toString(), /signedUrl|X-Goog-Signature|github\.com/);
});
test('new voice version replaces only its catalog entry with generation CAS; old ZIP retained', async t => {
  const f = await fixture(t);
  const first = await publishVoices(f.plan, { mode: 'publish', storage: f.storage });
  await writeFile(path.join(f.directory, 'voice.zip'), packages[1]);
  f.input.expectedCatalogSha256 = first.catalogSha256;
  f.input.updatedAt = '2026-10-03T00:00:00.000Z';
  Object.assign(f.input.voces[0], { version: 'v2', size: packages[1].length, sha256: sha(packages[1]) });
  const updated = await prepareVoices(f.input, f.directory);
  const result = await publishVoices(updated, { mode: 'publish', storage: f.storage });
  assert.equal(result.voces[0].version, 'v2');
  assert.equal(f.uploads(), 2); assert.equal(f.writes(), 2);
  assert.ok(f.rows.has(voiceObjectPath(f.plan.voces[0])));
  await assert.rejects(publishVoices(f.plan, { mode: 'publish', storage: f.storage }), /Catalog changed/);
});
test('remote SHA mismatch and absent private artifacts/catalog fail without catalog writes', async t => {
  const f = await fixture(t);
  await assert.rejects(publishVoices(f.plan, { mode: 'verify', storage: f.storage }), /catalog/);
  f.storage.hash = async () => 'b'.repeat(64);
  await assert.rejects(publishVoices(f.plan, { mode: 'publish', storage: f.storage }), /Remote voice/);
  assert.equal(f.writes(), 0);
});
test('rejects mismatched local bytes, index version/id, non-ZIP and paths escaping input', async t => {
  const f = await fixture(t);
  const bad = structuredClone(f.input); bad.voces[0].sha256 = 'b'.repeat(64);
  await assert.rejects(prepareVoices(bad, f.directory), /SHA256/);
  for (const field of ['id', 'version', 'label', 'clips']) {
    const wrong = structuredClone(f.input); wrong.voces[0][field] = field === 'clips' ? 2 : 'different';
    await assert.rejects(prepareVoices(wrong, f.directory), /ZIP/);
  }
  const escape = structuredClone(f.input); escape.voces[0].path = path.join(f.directory, 'voice.zip');
  await assert.rejects(prepareVoices(escape, f.directory), /relative/);
  await writeFile(path.join(f.directory, 'voice.zip'), Buffer.from('not a ZIP'));
  const invalidZip = structuredClone(f.input);
  invalidZip.voces[0].size = 9; invalidZip.voces[0].sha256 = sha(Buffer.from('not a ZIP'));
  await assert.rejects(prepareVoices(invalidZip, f.directory), /ZIP/);
});
test('catalog CAS failure leaves immutable ZIPs safe and exposes no provider details', async t => {
  const f = await fixture(t);
  f.storage.write = async () => { throw new Error('private-provider-credentials'); };
  await assert.rejects(publishVoices(f.plan, { mode: 'publish', storage: f.storage }), error =>
    /Catalog write failed/.test(error.message) && !error.message.includes('credentials'));
  assert.equal(f.rows.has(CATALOG_PATH), false);
  assert.equal(f.uploads(), 1);
});
test('unsafe catalog data and a bucket without enforced privacy cannot publish', async t => {
  const f = await fixture(t), bad = structuredClone(f.input);
  bad.voces[0].signedUrl = 'https://not-allowed.test';
  await assert.rejects(prepareVoices(bad, f.directory), /Invalid/);
  f.storage.assertPrivate = async () => { throw new Error('must enforce PAP/UBLA'); };
  await assert.rejects(publishVoices(f.plan, { mode: 'publish', storage: f.storage }), /PAP\/UBLA/);
  assert.equal(f.uploads(), 0);
});
test('voice CLI dry-run works offline, independent of GitHub and app releases', async t => {
  const f = await fixture(t), input = path.join(f.directory, 'input.json');
  await writeFile(input, JSON.stringify(f.input));
  const { stdout } = await promisify(execFile)(process.execPath, ['tools/publish-voices.mjs', '--dry-run', input]);
  assert.equal(JSON.parse(stdout).writes, false);
});
