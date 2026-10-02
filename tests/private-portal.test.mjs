import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { APPS } from '../config.mjs';
import { initDownloads } from '../app.js';
import { allowedApps, initPortalGate } from '../portal-gate.mjs';
import { createReleaseClient, validateRelease } from '../private-releases.mjs';
import { portalHtml, portalContent } from './portal-fixture.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const user = { uid: 'test-user', isAnonymous: false, getIdToken: async () => 'local-test-id-token' };
const access = { active: true, apps: { novaStar: true, cartonLleno: false } };
const manifest = { schemaVersion: 1, app: 'novaStar', version: '1.0.27', build: 1029,
  releasedAt: '2026-10-01T00:00:00.000Z', notes: '<script>not executable</script>',
  recommendations: { windows: 'novaStar-1.0.27-installer', phone: 'novaStar-1.0.27-phone', tv: 'novaStar-1.0.27-tv' },
  assets: ['installer', 'phone', 'tv', 'updater'].map((variant, i) => ({
    id: `novaStar-1.0.27-${variant}`, variant: i === 0 || i === 3 ? 'standard' : variant,
    platform: i === 0 || i === 3 ? 'windows' : 'android', purpose: i === 0 ? 'installer' : i === 3 ? 'updater' : 'package',
    architecture: i === 0 || i === 3 ? 'x64' : i === 1 ? 'arm64-v8a' : 'armeabi-v7a',
    format: i === 0 ? 'exe' : i === 3 ? 'zip' : 'apk', filename: `artifact-${i}.bin`,
    versionCode: i === 0 || i === 3 ? null : 3029, size: 1234, sha256: 'a'.repeat(64), generation: String(i + 1),
    downloadEndpoint: `/api/v1/releases/novaStar/1.0.27/download/novaStar-1.0.27-${variant}`,
  })) };
