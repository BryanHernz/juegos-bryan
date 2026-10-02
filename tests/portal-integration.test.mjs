import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { JSDOM } from 'jsdom';
import { buildSite } from '../tools/build.mjs';
import { createPreviewServer } from '../tools/serve.mjs';
import { portalHtml } from './portal-fixture.mjs';

test('portal recuperado muestra Nexo en título, metadatos, encabezado y pie', async () => {
  const dom = new JSDOM(portalHtml());
  try {
    const document = dom.window.document;
    assert.match(document.title, /Nexo/);
    assert.match(document.querySelector('meta[name=description]').content, /Nexo/);
    for (const brand of document.querySelectorAll('.brand')) assert.equal(brand.textContent.trim(), 'Nexo');
    assert.doesNotMatch(document.documentElement.textContent, /Sala\s*Uno|Juegos Bryan/i);
    assert.ok(document.querySelectorAll('.gallery-controls [role=tab]').length >= 8);
  } finally { dom.window.close(); }
});

test('build contiene el portal, pairing, capturas y todos los assets sin archivos de infraestructura', async () => {
  const count = await buildSite();
  assert.ok(count >= 28);
  for (const file of ['index.html', 'styles.css', 'motion.mjs', 'experience.mjs',
    'download.html', 'download.mjs', 'download-page.mjs',
    'pair.html', 'pair-base.css', 'pair.css', 'pair.mjs', 'pairing.mjs', 'pair-auth.mjs', 'pair-config.mjs',
    'assets/screens/nova-library.webp', 'assets/screens/nova-duet.webp',
    'assets/screens/carton-75.webp', 'assets/screens/carton-remote.webp',
    'assets/nova-star-logo.png', 'assets/carton-mark.webp',
    'assets/print/cartones-75.pdf', 'assets/print/cartones-90.pdf']) {
    assert.ok((await stat(new URL(`../_site/${file}`, import.meta.url))).size > 0, file);
  }
  const pairHtml = await readFile(new URL('../_site/pair.html', import.meta.url), 'utf8');
  assert.match(pairHtml, /href="\/pair-base.css"/);
  assert.doesNotMatch(pairHtml, /href="\/styles.css"/);
  for (const file of ['functions', 'portal-content.html', 'legacy-releases.mjs', 'releases.mjs', 'firebase.json', '.firebaserc', 'package.json', 'tests']) {
    await assert.rejects(stat(new URL(`../_site/${file}`, import.meta.url)), { code: 'ENOENT' });
  }
  assert.equal(JSON.parse(await readFile(new URL('../_site/portal-version.json', import.meta.url))).version, '1.2.1');
});

test('vista previa sirve capturas y PDFs con el tipo correcto y conserva /pair', async t => {
  const server = createPreviewServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const [file, type] of [['/assets/screens/nova-library.webp', 'image/webp'],
    ['/assets/screens/carton-remote.webp', 'image/webp'], ['/assets/print/cartones-75.pdf', 'application/pdf']]) {
    const response = await fetch(origin + file);
    assert.equal(response.status, 200, file);
    assert.equal(response.headers.get('content-type'), type);
  }
  const response = await fetch(`${origin}/pair/${'ab'.repeat(24)}`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /href="\/pair-base.css"/);
  for (const path of ['/functions/portal-content.html', '/portal-content.html', '/tools/legacy-releases.mjs']) {
    assert.equal((await fetch(origin + path)).status, 404, path);
  }
  const login = await (await fetch(origin + '/')).text();
  assert.doesNotMatch(login, /data-download|Nova Star|Cartón Lleno/);
});
