import { PAIRING_API_ORIGIN } from './pair-config.mjs';

export const SUCCESS_MESSAGE = 'Dispositivo vinculado correctamente. Ya puedes volver a la TV.';
const MESSAGES = Object.freeze({
  checking: 'Comprobando sesión…',
  'login-required': 'Inicia sesión para vincular el dispositivo.',
  'signing-in': 'Iniciando sesión…',
  'code-entry': 'Ingresa el código de 6 dígitos que aparece en la TV.',
  linking: 'Vinculando dispositivo…',
  success: SUCCESS_MESSAGE,
  'invalid-route': 'El enlace de vinculación no es válido. Abre un nuevo QR desde la TV.',
  'incorrect-code': 'El código no es correcto. Revisa los 6 dígitos en la TV.',
  'invalid-code': 'Ingresa un código de 6 dígitos.',
  'no-access': 'Tu cuenta no tiene acceso a esta app. Puedes cerrar sesión y usar otra cuenta.',
  'approval-denied': 'No se pudo autorizar la vinculación. Revisa el código y el acceso de tu cuenta.',
  'not-found': 'No encontramos este dispositivo. Abre un nuevo QR desde la TV.',
  'already-used': 'Este dispositivo ya fue aprobado o el enlace ya se usó. Revisa la TV o abre un nuevo QR.',
  expired: 'El enlace de vinculación expiró. Abre un nuevo QR desde la TV.',
  locked: 'La vinculación está bloqueada por demasiados intentos. Abre un nuevo QR desde la TV.',
  'session-invalid': 'Tu sesión no es válida. Vuelve a iniciar sesión.',
  'login-error': 'No pudimos iniciar sesión. Revisa tu correo y contraseña.',
  'login-blocked': 'Demasiados intentos de inicio de sesión. Espera un momento e inténtalo de nuevo.',
  'network-error': 'No se pudo confirmar la vinculación. Revisa tu conexión e inténtalo de nuevo.',
  'server-error': 'No pudimos confirmar la vinculación. Inténtalo de nuevo en unos momentos.',
  'config-error': 'No pudimos cargar el inicio de sesión. Revisa tu conexión y vuelve a cargar esta página.',
  'logout-error': 'No pudimos cerrar la sesión. Revisa tu conexión e inténtalo de nuevo.',
});
const TERMINAL = new Set(['success', 'invalid-route', 'not-found', 'already-used', 'expired', 'locked', 'config-error']);
const BUSY = new Set(['checking', 'signing-in', 'linking']);
const AUTH_INVALID = new Set(['auth/user-token-expired', 'auth/invalid-user-token',
  'auth/user-disabled', 'auth/user-not-found']);

function withAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new DOMException('Solicitud cancelada', 'AbortError'));
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

export function pairingIdFromPath(pathname) {
  return /^\/pair\/([a-f0-9]{48})\/?$/.exec(pathname)?.[1] ?? null;
}

export function approvalFailure(status, detail) {
  if (status === 401) return 'session-invalid';
  if (status === 403) {
    if (detail === 'incorrect_code') return 'incorrect-code';
    if (detail === 'app_access_denied') return 'no-access';
    return 'approval-denied';
  }
  return ({ 404: 'not-found', 409: 'already-used', 410: 'expired', 429: 'locked' })[status] ?? 'server-error';
}

export function createPairingFlow({ pathname, auth, fetchImpl = globalThis.fetch,
  apiOrigin = PAIRING_API_ORIGIN, timeoutMs = 15000 }) {
  const id = pairingIdFromPath(pathname);
  const listeners = new Set();
  let user = null;
  let revision = 0;
  let requestAbort;
  let unsubscribe;
  let phase = id ? 'checking' : 'invalid-route';
  let destroyed = false;

  function snapshot() {
    return Object.freeze({ phase, message: MESSAGES[phase], email: user?.email ?? '',
      authenticated: Boolean(user), busy: BUSY.has(phase), terminal: TERMINAL.has(phase) });
  }
  function emit(next) {
    if (destroyed) return;
    phase = next;
    for (const listener of listeners) listener(snapshot());
  }
  function setUser(nextUser) {
    const next = nextUser && !nextUser.isAnonymous ? nextUser : null;
    const changed = user?.uid !== next?.uid;
    user = next;
    if (changed) {
      revision++;
      requestAbort?.abort();
    }
    if (changed || phase === 'checking' || phase === 'signing-in') {
      emit(user ? 'code-entry' : 'login-required');
    } else {
      // Preserve the reauthentication message when signOut emits a null user.
      emit(phase);
    }
  }
  async function invalidateSession() {
    user = null;
    revision++;
    emit('session-invalid');
    try { await auth.signOut(); } catch { /* Login stays required; never log auth errors. */ }
  }

  return {
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    start() {
      if (!id || !auth || unsubscribe) return;
      unsubscribe = auth.subscribe(setUser, () => emit('config-error'));
    },
    failInitialization() { emit('config-error'); },
    async signIn(email, password) {
      if (!id || user || BUSY.has(phase) || TERMINAL.has(phase)) return;
      emit('signing-in');
      try {
        setUser(await auth.signIn(email, password));
      } catch (error) {
        if (error?.code === 'auth/network-request-failed') emit('network-error');
        else if (error?.code === 'auth/too-many-requests') emit('login-blocked');
        else emit('login-error');
      }
    },
    async signOut() {
      if (!user) return;
      revision++;
      requestAbort?.abort();
      try {
        await auth.signOut();
        user = null;
        emit('login-required');
      } catch { emit('logout-error'); }
    },
    async approve(code) {
      if (!id || !user || BUSY.has(phase) || TERMINAL.has(phase)) return;
      if (!/^\d{6}$/.test(code)) { emit('invalid-code'); return; }
      const currentUser = user;
      const currentRevision = revision;
      const active = () => !destroyed && revision === currentRevision && user?.uid === currentUser.uid;
      const abort = new AbortController();
      requestAbort = abort;
      const timeout = setTimeout(() => abort.abort(), timeoutMs);
      emit('linking');
      try {
        // Force a fresh Firebase ID token. Keep it only in this request's scope.
        const token = await withAbort(currentUser.getIdToken(true), abort.signal);
        if (!active()) return;
        const response = await fetchImpl(`${apiOrigin}/api/v1/tv/pairings/${id}/approve`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }), cache: 'no-store', credentials: 'omit',
          referrerPolicy: 'no-referrer', signal: abort.signal,
        });
        const payload = await response.json().catch(() => null);
        if (!active()) return;
        if (response.status === 200 && payload?.status === 'approved') { emit('success'); return; }
        const failure = approvalFailure(response.status, payload?.error);
        if (failure === 'session-invalid') await invalidateSession();
        else emit(failure);
      } catch (error) {
        if (!active()) return;
        if (AUTH_INVALID.has(error?.code)) await invalidateSession();
        else emit('network-error');
      } finally {
        clearTimeout(timeout);
        if (requestAbort === abort) requestAbort = undefined;
      }
    },
    destroy() {
      destroyed = true;
      revision++;
      requestAbort?.abort();
      unsubscribe?.();
      listeners.clear();
    },
  };
}
