import { connectFirebaseAuth } from './pair-auth.mjs';
import { createPairingFlow, pairingIdFromPath, loadPairingMetadata } from './pairing.mjs';

const PAIR_APPEARANCES = Object.freeze({
  novaStar: { name: 'Nova Star', logo: '/assets/nova-star-logo.png', screen: '/assets/screens/nova-duet.webp', accent: '#ffb156', background: '#050a13', tagline: 'Tu voz. Tu escenario.' },
  cartonLleno: { name: 'Cartón Lleno', logo: '/assets/carton-mark.webp', screen: '/assets/screens/carton-75.webp', accent: '#fad703', background: '#f2f0e6', tagline: 'Que empiece la buena suerte.' },
});
export function pairingAppearance(app) {
  return Object.hasOwn(PAIR_APPEARANCES, app) ? { app, ...PAIR_APPEARANCES[app] } :
    { app: 'nexo', name: 'Nexo', logo: '/assets/nexo-mark.svg', screen: null, accent: '#f2eedf', background: '#071018', tagline: '' };
}
export function renderPairExperience(document, state) {
  const product = pairingAppearance(state.app);
  const root = document.getElementById('pair-experience');
  root.dataset.app = product.app; root.dataset.phase = state.phase;
  // Theme only from the allowlisted app returned by real pairing metadata.
  document.body.dataset.app = product.app;
  document.querySelector('meta[name="theme-color"]').content = product.background;
  document.title = product.app === 'nexo' ? 'Vincular dispositivo · Nexo' : `Vincular TV · ${product.name}`;
  document.getElementById('pair-header-logo').src = product.logo;
  document.getElementById('pair-header-name').textContent = product.name;
  document.querySelector('.pair-brand').setAttribute('aria-label', `${product.name} · Portal Nexo`);
  const tagline = document.getElementById('pair-product-tagline');
  tagline.textContent = product.tagline; tagline.hidden = !product.tagline;
  document.querySelector('.pair-carton-balls').hidden = product.app !== 'cartonLleno';
  document.getElementById('pair-product-name').textContent = product.name;
  document.getElementById('pair-product-logo').src = product.logo;
  const screen = document.getElementById('pair-product-screen');
  screen.hidden = !product.screen;
  if (product.screen) { screen.src = product.screen; screen.alt = `Pantalla de ${product.name}`; }
  else { screen.removeAttribute('src'); screen.alt = ''; }
  document.getElementById('pair-neutral-art').hidden = Boolean(product.screen);
  document.getElementById('pair-visual-note').textContent = product.app === 'nexo' ?
    'Una conexión segura, desde Nexo.' : `${product.name}, conectado a tu cuenta Nexo.`;
  const done = state.phase === 'success';
  const ended = state.terminal && !done;
  const title = done ? 'Dispositivo vinculado' : state.phase === 'expired' ? 'El enlace expiró' :
    state.phase === 'consumed' ? 'Dispositivo ya vinculado' : state.phase === 'already-used' ? 'Enlace ya utilizado' :
    state.phase === 'locked' ? 'Vinculación bloqueada' : ended ? 'Revisa la vinculación' :
    product.app === 'nexo' ? 'Vincular dispositivo' : `Vincular ${product.name}`;
  document.getElementById('pair-title').textContent = title;
  document.getElementById('pair-intro').textContent = done ? (product.app === 'nexo' ?
    'Ya puedes volver a tu televisor.' : `${product.name} está listo. Ya puedes volver a tu televisor.`) :
    ended ? 'Revisa tu televisor. Si necesitas otra vinculación, abre un nuevo QR.' :
    'Estás conectando este televisor a tu cuenta Nexo.';
  document.getElementById('pair-stage').textContent = done ? 'CONEXIÓN COMPLETADA' : ended ? 'ESTADO DEL DISPOSITIVO' :
    state.busy ? (state.phase === 'linking' ? 'CONECTANDO TU TV' : 'PREPARANDO CONEXIÓN') :
    state.authenticated ? 'PASO 02 · CONFIRMA TU TV' : 'PASO 01 · TU CUENTA NEXO';
  document.getElementById('pair-result-icon').hidden = !done;
  for (const [id, current, complete] of [
    ['pair-step-account', !state.authenticated && !state.terminal, state.authenticated || done],
    ['pair-step-code', state.authenticated && !state.terminal, done],
    ['pair-step-done', done, done],
  ]) {
    const step = document.getElementById(id);
    step.classList.toggle('is-current', current); step.classList.toggle('is-done', complete);
    if (current) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
  }
}

export function mountPairPage(document, flow) {
  const login = document.getElementById('login-form');
  const account = document.getElementById('account');
  const email = document.getElementById('email');
  const password = document.getElementById('password');
  const code = document.getElementById('code');
  const approve = document.getElementById('pair-form');
  const status = document.getElementById('pair-status');
  const signOut = document.getElementById('sign-out');

  login.addEventListener('submit', event => {
    event.preventDefault();
    const secret = password.value;
    password.value = '';
    void flow.signIn(email.value.trim(), secret);
  });
  approve.addEventListener('submit', event => {
    event.preventDefault();
    void flow.approve(code.value.trim());
  });
  signOut.addEventListener('click', () => { code.value = ''; void flow.signOut(); });

  return flow.subscribe(state => {
    renderPairExperience(document, state);
    login.hidden = state.authenticated || state.terminal || state.phase === 'checking';
    account.hidden = !state.authenticated;
    approve.hidden = !state.authenticated || state.terminal || state.phase === 'checking';
    document.getElementById('account-email').textContent = state.email;
    document.getElementById('login-button').disabled = state.busy;
    email.disabled = password.disabled = state.busy;
    document.getElementById('pair-button').disabled = state.busy || state.terminal;
    code.disabled = state.busy || state.terminal;
    status.textContent = state.message;
    status.dataset.state = state.phase;
    document.getElementById('pair-retry').hidden = !['metadata-error', 'config-error', 'network-error'].includes(state.phase);
    code.setAttribute('aria-invalid', String(['invalid-code', 'incorrect-code'].includes(state.phase)));
    document.getElementById('pair-card').setAttribute('aria-busy', String(state.busy));
    if (!state.authenticated || state.phase === 'success') code.value = '';
    if (!state.authenticated) password.value = '';
  });
}

export async function bootPairPage({ document, pathname, connectAuth = connectFirebaseAuth, fetchImpl,
  loadMetadata = id => loadPairingMetadata(id, { fetchImpl }) } = {}) {
  let auth;
  if (pairingIdFromPath(pathname)) {
    try { auth = await connectAuth(); }
    catch {
      const flow = createPairingFlow({ pathname, auth: null });
      mountPairPage(document, flow);
      flow.failInitialization();
      return flow;
    }
  }
  const flow = createPairingFlow({ pathname, auth, fetchImpl, loadMetadata });
  mountPairPage(document, flow);
  flow.start();
  return flow;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  void bootPairPage({ document, pathname: window.location.pathname });
}
