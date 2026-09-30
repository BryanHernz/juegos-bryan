import { connectFirebaseAuth } from './pair-auth.mjs';
import { createPairingFlow, pairingIdFromPath } from './pairing.mjs';

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
    login.hidden = state.authenticated || state.terminal;
    account.hidden = !state.authenticated;
    approve.hidden = !state.authenticated || state.terminal;
    document.getElementById('account-email').textContent = state.email;
    document.getElementById('login-button').disabled = state.busy;
    email.disabled = password.disabled = state.busy;
    document.getElementById('pair-button').disabled = state.busy || state.terminal;
    code.disabled = state.busy || state.terminal;
    status.textContent = state.message;
    status.dataset.state = state.phase;
    document.getElementById('pair-card').setAttribute('aria-busy', String(state.busy));
    if (!state.authenticated || state.phase === 'success') code.value = '';
    if (!state.authenticated) password.value = '';
  });
}

export async function bootPairPage({ document, pathname, connectAuth = connectFirebaseAuth, fetchImpl } = {}) {
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
  const flow = createPairingFlow({ pathname, auth, fetchImpl });
  mountPairPage(document, flow);
  flow.start();
  return flow;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  void bootPairPage({ document, pathname: window.location.pathname });
}
