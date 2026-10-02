import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { JSDOM } from 'jsdom';
import { appFromDownloadPath, initDownloadPage } from '../download.mjs';
import { createReleaseClient } from '../private-releases.mjs';
import { createPreviewServer } from '../tools/serve.mjs';

const html = readFileSync(new URL('../download.html', import.meta.url), 'utf8');
const user = { uid: 'local-test-user', isAnonymous: false, getIdToken: async () => 'local-test-token' };
const tick = () => new Promise(resolve => setImmediate(resolve));
function release(app = 'cartonLleno') {
  const version = app === 'cartonLleno' ? '1.0.42' : '1.0.29';
  const id = purpose => `${app}-${version}-${purpose}`;
  return { schemaVersion: 1, app, version, build: app === 'cartonLleno' ? 44 : 1031, notes: '',
    recommendations: { windows: id('installer'), phone: id('phone'), tv: id('tv') },
    assets: ['installer', 'phone', 'tv', 'arm64'].map((variant, i) => ({
      id: id(variant), platform: i === 0 ? 'windows' : 'android', purpose: i === 0 ? 'installer' : 'package',
      variant: i === 0 || i === 3 ? 'standard' : variant, architecture: i === 0 ? 'x64' : 'arm64-v8a',
      format: i === 0 ? 'exe' : 'apk', versionCode: i === 0 ? null : 3044,
      filename: `artifact-${variant}.${i === 0 ? 'exe' : 'apk'}`, size: 1234, sha256: 'a'.repeat(64),
      generation: String(i + 1), downloadEndpoint: `/api/v1/releases/${app}/${version}/download/${id(variant)}`,
    })) };
}
function setup(t, { pathname = '/download/cartonLleno', apps = ['cartonLleno'], responder } = {}) {
  const dom = new JSDOM(html, { url: `https://nexo-hub.web.app${pathname}` });
  const { window } = dom, calls = [], navigations = [], credentials = [];
  let listener, signOuts = 0, unsubscribeCount = 0, signature = 0;
  const auth = {
    subscribe(next) { listener = next; next(null); return () => unsubscribeCount++; },
    async signIn(email, password) { credentials.push({ email, password }); listener(user); },
    async signOut() { signOuts++; listener(null); },
  };
  const controller = initDownloadPage({ document: window.document, window, auth,
    navigate: url => navigations.push(url),
    clientFor: current => createReleaseClient({ user: current, fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (responder) return responder(url, options);
      const app = appFromDownloadPath(pathname);
      return { ok: true, json: async () => url.endsWith('/portal') ? { apps, html: '<p>Private catalog, never mounted</p>' } :
        url.endsWith('/latest') ? release(app) : {
          url: `https://storage.googleapis.com/private/app.apk?X-Goog-Signature=test-${++signature}`,
          expiresAt: new Date(Date.now() + 300000).toISOString(), filename: 'app.apk', size: 1234, sha256: 'a'.repeat(64),
        } };
    } }),
  });
  t.after(() => { controller.stop(); window.close(); });
  return { ...controller, window, document: window.document, auth, calls, navigations, credentials,
    unsubscribeCount: () => unsubscribeCount, signOuts: () => signOuts };
}

test('sin sesión muestra sólo login y no solicita catálogo, release ni descarga', t => {
  const page = setup(t);
  assert.equal(page.document.getElementById('download-login').hidden, false);
  assert.equal(page.calls.length, 0);
  assert.equal(page.document.getElementById('download-retry').hidden, true);
  assert.doesNotMatch(html, /github\.com|storage\.googleapis\.com|signedUrl|data-download|signup|signInAnonymously/);
  assert.equal(page.document.querySelector('[src="/app.js"]'), null);
});

