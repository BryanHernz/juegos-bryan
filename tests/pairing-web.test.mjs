import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createPairingFlow, pairingIdFromPath, SUCCESS_MESSAGE } from '../pairing.mjs';
import { mountPairPage, bootPairPage } from '../pair.mjs';
import { connectFirebaseAuth } from '../pair-auth.mjs';
import { FIREBASE_CONFIG, PAIRING_API_ORIGIN, FIREBASE_SDK_VERSION } from '../pair-config.mjs';

const id = '0123456789abcdef'.repeat(3);
const pathname = `/pair/${id}`;
const html = await readFile(new URL('../pair.html', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fakeUser() {
  const refreshes = [];
  return { uid: 'user-1', email: 'persona@example.test', isAnonymous: false, refreshes,
    async getIdToken(refresh) { refreshes.push(refresh); return 'test-id-token'; } };
}
function fakeAuth(initial = null) {
  let listener;
  return {
    signIns: [], signOuts: 0,
    subscribe(next) { listener = next; next(initial); return () => { listener = undefined; }; },
    emit(user) { listener?.(user); },
    async signIn(email, password) { this.signIns.push({ email, password }); const user = fakeUser(); this.emit(user); return user; },
    async signOut() { this.signOuts++; this.emit(null); },
  };
}
function fixture(t, { user = fakeUser(), status = 200, error, fetchImpl, timeoutMs } = {}) {
  const dom = new JSDOM(html, { url: `https://nexo-hub.web.app${pathname}` });
  const auth = fakeAuth(user);
  const requests = [];
  const flow = createPairingFlow({ pathname, auth, timeoutMs,
    fetchImpl: fetchImpl ?? (async (url, options) => {
      requests.push({ url, options });
      return { status, async json() { return status === 200 ? { status: 'approved' } : { error }; } };
    }),
  });
  const document = dom.window.document;
  mountPairPage(document, flow);
  flow.start();
  t.after(() => { flow.destroy(); dom.window.close(); });
  return { flow, auth, requests, document, user, dom };
}

test('reconoce /pair/:pairingId y rechaza enlaces incompletos o rutas distintas', () => {
  assert.equal(pairingIdFromPath(pathname), id);
  assert.equal(pairingIdFromPath(`${pathname}/`), id);
  for (const route of ['/', '/pair/', '/pair/123', `/other/${id}`, `${pathname}/approve`, '/pair/' + 'z'.repeat(48)]) {
    assert.equal(pairingIdFromPath(route), null);
  }
});

test('sin sesión pide login y oculta el formulario de código', t => {
  const { flow, document } = fixture(t, { user: null });
  assert.equal(flow.snapshot().phase, 'login-required');
  assert.equal(document.getElementById('login-form').hidden, false);
  assert.equal(document.getElementById('pair-form').hidden, true);
  assert.equal(document.getElementById('login-button').disabled, false);
});

test('restaura la sesión válida sin volver a pedir login', t => {
  const { document, auth } = fixture(t);
  assert.equal(document.getElementById('login-form').hidden, true);
  assert.equal(document.getElementById('pair-form').hidden, false);
  assert.equal(document.getElementById('account-email').textContent, 'persona@example.test');
  assert.equal(auth.signIns.length, 0);
});

test('una sesión anónima no permite aprobar', async t => {
  const { flow, requests, document } = fixture(t, { user: { ...fakeUser(), isAnonymous: true } });
  await flow.approve('123456');
  assert.equal(document.getElementById('login-form').hidden, false);
  assert.equal(requests.length, 0);
});

test('login email/password vacía la contraseña y muestra el código', async t => {
  const { document, dom, auth } = fixture(t, { user: null });
  document.getElementById('email').value = 'persona@example.test';
  document.getElementById('password').value = 'test-only-password';
  document.getElementById('login-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  assert.equal(document.getElementById('password').value, '');
  await tick();
  assert.deepEqual(auth.signIns, [{ email: 'persona@example.test', password: 'test-only-password' }]);
  assert.equal(document.getElementById('pair-form').hidden, false);
  assert.equal(dom.window.localStorage.length, 0);
});

test('aprobación envía pairingId y código con Bearer ID token actualizado', async t => {
  const { flow, requests, user, dom } = fixture(t);
  await flow.approve('012345');
  assert.equal(requests.length, 1);
  const { url, options } = requests[0];
  assert.equal(url, `${PAIRING_API_ORIGIN}/api/v1/tv/pairings/${id}/approve`);
  assert.equal(options.method, 'POST');
  assert.deepEqual(options.headers, { Authorization: 'Bearer test-id-token', 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(options.body), { code: '012345' });
  assert.deepEqual(user.refreshes, [true]);
  assert.equal(options.credentials, 'omit');
  assert.equal(options.cache, 'no-store');
  assert.equal(dom.window.localStorage.length, 0);
  assert.equal(dom.window.sessionStorage.length, 0);
});

test('enviar el formulario de código vincula y muestra el mensaje final', async t => {
  const { document, dom, flow } = fixture(t);
  document.getElementById('code').value = '123456';
  document.getElementById('pair-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  assert.equal(flow.snapshot().phase, 'linking');
  assert.equal(document.getElementById('pair-button').disabled, true);
  await tick();
  assert.equal(document.getElementById('pair-status').textContent, SUCCESS_MESSAGE);
  assert.equal(document.getElementById('pair-form').hidden, true);
  assert.equal(document.getElementById('code').value, '');
});

for (const [status, error, phase, text] of [
  [410, 'pairing_expired', 'expired', /expiró/],
  [409, 'pairing_already_approved', 'already-used', /ya fue aprobado/],
  [409, 'pairing_consumed', 'already-used', /ya se usó/],
  [404, 'pairing_not_found', 'not-found', /No encontramos/],
  [429, 'pairing_locked', 'locked', /bloqueada/],
  [403, 'incorrect_code', 'incorrect-code', /código no es correcto/],
  [403, 'app_access_denied', 'no-access', /no tiene acceso/],
  [403, 'unknown_detail', 'approval-denied', /Revisa el código y el acceso/],
  [403, undefined, 'approval-denied', /Revisa el código y el acceso/],
  [500, 'internal_error', 'server-error', /Inténtalo de nuevo/],
]) {
  test(`${status}/${error ?? 'sin detalle'} muestra ${phase}`, async t => {
    const { flow, document } = fixture(t, { status, error });
    await flow.approve('123456');
    assert.equal(flow.snapshot().phase, phase);
    assert.match(document.getElementById('pair-status').textContent, text);
    assert.equal(document.getElementById('pair-form').hidden, flow.snapshot().terminal);
  });
}

test('401 invalida la sesión y permite volver a autenticar', async t => {
  const { flow, auth, document } = fixture(t, { status: 401, error: 'invalid_id_token' });
  await flow.approve('123456');
  assert.equal(flow.snapshot().phase, 'session-invalid');
  assert.equal(auth.signOuts, 1);
  assert.equal(document.getElementById('login-form').hidden, false);
  assert.equal(document.getElementById('pair-form').hidden, true);
  await flow.signIn('persona@example.test', 'test-only-password');
  assert.equal(flow.snapshot().phase, 'code-entry');
});

test('error de red permite reintentar sin exponer detalles del error', async t => {
  const { flow, document } = fixture(t, { fetchImpl: async () => { throw new Error('test-id-token'); } });
  await flow.approve('123456');
  assert.equal(flow.snapshot().phase, 'network-error');
  assert.equal(document.getElementById('pair-button').disabled, false);
  assert.doesNotMatch(document.getElementById('pair-status').textContent, /test-id-token/);
});

test('cerrar sesión devuelve al login y vacía el código', async t => {
  const { flow, document, dom } = fixture(t);
  document.getElementById('code').value = '123456';
  document.getElementById('sign-out').click();
  await tick();
  assert.equal(flow.snapshot().phase, 'login-required');
  assert.equal(document.getElementById('login-form').hidden, false);
  assert.equal(document.getElementById('code').value, '');
  assert.equal(dom.window.localStorage.length, 0);
});

test('códigos inválidos no solicitan token ni envían petición', async t => {
  const { flow, requests, user } = fixture(t);
  for (const code of ['12345', '1234567', 'abcdef', '123 45']) await flow.approve(code);
  assert.equal(flow.snapshot().phase, 'invalid-code');
  assert.equal(requests.length, 0);
  assert.equal(user.refreshes.length, 0);
});

test('doble envío no duplica peticiones y no se reaprueba después del éxito', async t => {
  const { flow, requests } = fixture(t);
  await Promise.all([flow.approve('123456'), flow.approve('123456')]);
  await flow.approve('123456');
  assert.equal(requests.length, 1);
});

test('descarta una respuesta de aprobación recibida después de cerrar sesión', async t => {
  let resolveResponse;
  const { flow } = fixture(t, { fetchImpl: () => new Promise(resolve => { resolveResponse = resolve; }) });
  const pending = flow.approve('123456');
  await tick();
  await flow.signOut();
  resolveResponse({ status: 200, json: async () => ({ status: 'approved' }) });
  await pending;
  assert.equal(flow.snapshot().phase, 'login-required');
});

test('token que no responde termina en error de red al agotar el tiempo', async t => {
  const user = fakeUser();
  user.getIdToken = () => new Promise(() => {});
  const { flow, requests } = fixture(t, { user, timeoutMs: 10 });
  await flow.approve('123456');
  assert.equal(flow.snapshot().phase, 'network-error');
  assert.equal(requests.length, 0);
});

test('ruta inválida no carga Auth ni ofrece formularios', async t => {
  const dom = new JSDOM(html);
  let authLoads = 0;
  const flow = await bootPairPage({ document: dom.window.document, pathname: '/pair/invalid',
    connectAuth: async () => { authLoads++; return fakeAuth(); } });
  t.after(() => { flow.destroy(); dom.window.close(); });
  assert.equal(authLoads, 0);
  assert.equal(flow.snapshot().phase, 'invalid-route');
  assert.equal(dom.window.document.getElementById('login-form').hidden, true);
});

test('SDK no disponible muestra un error seguro de carga', async t => {
  const dom = new JSDOM(html);
  const flow = await bootPairPage({ document: dom.window.document, pathname,
    connectAuth: async () => { throw new Error('private detail'); } });
  t.after(() => { flow.destroy(); dom.window.close(); });
  assert.equal(flow.snapshot().phase, 'config-error');
  assert.doesNotMatch(dom.window.document.body.textContent, /private detail/);
});

test('adaptador usa Auth del proyecto existente, email/password y persistencia sin localStorage', async () => {
  const calls = [];
  const app = {}, auth = {}, user = fakeUser();
  const appSdk = { getApps: () => [], initializeApp(config) { calls.push(['config', config]); return app; } };
  const authSdk = {
    indexedDBLocalPersistence: 'indexeddb', browserSessionPersistence: 'session', inMemoryPersistence: 'memory',
    initializeAuth(actualApp, options) { assert.equal(actualApp, app); calls.push(['persistence', options.persistence]); return auth; },
    onAuthStateChanged(actualAuth, listener) { assert.equal(actualAuth, auth); listener(user); return () => {}; },
    async signInWithEmailAndPassword(actualAuth, email, password) { assert.equal(actualAuth, auth); calls.push(['login', email, password]); return { user }; },
    async signOut(actualAuth) { assert.equal(actualAuth, auth); calls.push(['logout']); },
  };
  const urls = [];
  const adapter = await connectFirebaseAuth(async url => { urls.push(url); return url.endsWith('/firebase-app.js') ? appSdk : authSdk; });
  adapter.subscribe(actual => assert.equal(actual, user));
  assert.equal(await adapter.signIn('persona@example.test', 'test-only-password'), user);
  await adapter.signOut();
  assert.equal(FIREBASE_CONFIG.projectId, 'nova-star-bd0d9');
  assert.equal(FIREBASE_CONFIG.authDomain, 'nova-star-bd0d9.firebaseapp.com');
  assert.deepEqual(calls, [['config', FIREBASE_CONFIG], ['persistence', ['indexeddb', 'session', 'memory']],
    ['login', 'persona@example.test', 'test-only-password'], ['logout']]);
  assert.ok(urls.every(url => url.startsWith(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/`)));
});
