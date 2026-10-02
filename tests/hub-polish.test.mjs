import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { portalHtml } from './portal-fixture.mjs';
import { pairingAppearance, mountPairPage, bootPairPage } from '../pair.mjs';
import { createPairingFlow, loadPairingMetadata } from '../pairing.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const pairHtml = read('pair.html');
const id = 'ab'.repeat(24), pathname = `/pair/${id}`;
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, { app = 'novaStar', status = 'pending', user = null, loadMetadata } = {}) {
  const dom = new JSDOM(pairHtml, { url: `https://nexo-hub.web.app${pathname}?app=cartonLleno` });
  const auth = { subscribe(next) { next(user); return () => {}; }, signOut: async () => {} };
  const flow = createPairingFlow({ pathname, auth, loadMetadata: loadMetadata ?? (async () => ({ app, status })) });
  mountPairPage(dom.window.document, flow); flow.start();
  t.after(() => { flow.destroy(); dom.window.close(); });
  return { flow, document: dom.window.document };
}
test('login split muestra arte real sin catálogo privado; navbar sin explorar y logout secundario', () => {
  const dom = new JSDOM(portalHtml()), doc = dom.window.document;
  assert.equal(doc.querySelectorAll('.header .header-cta').length, 0);
  assert.doesNotMatch(doc.querySelector('.header').textContent, /Explorar aplicaciones/);
  assert.ok(doc.getElementById('portal-logout').classList.contains('quiet-action'));
  assert.ok(!doc.getElementById('portal-logout').classList.contains('button'));
  assert.equal(doc.querySelectorAll('.login-world .login-screen').length, 2);
  const planes = [...doc.querySelectorAll('.login-scenes [data-parallax]')];
  assert.equal(planes.length, 2);
  assert.ok(Number(planes[0].dataset.parallax) > 0 && Number(planes[1].dataset.parallax) < 0);
  assert.ok(planes.every(plane => Number(plane.dataset.parallaxLimit) <= 16));
  assert.doesNotMatch(read('index.html'), /data-download|downloadEndpoint|X-Goog-Signature|signup/);
  const css = read('styles.css');
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\[data-download="tv"\].*grid-column:1 \/ -1/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  dom.window.close();
});
for (const [app, name, accent] of [['novaStar', 'Nova Star', '#ffb156'], ['cartonLleno', 'Cartón Lleno', '#fad703']]) {
  test(`metadata ${app} tematiza pairing sin usar query params`, async t => {
    const { flow, document } = fixture(t, { app }); await tick();
    assert.equal(flow.snapshot().app, app);
    assert.equal(document.getElementById('pair-experience').dataset.app, app);
    assert.equal(document.body.dataset.app, app);
    assert.equal(document.getElementById('pair-header-name').textContent, name);
    assert.equal(document.title, `Vincular TV · ${name}`);
    assert.equal(document.getElementById('pair-title').textContent, `Vincular ${name}`);
    assert.equal(document.getElementById('login-form').hidden, false);
    assert.equal(pairingAppearance(app).accent, accent);
    assert.equal(document.getElementById('pair-product-screen').hidden, false);
  });
}
test('app desconocida permanece neutra, sin HTML ni rutas de imagen inyectadas', async t => {
  const { document } = fixture(t, { app: '<img src=x onerror=alert(1)>' }); await tick();
  assert.equal(document.getElementById('pair-experience').dataset.app, 'nexo');
  assert.equal(document.body.dataset.app, 'nexo');
  assert.equal(document.getElementById('pair-header-name').textContent, 'Nexo');
  assert.equal(document.querySelector('meta[name="theme-color"]').content, '#071018');
  assert.equal(document.getElementById('pair-product-tagline').hidden, true);
  assert.equal(document.querySelector('.pair-carton-balls').hidden, true);
  assert.equal(document.getElementById('pair-title').textContent, 'Vincular dispositivo');
  assert.equal(document.getElementById('pair-product-screen').hidden, true);
  assert.equal(document.querySelector('[onerror]'), null);
});
test('metadata es GET sin token de polling ni consumición; no persiste respuesta', async () => {
  const calls = [];
  const result = await loadPairingMetadata(id, { fetchImpl: async (url, options) => {
    calls.push({ url, options }); return { status: 200, json: async () => ({ app: 'novaStar', status: 'pending', expiresAt: '2030-01-01T00:00:00Z' }) };
  } });
  assert.equal(result.app, 'novaStar'); assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith(`${id}/metadata`)); assert.equal(calls[0].options.headers, undefined);
  assert.equal(calls[0].options.cache, 'no-store');
  assert.doesNotMatch(read('pairing.mjs'), /localStorage|sessionStorage|pollToken|customToken/);
});
test('metadata pendiente impide aprobar; sesión existente pasa directamente a código', async t => {
  let resolve; let tokenCalls = 0;
  const user = { uid: 'test', email: 'test@example.invalid', getIdToken: async () => { tokenCalls++; return 'mock'; } };
  const { flow, document } = fixture(t, { user, loadMetadata: () => new Promise(done => { resolve = done; }) });
  await flow.approve('123456'); assert.equal(tokenCalls, 0); assert.equal(flow.snapshot().phase, 'checking');
  resolve({ app: 'cartonLleno', status: 'pending' }); await tick();
  assert.equal(flow.snapshot().phase, 'code-entry'); assert.equal(document.getElementById('login-form').hidden, true);
});
for (const [status, phase] of [['expired', 'expired'], ['approved', 'already-used'], ['consumed', 'consumed']]) {
  test(`metadata ${status} muestra estado terminal y no ofrece aprobación`, async t => {
    const { flow, document } = fixture(t, { status }); await tick();
    assert.equal(flow.snapshot().phase, phase); assert.ok(flow.snapshot().terminal);
    assert.equal(document.getElementById('login-form').hidden, true); assert.equal(document.getElementById('pair-form').hidden, true);
  });
}
test('fallo de metadata permanece cerrado y muestra reintento seguro', async t => {
  const { flow, document } = fixture(t, { loadMetadata: async () => { throw new Error('private details'); } }); await tick();
  assert.equal(flow.snapshot().phase, 'metadata-error');
  assert.equal(document.getElementById('pair-retry').hidden, false);
  assert.doesNotMatch(document.body.textContent, /private details/);
});
test('boot real monta lectura metadata y mantiene independiente /pair del gate portal', async t => {
  const dom = new JSDOM(pairHtml), calls = [];
  const flow = await bootPairPage({ document: dom.window.document, pathname,
    connectAuth: async () => ({ subscribe(next) { next(null); return () => {}; } }),
    fetchImpl: async url => { calls.push(url); return { status: 200, json: async () => ({ app: 'cartonLleno', status: 'pending', expiresAt: '2030-01-01T00:00:00Z' }) }; } });
  await tick(); t.after(() => { flow.destroy(); dom.window.close(); });
  assert.equal(calls.length, 1); assert.ok(calls[0].endsWith('/metadata'));
  assert.equal(flow.snapshot().app, 'cartonLleno'); assert.equal(flow.snapshot().phase, 'login-required');
  assert.doesNotMatch(pairHtml, /portal-gate|\/api\/v1\/portal/);
});

test('Auth que falla mientras carga metadata no se convierte en login/approval disponible', async t => {
  const dom = new JSDOM(pairHtml); let resolve;
  const flow = createPairingFlow({ pathname,
    auth: { subscribe(_next, error) { error(); return () => {}; } },
    loadMetadata: () => new Promise(done => { resolve = done; }) });
  mountPairPage(dom.window.document, flow); flow.start();
  resolve({ app: 'novaStar', status: 'pending' }); await tick();
  t.after(() => { flow.destroy(); dom.window.close(); });
  assert.equal(flow.snapshot().phase, 'config-error');
  assert.ok(flow.snapshot().terminal); assert.ok(dom.window.document.getElementById('pair-form').hidden);
});

test('fixture visual permanece fuera de archivos públicos y contratos de descarga intactos', async () => {
  const { PUBLIC_FILES } = await import('../tools/build.mjs');
  assert.ok(PUBLIC_FILES.every(file => !/preview-polish|__review/.test(file)));
  assert.doesNotMatch(read('pair.mjs') + read('pairing.mjs'), /searchParams|getDoc|firebase-firestore/);
});
