import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APPS as configuredApps } from '../config.mjs';
const APPS = JSON.parse(readFileSync(new URL('./fixtures/apps.json', import.meta.url), 'utf8'));
import { safeHttps, safeGithub, normalizeRelease, snapshotRelease, selectDownloads,
  fetchLatest, readCached, writeCached, formatBytes } from '../releases.mjs';
const nova = APPS[0], carton = APPS[1];
function rawRelease(app = nova) {
  return { ...app.snapshot, assets: snapshotRelease(app).assets.map(a => ({
    name: a.name, size: a.size, browser_download_url: a.url, state: 'uploaded'
  })) };
}
function memoryStorage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
test('las dos instantáneas tienen enlaces válidos del repositorio correcto', () => {
  for (const app of APPS) {
    const release = snapshotRelease(app);
    assert.ok(release.assets.length >= 6);
    assert.ok(release.assets.every(a => safeGithub(a.url, app.repo)));
  }
});
test('Nova no ofrece un instalador EXE inexistente', () => {
  const selected = selectDownloads(snapshotRelease(nova).assets);
  assert.equal(selected.windows, null);
  assert.match(selected.portable.name, /windows-x64.zip$/);
});
test('Cartón selecciona los nombres fijos de Windows y teléfono', () => {
  const selected = selectDownloads(snapshotRelease(carton).assets);
  assert.equal(selected.windows.name, 'CartonLleno-windows-instalador.exe');
  assert.equal(selected.phone.name, 'CartonLleno-telefono.apk');
  assert.equal(selected.tv.name, 'CartonLleno-tele.apk');
});
test('detecta el nombre del instalador nuevo de Nova', () => {
  const assets = [...snapshotRelease(nova).assets, { name: 'NovaStar-1.0.24-windows-installer.exe' }];
  assert.equal(selectDownloads(assets).windows.name, 'NovaStar-1.0.24-windows-installer.exe');
});
test('no confunde x86_64 Android con teléfono ARM64 ni con Windows', () => {
  const selected = selectDownloads([{ name: 'NovaStar-1.0.24-x86_64.apk' }]);
  assert.deepEqual(selected, { windows: null, phone: null, tv: null, portable: null });
});
test('rechaza otros dominios, credenciales y scripts', () => {
  for (const url of ['javascript:alert(1)', 'http://github.com/a/b', 'https://evil.example/a.exe',
    'https://github.com.evil.example/a', 'https://u:p@github.com/BryanHernz/novastar-versiones/releases/download/v1/file.exe'])
    assert.equal(safeGithub(url, nova.repo), null);
  assert.equal(safeHttps(''), null);
});
test('rechaza releases privados no disponibles, borradores y previews', () => {
  for (const value of [null, {}, { ...rawRelease(), draft: true }, { ...rawRelease(), prerelease: true }])
    assert.throws(() => normalizeRelease(value, nova.repo));
});
test('filtra archivos inválidos y no muestra JSON como instalador', () => {
  const raw = rawRelease();
  raw.assets.push({ name: 'version.json', size: 500, browser_download_url: raw.assets[0].browser_download_url });
  raw.assets.push({ name: 'setup.exe', size: 500, browser_download_url: 'https://evil.example/setup.exe' });
  raw.assets.push({ ...raw.assets[0], size: 0 });
  assert.equal(normalizeRelease(raw, nova.repo).assets.length, raw.assets.length - 3);
});
test('solo guarda y recupera caché validada con máximo de siete días', () => {
  const storage = memoryStorage(), now = Date.now();
  writeCached(nova, storage, rawRelease(), now);
  assert.equal(readCached(nova, storage, now + 1000).release.tag, 'v1.0.24');
  assert.equal(readCached(nova, storage, now + 8 * 86400000), null);
  assert.equal(readCached(nova, storage, now - 1000), null);
});
test('el almacenamiento bloqueado no rompe la aplicación', () => {
  const storage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(readCached(nova, storage), null);
  assert.doesNotThrow(() => writeCached(nova, storage, rawRelease()));
});
test('la consulta se hace sin token ni cookies y siempre se revalida', async () => {
  const result = await fetchLatest(nova, { fetchImpl: async (url, options) => {
    assert.equal(url, `https://api.github.com/repos/${nova.repo}/releases/latest`);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Authorization, undefined);
    return { ok: true, json: async () => rawRelease() };
  } });
  assert.equal(result.release.tag, 'v1.0.24');
});
test('los límites de GitHub tienen un error reconocible', async () => {
  await assert.rejects(fetchLatest(nova, { fetchImpl: async () => ({ ok: false, status: 403 }) }), /limitado/);
});
test('un timeout aborta la solicitud en vez de dejar la interfaz cargando', async () => {
  await assert.rejects(fetchLatest(nova, { timeoutMs: 5, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })));
  }) }), /tardó demasiado/);
});
test('formatea tamaños sin NaN', () => {
  assert.equal(formatBytes(1048576), '1 MB');
  assert.equal(formatBytes(NaN), '');
});

test('la configuracion real conserva las aplicaciones y URLs validas', () => {
  assert.deepEqual(configuredApps.map(x => x.id).sort(), ['carton-lleno','nova-star']);
  for (const app of configuredApps) {
    assert.ok(snapshotRelease(app).assets.length > 0);
    assert.ok(!app.web.url || safeHttps(app.web.url));
  }
});