function dom(t) {
  const instance = new JSDOM(portalHtml(), { url: 'http://127.0.0.1:8080/' });
  t.after(() => instance.window.close());
  return instance;
}
function gate(t, { record = access, loadPortal, onAuthorized = () => {}, ...extra } = {}) {
  const { window } = dom(t);
  window.document.getElementById('portal-content').replaceChildren();
  let signOuts = 0, signedIn;
  const auth = { subscribe: () => () => {}, signOut: async () => { signOuts++; },
    signIn: async (email, password) => { signedIn = { email, password }; },
    loadPortal: loadPortal ?? (async () => ({ html: portalContent, apps: record?.active === true ?
      APPS.filter(app => record.apps?.[app.key] === true).map(app => app.key) : [] })),
    readAccess: async () => { throw new Error('The portal must use the API only'); } };
  const controller = initPortalGate({ document: window.document, window, auth, reload: () => {}, onAuthorized, ...extra });
  return { ...controller, window, document: window.document, auth, signOuts: () => signOuts, signedIn: () => signedIn };
}
test('sin sesión muestra login; sin JavaScript el contenido permanece oculto', async t => {
  assert.match(html, /id="portal-login-form" hidden/);
  const g = gate(t); await g.session(null);
  assert.ok(g.document.getElementById('portal-content').hidden);
  assert.equal(g.document.getElementById('portal-login-form').hidden, false);
  assert.equal(g.document.querySelectorAll('a[href*="github.com"]').length, 0);
  assert.doesNotMatch(html, /data-web|Web · Próximamente|signup|signInAnonymously/);
  assert.doesNotMatch(html, /data-download|data-app|Nova Star|Cartón Lleno/);
});
test('la API que deniega contenido nunca monta el portal ni una respuesta tardía de otra sesión', async t => {
  const g = gate(t);
  g.auth.loadPortal = async () => { throw Object.assign(new Error('denied'), { status: 403 }); };
  await g.session(user);
  assert.equal(g.document.getElementById('portal-content').childElementCount, 0);
  assert.ok(g.document.getElementById('portal-content').hidden);
});
test('Nova autorizada aparece; Cartón, sus enlaces y sus pantallas se retiran', async t => {
  const g = gate(t); await g.session(user);
  assert.equal(g.document.getElementById('portal-content').hidden, false);
  assert.ok(g.document.getElementById('nova-star'));
  assert.equal(g.document.querySelector('[data-app="carton-lleno"]'), null);
  assert.equal(g.document.querySelector('a[href="#carton-lleno"]'), null);
  assert.equal(g.document.querySelector('[data-product="carton-lleno"]'), null);
  assert.doesNotMatch(g.document.getElementById('portal-content').textContent, /Cartón Lleno/);
  assert.equal(g.document.querySelectorAll('[data-web]').length, 0);
  assert.doesNotMatch(g.document.querySelector('.downloads-intro').textContent, /web|próximamente/i);
});
test('Cartón autorizada conserva CTA, sin Nova ni ayuda del micrófono', async t => {
  const g = gate(t, { record: { active: true, apps: { cartonLleno: true } } }); await g.session(user);
  assert.equal(g.document.getElementById('nova-star'), null);
  assert.equal(g.document.querySelector('.header-inner > .header-cta').getAttribute('href'), '#carton-lleno');
  assert.doesNotMatch(g.document.getElementById('portal-content').textContent, /Nova Star/);
});
test('la API es la única autoridad; apps inválidas y errores de red fallan cerrados', async t => {
  for (const keys of [undefined, [], ['unknown'], [true], { novaStar: true }]) assert.equal(allowedApps(keys).length, 0);
  const g = gate(t, { loadPortal: async () => { throw new Error('offline'); } }); await g.session(user);
  assert.ok(g.document.getElementById('portal-content').hidden);
  assert.match(g.document.getElementById('portal-message').textContent, /verificar tu acceso/);
});
test('rechaza Anonymous sin deshabilitar el proveedor y vacía contraseña al enviar', async t => {
  const g = gate(t); await g.session({ ...user, isAnonymous: true }); assert.equal(g.signOuts(), 1);
  await g.session(null);
  const form = g.document.getElementById('portal-login-form');
  form.elements.email.value = 'test@example.invalid'; form.elements.password.value = 'local-test-password';
  form.dispatchEvent(new g.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(form.elements.password.value, '');
  assert.equal(g.signedIn().email, 'test@example.invalid');
  assert.equal(g.window.localStorage.length, 0);
});
test('logout oculta el portal; una lectura retrasada no vuelve a abrirlo', async t => {
  let resolve;
  const g = gate(t, { loadPortal: () => new Promise(done => { resolve = done; }) });
  const pending = g.session(user); await new Promise(done => setImmediate(done));
  await g.session(null); resolve({ html: portalContent, apps: ['novaStar'] }); await pending;
  assert.ok(g.document.getElementById('portal-content').hidden);
});
test('descargas consultan API autenticada y firman bajo demanda, sin enlaces/caché persistentes', async t => {
  const { window } = dom(t), calls = [], navigated = [];
  await initDownloads({ document: window.document, window, apps: [APPS[0]], user,
    navigate: url => navigated.push(url), fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => url.endsWith('/latest') ? manifest : {
        url: 'https://storage.googleapis.com/private/installer.exe?X-Goog-Signature=local-test',
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      } };
    } });
  assert.equal(calls.length, 1); assert.match(calls[0].url, /releases\/novaStar\/latest$/);
  const button = window.document.querySelector('[data-download="windows"]');
  assert.equal(button.getAttribute('href'), null); assert.equal(button.getAttribute('aria-disabled'), 'false');
  assert.match(window.document.querySelector('[data-notes]').textContent, /<script>/);
  button.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[1].options.method, 'POST'); assert.equal(calls[1].options.body, '{}');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer local-test-id-token');
  assert.match(calls[1].url, /novaStar\/1.0.27\/download\/novaStar-1.0.27-installer$/);
  assert.equal(navigated.length, 1); assert.equal(window.localStorage.length, 0);
  assert.equal(button.getAttribute('href'), null);
});
test('rechaza manifest manipulado, signed URL vencida y 403; no usa fallback GitHub', async t => {
  assert.throws(() => validateRelease({ ...manifest, assets: manifest.assets.map(a => ({ ...a, downloadEndpoint: 'https://evil.test' })) }, 'novaStar'));
  const client = createReleaseClient({ user, fetchImpl: async () => ({ ok: true, json: async () => ({
    url: 'https://storage.googleapis.com/private?X-Goog-Signature=local-test', expiresAt: new Date(Date.now() - 1000).toISOString(),
  }) }) });
  await assert.rejects(client.download('novaStar', '1.0.27', 'novaStar-1.0.27-installer'), error => error.status === 503);
  const { window } = dom(t), denied = [];
  await initDownloads({ document: window.document, window, apps: [APPS[0]], user,
    onDenied: status => denied.push(status), fetchImpl: async () => ({ ok: false, status: 403 }) });
  assert.deepEqual(denied, [403]);
  assert.equal(window.document.querySelector('[data-download="windows"]').getAttribute('aria-disabled'), 'true');
});

test('portal usa defaults teléfono/TV y nunca el updater como instalador Windows', async t => {
  const { window } = dom(t), downloads = [];
  await initDownloads({ document: window.document, window, apps: [APPS[0]], user,
    navigate: () => {}, fetchImpl: async url => ({ ok: true, json: async () => {
      if (url.endsWith('/latest')) return manifest;
      downloads.push(url);
      return { url: 'https://storage.googleapis.com/private?X-Goog-Signature=test',
        expiresAt: new Date(Date.now() + 300000).toISOString() };
    } }) });
  for (const target of ['windows', 'phone', 'tv']) {
    window.document.querySelector(`[data-download="${target}"]`).click();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(downloads.at(-1).endsWith(`/download/${manifest.recommendations[target]}`));
  }
  assert.ok(downloads.every(url => !url.endsWith('updater')));
});
test('el nuevo gate no se incluye en pairing y el build copia sus dependencias independientes', () => {
  const pair = readFileSync(new URL('../pair.html', import.meta.url), 'utf8');
  assert.doesNotMatch(pair, /portal-gate|portal-auth|app.js|portal-content/);
  const source = readFileSync(new URL('../portal-auth.mjs', import.meta.url), 'utf8');
  assert.match(source, /createReleaseClient/); assert.match(source, /connectFirebaseAuth/);
  assert.doesNotMatch(source, /firebase-firestore|getDoc|readAccess/);
  assert.doesNotMatch(source, /localStorage|signInAnonymously|createUser/);
});

test('los módulos del nuevo gate evitan la configuración pública cacheada', () => {
  assert.match(readFileSync(new URL('../portal-gate.mjs', import.meta.url), 'utf8'), /config\.mjs\?v=private-v2/);
  assert.match(html, /app\.js\?v=private-v3/);
});
