import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hashFile, prepare, publish, githubAdapter } from '../tools/publish-release.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'nexo-publisher-test-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('nexo-publisher-test-'));
    await rm(directory, { recursive: true, force: true });
  });
  const data = { app: 'novaStar', version: '1.0.28', build: 29, notes: 'Test only', recommendations: { windows: 'novaStar-1.0.28-installer', phone: 'novaStar-1.0.28-phone', tv: 'novaStar-1.0.28-tv' },
    releasedAt: '2026-10-01T00:00:00.000Z', assets: [], compatibility: [] };
  const files = ['NovaStar-installer.exe', 'NovaStar-telefono.apk', 'NovaStar-tele.apk', 'version.json', 'NovaStar-updater.zip'];
  for (const [i, fileName] of files.entries()) {
    const bytes = Buffer.from(`Synthetic test bytes ${i}`); await writeFile(path.join(directory, fileName), bytes);
    const entry = { path: fileName, fileName, sha256: sha(bytes) };
    if (i < 3 || i === 4) {
      const id = `novaStar-1.0.28-${['installer', 'phone', 'tv', '', 'updater'][i]}`;
      data.assets.push({ path: entry.path, filename: entry.fileName, sha256: entry.sha256, id,
        platform: i === 0 || i === 4 ? 'windows' : 'android', purpose: i === 0 ? 'installer' : i === 4 ? 'updater' : 'package',
        variant: i === 0 || i === 4 ? 'standard' : i === 1 ? 'phone' : 'tv',
        architecture: 'universal', versionCode: i === 0 || i === 4 ? null : 29, format: i === 0 ? 'exe' : i === 4 ? 'zip' : 'apk' });
    }
    else data.compatibility.push(entry);
  }
  const plan = await prepare(data, directory), rows = new Map();
  let sequence = 100, writes = 0, githubCalls = 0;
  const storage = {
    assertPrivate: async () => {},
    read: async key => rows.get(key) ?? null,
    readMetadata: async key => rows.get(key) ?? null,
    hash: async key => sha(rows.get(key).bytes),
    upload: async (key, asset) => {
      if (rows.has(key)) throw new Error('precondition');
      const bytes = await import('node:fs/promises').then(fs => fs.readFile(asset.localPath));
      rows.set(key, { bytes, generation: String(++sequence), size: bytes.length, sha256: sha(bytes) }); writes++;
    },
    write: async (key, bytes, generation) => {
      if ((rows.get(key)?.generation ?? 0) !== generation) throw new Error('precondition');
      rows.set(key, { bytes, generation: String(++sequence), sha256: sha(bytes) }); writes++;
    },
  };
  const github = { ensure: async () => { githubCalls++; } };
  return { plan, data, directory, rows, storage, github,
    writes: () => writes, githubCalls: () => githubCalls };
}
test('dry-run hashes input but makes no provider calls/writes', async t => {
  const f = await fixture(t), result = await publish(f.plan, { mode: 'dry-run' });
  assert.equal(result.writes, false); assert.equal(result.artifacts.length, 4); assert.equal(f.writes(), 0);
  assert.deepEqual(result.compatibility, ['version.json']);
});