for (const app of ['cartonLleno', 'novaStar']) {
  test(`${app}: sesión existente valida API, selecciona phone default y usa Bearer ID token`, async t => {
    const page = setup(t, { pathname: `/download/${app}`, apps: [app] });
    await page.session(user);
    const manifest = release(app);
    assert.equal(page.calls.length, 3);
    assert.ok(page.calls[0].url.endsWith('/api/v1/portal'));
    assert.ok(page.calls[1].url.endsWith(`/releases/${app}/latest`));
    assert.ok(page.calls[2].url.endsWith(`/releases/${app}/${manifest.version}/download/${manifest.recommendations.phone}`));
    assert.equal(page.calls[2].options.method, 'POST');
    assert.equal(page.calls[2].options.body, '{}');
    for (const { options } of page.calls) {
      assert.equal(options.headers.Authorization, 'Bearer local-test-token');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.referrerPolicy, 'no-referrer');
    }
    assert.equal(page.navigations.length, 1);
    assert.match(page.navigations[0], /^https:\/\/storage\.googleapis\.com\//);
    assert.equal(page.document.getElementById('download-login').hidden, true);
    assert.equal(page.document.getElementById('download-card').dataset.state, 'complete');
    assert.doesNotMatch(page.document.body.textContent, /Private catalog/);
  });
}

test('login email/password continúa automáticamente y vacía contraseña sin guardarla', async t => {
  const page = setup(t), form = page.document.getElementById('download-login');
  form.elements.email.value = 'test@example.invalid';
  form.elements.password.value = 'test-password';
  form.dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  assert.deepEqual(page.credentials, [{ email: 'test@example.invalid', password: 'test-password' }]);
  assert.equal(form.elements.password.value, '');
  assert.equal(page.navigations.length, 1);
  assert.equal(page.window.localStorage.length, 0);
  assert.equal(page.window.sessionStorage.length, 0);
  assert.doesNotMatch(page.document.documentElement.outerHTML, /test-password|local-test-token/);
});

test('app no autorizada devuelve estado 403 sin consultar latest ni solicitar firma', async t => {
  const page = setup(t, { apps: ['novaStar'] });
  await page.session(user);
  assert.equal(page.calls.length, 1);
  assert.equal(page.navigations.length, 0);
  assert.equal(page.document.getElementById('download-card').dataset.status, '403');
  assert.match(page.document.getElementById('download-message').textContent, /no tiene acceso/);
});

test('Anonymous se cierra sin solicitudes ni descarga y vuelve al login', async t => {
  const page = setup(t);
  await page.session({ ...user, isAnonymous: true });
  assert.equal(page.signOuts(), 1);
  assert.equal(page.calls.length, 0);
  assert.equal(page.document.getElementById('download-login').hidden, false);
});

test('401 del backend obliga a autenticar nuevamente; 403 falla cerrado', async t => {
  for (const status of [401, 403]) {
    const page = setup(t, { responder: async () => ({ ok: false, status }) });
    await page.session(user);
    assert.equal(page.navigations.length, 0);
    assert.equal(page.document.getElementById('download-card').dataset.status, String(status));
    assert.equal(page.document.getElementById('download-login').hidden, status !== 401);
    assert.equal(page.signOuts(), status === 401 ? 1 : 0);
  }
});

test('app inexistente produce 404 sin inicializar Auth ni llamar la API', t => {
  const page = setup(t, { pathname: '/download/unknown' });
  assert.equal(page.document.getElementById('download-card').dataset.status, '404');
  assert.equal(page.document.getElementById('download-login').hidden, true);
  assert.equal(page.calls.length, 0);
  assert.equal(page.unsubscribeCount(), 0);
  assert.equal(appFromDownloadPath('/download/cartonLleno/'), 'cartonLleno');
  for (const path of ['/download', '/download/', '/download/cartonLleno/other', '/download/%63artonLleno']) {
    assert.equal(appFromDownloadPath(path), null);
  }
});

test('URL firmada nunca se persiste ni aparece en HTML; repetir descarga obtiene una firma nueva', async t => {
  const page = setup(t);
  await page.session(user);
  page.document.getElementById('download-retry').click();
  await tick();
  assert.equal(page.calls.filter(call => call.url.endsWith('/portal')).length, 2);
  assert.equal(page.navigations.length, 2);
  assert.notEqual(page.navigations[0], page.navigations[1]);
  assert.equal(page.window.localStorage.length, 0);
  assert.equal(page.window.sessionStorage.length, 0);
  assert.doesNotMatch(page.document.documentElement.outerHTML, /X-Goog-Signature|storage\.googleapis|local-test-token/);
  for (const a of page.document.querySelectorAll('a')) assert.ok(a.getAttribute('href') === '/');
});

