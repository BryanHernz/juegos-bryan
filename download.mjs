import { createReleaseClient, ReleaseError } from './private-releases.mjs';

const apps = Object.freeze({ novaStar: 'Nova Star', cartonLleno: 'Cartón Lleno' });

export function appFromDownloadPath(pathname) {
  const match = /^\/download\/(novaStar|cartonLleno)\/?$/.exec(pathname);
  return match ? match[1] : null;
}

export function initDownloadPage({ document, window, auth,
  clientFor = user => createReleaseClient({ user }), navigate = url => window.location.assign(url) }) {
  const app = appFromDownloadPath(window.location.pathname);
  const card = document.getElementById('download-card');
  const title = document.getElementById('download-title');
  const message = document.getElementById('download-message');
  const form = document.getElementById('download-login');
  const retry = document.getElementById('download-retry');
  const logout = document.getElementById('download-logout');
  let currentUser = null, revision = 0, busy = false;

  function render(state, text, status = '') {
    card.dataset.state = state;
    card.dataset.status = String(status);
    message.textContent = text;
    form.hidden = state !== 'login';
    retry.hidden = !currentUser || !['complete', 'error', 'denied'].includes(state);
    retry.textContent = state === 'complete' ? 'Volver a descargar' : 'Reintentar';
    retry.disabled = busy;
    logout.hidden = !currentUser && state !== 'logout-error';
    logout.disabled = state === 'closing';
  }

  async function signOut() {
    ++revision;
    currentUser = null;
    busy = false;
    render('closing', 'Cerrando sesión…');
    const run = revision;
    try {
      await auth.signOut();
      if (run === revision) await session(null);
    } catch {
      if (run === revision) render('logout-error', 'No pudimos cerrar la sesión. Inténtalo de nuevo.');
    }
  }

  async function download() {
    if (!app || !currentUser || busy) return;
    const user = currentUser, run = ++revision;
    const valid = () => run === revision && currentUser === user;
    busy = true;
    render('verifying', 'Verificando acceso…');
    try {
      const client = clientFor(user);
      // Recheck current server-owned access on every attempt; never cache it locally.
      const portal = await client.portal();
      if (!valid()) return;
      if (!portal.apps.includes(app)) throw new ReleaseError(403);
      render('preparing', 'Preparando el APK para tu teléfono…');
      const release = await client.latest(app);
      if (!valid()) return;
      const assetId = release.recommendations.phone;
      const result = await client.download(app, release.version, assetId);
      if (!valid()) return;
      // The temporary URL exists only in this request; never attach it to the DOM or persist it.
      navigate(result.url);
      busy = false;
      render('complete', `Descarga solicitada: ${apps[app]} ${release.version}. Si no comienza, pulsa «Volver a descargar».`);
    } catch (error) {
      if (!valid()) return;
      busy = false;
      if (error.status === 401) {
        await signOut();
        if (!currentUser && card.dataset.state === 'login') {
          render('login', 'La sesión dejó de ser válida. Vuelve a iniciar sesión.', 401);
        }
      } else if (error.status === 403) {
        render('denied', 'Tu cuenta no tiene acceso a esta aplicación.', 403);
      } else if (error.status === 404) {
        render('error', 'La descarga solicitada no está disponible.', 404);
      } else {
        render('error', 'No pudimos preparar la descarga. Comprueba tu conexión y reintenta.');
      }
    }
  }

  async function session(user) {
    if (!app) return;
    if (user && user === currentUser) return;
    ++revision;
    busy = false;
    currentUser = user;
    if (!user) { render('login', 'Inicia sesión con tu cuenta Nexo para descargar.'); return; }
    if (user.isAnonymous) { await signOut(); return; }
    await download();
  }

  if (!app) {
    render('not-found', '404 · Aplicación no encontrada.', 404);
    return { session, stop: () => {} };
  }
  title.textContent = `Descargar ${apps[app]}`;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    const password = form.elements.password.value;
    form.elements.password.value = '';
    try { await auth.signIn(form.elements.email.value.trim(), password); }
    catch {
      if (!currentUser) render('login', 'No se pudo iniciar sesión. Revisa tus datos e inténtalo nuevamente.');
    } finally { button.disabled = false; }
  });
  retry.addEventListener('click', () => void download());
  logout.addEventListener('click', () => void signOut());
  const unsubscribe = auth.subscribe(user => void session(user), () => {
    ++revision;
    currentUser = null;
    busy = false;
    render('login', 'No pudimos restaurar la sesión. Vuelve a iniciar sesión.');
  });
  return { session, download, signOut, stop: () => { ++revision; unsubscribe(); } };
}