test('import-existing verifies public GitHub read-only and archives support files idempotently', async t => {
  const f = await fixture(t), calls = [];
  const github = { ensure: async (_, mode) => calls.push(mode), activate: async () => { throw new Error('GitHub mutation forbidden'); } };
  const options = { mode: 'import-existing', storage: f.storage, github };
  const result = await publish(f.plan, options);
  assert.equal(result.supportArtifacts, 1);
  assert.deepEqual(calls, ['verify']);
  assert.equal([...f.rows.keys()].filter(k => k.includes('/support/')).length, 1);
  const writes = f.writes(); await publish(f.plan, options); assert.equal(f.writes(), writes);
});
test('the real CLI dry-run works offline with the input contract', async t => {
  const f = await fixture(t), input = path.join(f.directory, 'input.json');
  await writeFile(input, JSON.stringify(f.data));
  const { stdout } = await promisify(execFile)(process.execPath, ['tools/publish-release.mjs', '--dry-run', input]);
  const result = JSON.parse(stdout);
  assert.equal(result.mode, 'dry-run'); assert.equal(result.writes, false);
  assert.equal(result.artifacts.length, 4);
});
test('publish is immutable/idempotent and verify is read-only, with exact bytes and latest', async t => {
  const f = await fixture(t), options = { storage: f.storage, github: f.github, mode: 'publish' };
  assert.equal((await publish(f.plan, options)).verified, true);
  const writes = f.writes(); await publish(f.plan, options); assert.equal(f.writes(), writes);
  assert.equal((await publish(f.plan, { ...options, mode: 'verify' })).verified, true); assert.equal(f.writes(), writes);
  const manifest = JSON.parse(f.rows.get('releases/novaStar/1.0.28/manifest.json').bytes);
  assert.doesNotMatch(JSON.stringify(manifest), /signedUrl|https:|localPath/);
  for (const asset of manifest.assets) assert.equal(asset.sha256, await hashFile(f.plan.assets.find(a => a.id === asset.id).localPath));
});

test('private publication and verification never call GitHub and reuse generations/latest', async t => {
  const f = await fixture(t);
  const github = { ensure: async () => { throw new Error('GitHub forbidden'); },
    activate: async () => { throw new Error('GitHub forbidden'); } };
  const options = { storage: f.storage, github, mode: 'publish-private' };
  assert.equal((await publish(f.plan, options)).verified, true);
  const writes = f.writes(), latest = f.rows.get('releases/novaStar/latest.json');
  await publish(f.plan, options);
  await publish(f.plan, { ...options, mode: 'verify-private' });
  assert.equal(f.writes(), writes);
  assert.equal(f.rows.get('releases/novaStar/latest.json'), latest);
  assert.ok([...f.rows.keys()].every(key => key.startsWith('releases/novaStar/')));
});