test('rechaza firmas vencidas sin iniciar descarga; error de red no usa fallback público', async t => {
  const page = setup(t, { responder: async url => {
    if (url.endsWith('/portal')) return { ok: true, json: async () => ({ apps: ['cartonLleno'], html: '' }) };
    if (url.endsWith('/latest')) return { ok: true, json: async () => release() };
    return { ok: true, json: async () => ({
      url: 'https://storage.googleapis.com/private?X-Goog-Signature=expired', expiresAt: new Date(0).toISOString(),
    }) };
  } });
  await page.session(user);
  assert.equal(page.navigations.length, 0);
  assert.equal(page.document.getElementById('download-card').dataset.state, 'error');
  const offline = setup(t, { responder: async () => { throw new Error('offline'); } });
  await offline.session(user);
  assert.equal(offline.navigations.length, 0);
  assert.equal(offline.document.getElementById('download-card').dataset.state, 'error');
});

test('logout durante la firma invalida la respuesta pendiente y conserva el login', async t => {
  let resolveDownload;
  const page = setup(t, { responder: async url => {
    if (url.endsWith('/portal')) return { ok: true, json: async () => ({ apps: ['cartonLleno'], html: '' }) };
    if (url.endsWith('/latest')) return { ok: true, json: async () => release() };
    return new Promise(resolve => { resolveDownload = resolve; });
  } });
  const pending = page.session(user);
  await tick();
  assert.equal(typeof resolveDownload, 'function');
  await page.signOut();
  resolveDownload({ ok: true, json: async () => ({
    url: 'https://storage.googleapis.com/private?X-Goog-Signature=late', expiresAt: new Date(Date.now() + 300000).toISOString(),
  }) });
  await pending;
  assert.equal(page.navigations.length, 0);
  assert.equal(page.document.getElementById('download-login').hidden, false);
});

test('cada reintento verifica permisos actuales y no descarga si el acceso fue revocado', async t => {
  const apps = ['cartonLleno'];
  const page = setup(t, { apps });
  await page.session(user);
  apps.splice(0, 1, 'novaStar');
  await page.download();
  assert.equal(page.navigations.length, 1);
  assert.equal(page.calls.filter(call => call.options.method === 'POST').length, 1);
  assert.equal(page.document.getElementById('download-card').dataset.status, '403');
});

test('preview sirve ambas rutas y sus módulos; app inexistente HTTP 404; /pair permanece independiente', async t => {
  const server = createPreviewServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/download/cartonLleno', '/download/novaStar', '/download/cartonLleno/', '/download/novaStar/']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(await response.text(), /src="\/download-page.mjs"/);
  }
  for (const path of ['/download/unknown', '/download/cartonLleno/extra', '/download/']) {
    assert.equal((await fetch(origin + path)).status, 404);
  }
  for (const path of ['/download.mjs', '/download-page.mjs', '/private-releases.mjs', '/pair-auth.mjs']) {
    assert.equal((await fetch(origin + path)).status, 200);
  }
  const pair = await fetch(origin + `/pair/${'ab'.repeat(24)}`);
  assert.equal(pair.status, 200);
  assert.doesNotMatch(await pair.text(), /download-page|portal-gate/);
});

test('Hosting reescribe sólo apps conocidas, preserva /pair y protege respuestas de descarga', () => {
  const config = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
  assert.equal(config.hosting.target, 'portal');
  const routes = config.hosting.rewrites.filter(rule => rule.destination === '/download.html');
  assert.deepEqual(routes.map(rule => rule.source).sort(), [
    '/download/cartonLleno', '/download/cartonLleno/', '/download/novaStar', '/download/novaStar/',
  ]);
  assert.ok(!config.hosting.rewrites.some(rule => rule.source === '/download/**'));
  for (const source of ['/download/**', '/download.html']) {
    const headers = config.hosting.headers.find(rule => rule.source === source).headers;
    assert.ok(headers.some(h => h.key === 'Cache-Control' && h.value === 'no-store'));
    assert.ok(headers.some(h => h.key === 'Referrer-Policy' && h.value === 'no-referrer'));
  }
});
