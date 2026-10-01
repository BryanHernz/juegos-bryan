import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { initDownloads } from '../app.js';
import { APPS } from '../config.mjs';
import { productWeb, snapshotRelease, writeCached } from '../releases.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const expected = {
  'nova-star': { tag: 'v1.0.27', repo: 'BryanHernz/nova-star-versiones',
    windows: 'NovaStar-1.0.27-windows-installer.exe', phone: 'NovaStar-telefono.apk', tv: 'NovaStar-tele.apk' },
  'carton-lleno': { tag: 'v1.0.42', repo: 'BryanHernz/carton-lleno-versiones',
    windows: 'CartonLleno-windows-instalador.exe', phone: 'CartonLleno-telefono.apk', tv: 'CartonLleno-tele.apk' },
};

function rawRelease(app) {
  return { ...app.snapshot, assets: snapshotRelease(app).assets.map(asset => ({
    name: asset.name, size: asset.size, browser_download_url: asset.url, state: 'uploaded',
  })) };
}
function assertOptions(document) {
  for (const app of APPS) {
    const match = expected[app.id];
    for (const root of document.querySelectorAll(`[data-app="${app.id}"]`)) {
      assert.equal(root.querySelector('[data-version]').textContent, match.tag);
      for (const key of ['windows', 'phone', 'tv']) {
        assert.equal(root.querySelector(`[data-download="${key}"]`).href,
          `https://github.com/${match.repo}/releases/download/${match.tag}/${match[key]}`);
      }
      const web = root.querySelector('[data-web]');
      assert.equal(web.getAttribute('href'), null);
      assert.equal(web.getAttribute('aria-disabled'), 'true');
      assert.match(web.textContent, /Web.*Próximamente/);
    }
    const card = document.getElementById(`descargas-${app.id}`);
    assert.deepEqual([...card.querySelectorAll('.download-options > a')].map(link =>
      link.hasAttribute('data-web') ? 'web' : link.hasAttribute('data-companion') ? 'companion' : link.dataset.download),
    app.id === 'nova-star' ? ['web', 'windows', 'phone', 'tv', 'companion'] : ['web', 'windows', 'phone', 'tv']);
  }
  const companions = [...document.querySelectorAll('[data-companion]')];
  assert.equal(companions.length, 2);
  for (const companion of companions) {
    assert.equal(companion.href, 'https://nova-star-bd0d9.web.app/');
    assert.match(companion.textContent, /Micrófono \/ Companion/);
    assert.equal(companion.closest('[data-app]').dataset.app, 'nova-star');
  }
  assert.equal(document.querySelectorAll('[data-download="portable"], [data-assets]').length, 0);
  assert.doesNotMatch(document.body.textContent, /Windows portátil|Otras variantes/);
  assert.equal([...document.querySelectorAll('a[href]')].filter(link => /\.zip$/i.test(link.href)).length, 0);
}

test('el fallback offline conserva versiones actuales, instaladores y companion separado de Web', async t => {
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:8080/' });
  t.after(() => dom.window.close());
  t.mock.method(console, 'warn', () => {});
  await initDownloads({ document: dom.window.document, window: dom.window,
    fetchImpl: async () => { throw new Error('Sin conexión'); } });
  assertOptions(dom.window.document);
  assert.match(dom.window.document.querySelector('[data-status]').textContent, /información guardada/);
});

test('la consulta latest usa los repositorios correctos y publica sólo las opciones principales', async t => {
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:8080/' });
  t.after(() => dom.window.close());
  const calls = [];
  await initDownloads({ document: dom.window.document, window: dom.window, fetchImpl: async url => {
    calls.push(url);
    const app = APPS.find(app => url === `https://api.github.com/repos/${app.repo}/releases/latest`);
    assert.ok(app, url);
    return { ok: true, json: async () => rawRelease(app) };
  } });
  assert.equal(calls.length, 2);
  assertOptions(dom.window.document);
  assert.match(dom.window.document.querySelector('[data-status]').textContent, /comprobada ahora/);
});

test('una caché anterior de Cartón no reemplaza el snapshot actualizado cuando GitHub falla', async t => {
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:8080/' });
  t.after(() => dom.window.close());
  t.mock.method(console, 'warn', () => {});
  const carton = APPS[1], old = rawRelease(carton);
  old.tag_name = 'v1.0.36';
  writeCached(carton, dom.window.localStorage, old);
  await initDownloads({ document: dom.window.document, window: dom.window,
    fetchImpl: async () => ({ ok: false, status: 429 }) });
  assertOptions(dom.window.document);
});

test('Web rechaza el origen del companion y la herramienta de configuración no lo escribe', () => {
  const nova = APPS[0];
  assert.equal(productWeb({ ...nova, web: { ...nova.web, url: nova.companion.url } }), null);
  assert.equal(productWeb({ ...nova, web: { ...nova.web, url: `${nova.companion.url}catalogo` } }), null);
  assert.equal(productWeb({ ...APPS[1], web: { ...APPS[1].web, url: nova.companion.url } }, [nova.companion.url]), null);
  const configUrl = new URL('../config.mjs', import.meta.url), before = readFileSync(configUrl, 'utf8');
  for (const app of APPS) {
    const command = spawnSync(process.execPath, [fileURLToPath(new URL('../tools/configurar-web.mjs', import.meta.url)),
      app.id, nova.companion.url], { encoding: 'utf8', windowsHide: true });
    assert.equal(command.status, 1);
    assert.match(command.stderr, /Micrófono \/ Companion/);
  }
  assert.equal(readFileSync(configUrl, 'utf8'), before);
});