test('private verification never writes missing objects and publication checks integrity/CAS', async t => {
  const f = await fixture(t), options = { storage: f.storage, mode: 'verify-private' };
  await assert.rejects(publish(f.plan, options), /missing/);
  assert.equal(f.writes(), 0);
  const write = f.storage.write;
  f.storage.write = async (key, ...args) => {
    if (key.endsWith('latest.json')) f.rows.set(key, { generation: '999', bytes: Buffer.from('{}') });
    return write(key, ...args);
  };
  await assert.rejects(publish(f.plan, { ...options, mode: 'publish-private' }), /precondition/);
  assert.equal(f.rows.get('releases/novaStar/latest.json').generation, '999');
});
test('hash mismatch, missing updater compatibility, duplicate platforms and private bucket failure abort', async t => {
  const f = await fixture(t);
  await assert.rejects(prepare({ ...f.data, assets: f.data.assets.map(a => ({ ...a, sha256: '0'.repeat(64) })) }, f.directory), /mismatch/);
  await assert.rejects(prepare({ ...f.data, compatibility: [] }, f.directory), /version.json/);
  await assert.rejects(prepare({ ...f.data, assets: f.data.assets.map(a => ({ ...a, platform: 'windows' })) }, f.directory), /invalid/);
  f.storage.assertPrivate = async () => { throw new Error('public bucket'); };
  await assert.rejects(publish(f.plan, { storage: f.storage, github: f.github, mode: 'publish' }), /public bucket/);
  assert.equal(f.githubCalls(), 0); assert.equal(f.writes(), 0);
});
test('remote byte mismatch never publishes manifest/latest', async t => {
  const f = await fixture(t); f.storage.hash = async () => '0'.repeat(64);
  await assert.rejects(publish(f.plan, { storage: f.storage, github: f.github, mode: 'publish' }), /mismatch/);
  assert.equal([...f.rows.keys()].some(k => k.endsWith('manifest.json') || k.endsWith('latest.json')), false);
});
test('interrupted publication can resume; latest CAS rejects concurrent writers/downgrades', async t => {
  const f = await fixture(t), original = f.storage.write;
  f.storage.write = async (key, ...args) => { if (key.endsWith('latest.json')) throw new Error('interrupted'); return original(key, ...args); };
  const options = { storage: f.storage, github: f.github, mode: 'publish' };
  await assert.rejects(publish(f.plan, options), /interrupted/);
  f.storage.write = original; assert.equal((await publish(f.plan, options)).verified, true);
  const older = { ...f.plan, version: '1.0.27' }; await assert.rejects(publish(older, options), /downgrade/);
  f.rows.delete('releases/novaStar/latest.json');
  f.storage.write = async (key, ...args) => {
    if (key.endsWith('latest.json')) f.rows.set(key, { generation: '999', bytes: Buffer.from('{}') });
    return original(key, ...args);
  };
  await assert.rejects(publish(f.plan, options), /precondition/);
});
test('GitHub authentication failure does not create a release or overwrite assets', async t => {
  const f = await fixture(t), commands = [];
  const adapter = githubAdapter(async args => { commands.push(args); throw Object.assign(new Error('failed'), { stderr: 'HTTP 401' }); });
  await assert.rejects(adapter.ensure(f.plan, 'publish'));
  assert.equal(commands.length, 1); assert.equal(commands[0][0], 'api');
});
test('GitHub prepares a draft, preserves alias names and activates only after private latest verification', async t => {
  const f = await fixture(t), commands = [], uploaded = [];
  let release, latest = { tag_name: 'v1.0.27' };
  const original = f.plan.assets[0];
  const native = path.join(f.directory, 'compiled-native.exe');
  await writeFile(native, await readFile(original.localPath)); original.localPath = native;
  const adapter = githubAdapter(async args => {
    commands.push(args);
    if (args[0] === 'api') {
      if (args[1].endsWith('/latest')) return { stdout: JSON.stringify(latest) };
      if (args[1].includes('/assets?')) return { stdout: JSON.stringify(uploaded) };
      if (!release) throw Object.assign(new Error('not found'), { stderr: 'HTTP 404' });
      return { stdout: JSON.stringify(release) };
    }
    if (args[1] === 'create') {
      assert.ok(args.includes('--draft'));
      release = { id: 100, tag_name: 'v1.0.28', draft: true, prerelease: false };
    }
    if (args[1] === 'upload') {
      assert.ok(release.draft); assert.ok(!args.includes('--clobber'));
      const name = path.basename(args[3]), bytes = await readFile(args[3]);
      const expected = [...f.plan.assets, ...f.plan.compatibility].find(a => (a.filename ?? a.fileName) === name);
      assert.ok(expected); assert.equal(sha(bytes), expected.sha256);
      uploaded.push({ name, size: bytes.length, state: 'uploaded' });
    }
    if (args[1] === 'download') {
      const name = args[args.indexOf('--pattern') + 1], directory = args[args.indexOf('--dir') + 1];
      const expected = [...f.plan.assets, ...f.plan.compatibility].find(a => (a.filename ?? a.fileName) === name);
      await writeFile(path.join(directory, name), await readFile(expected.localPath));
    }
    if (args[1] === 'edit') {
      assert.ok(f.rows.has('releases/novaStar/latest.json'));
      assert.ok(args.includes('--latest')); release.draft = false; latest = release;
    }
    return { stdout: '' };
  });
  const options = { storage: f.storage, github: adapter, mode: 'publish' };
  await publish(f.plan, options); assert.equal(release.draft, false); assert.equal(uploaded.length, 5);
  const writes = f.writes(); await publish(f.plan, { ...options, mode: 'verify' });
  assert.equal(f.writes(), writes); assert.equal(commands.filter(args => args[1] === 'edit').length, 1);
});
