import { APPS } from './config.mjs?v=private-v2';

export function allowedApps(keys) {
  if (!Array.isArray(keys) || keys.some(key => !APPS.some(app => app.key === key))) return [];
  return APPS.filter(app => keys.includes(app.key));
}

export function restrictProducts(document, apps) {
  // Presentation only: keep the authenticated server template and its access gate.
  for (const cta of document.querySelectorAll('.header .header-cta')) cta.remove();
  const logout = document.getElementById('portal-logout');
  logout?.classList.remove('button', 'primary');
  logout?.classList.add('quiet-action');
  for (const button of document.querySelectorAll('[data-download="tv"]')) {
    const label = button.querySelector('strong') ?? button.querySelector(':scope > span');
    if (!label || label.querySelector('.platform-subline')) continue;
    label.firstChild.textContent = 'Android TV';
    const line = document.createElement('span'); line.className = 'platform-subline'; line.textContent = '/ Google TV';
    label.insertBefore(line, label.querySelector('small'));
  }
  const downloadsIntro = document.querySelector('.downloads-intro > p');
  if (downloadsIntro) downloadsIntro.textContent = 'Elige Windows, Android o Android TV / Google TV.';
  const first = apps[0]?.id;
  for (const link of document.querySelectorAll('.scroll-cue')) link.setAttribute('href', `#${first}`);
  const allowed = new Set(apps.map(app => app.id));
  for (const app of APPS.filter(app => !allowed.has(app.id))) {
    for (const node of document.querySelectorAll(`[data-app="${app.id}"], [data-product="${app.id}"], a[href="#${app.id}"]`)) node.remove();
  }
  const description = document.querySelector('.hero-description');
  if (description) description.textContent = `Descubre ${apps.map(app => app.name).join(' y ')}. Elige tu pantalla y empieza a jugar.`;
  if (apps.length === 1) {
    document.querySelector('.art-aside')?.remove();
    document.querySelector('.hero-domain').textContent = apps[0].key === 'novaStar' ? 'KARAOKE' : 'BINGO';
  }
}

export function initPortalGate({ document, window, auth, onAuthorized, reload = () => window.location.reload() }) {
  const shell = document.getElementById('portal-content');
  const gate = document.getElementById('portal-login');
  const form = document.getElementById('portal-login-form');
  const message = document.getElementById('portal-message');
  let revision = 0, visibleIdentity, currentUser;
  function closed(text) {
    shell.hidden = true; gate.hidden = false; message.textContent = text;
    for (const link of shell.querySelectorAll('[data-download]')) link.removeAttribute('href');
    document.querySelector('dialog[open]')?.close();
  }
  async function session(user) {
    currentUser = user;
    const run = ++revision;
    closed(user ? 'Verificando acceso…' : 'Inicia sesión con tu cuenta Nexo.');
    document.getElementById('portal-gate-logout').hidden = !user;
    form.hidden = Boolean(user);
    if (!user) return;
    try {
      if (user.isAnonymous) { await auth.signOut(); return; }
      await user.getIdToken(true);
      const content = await auth.loadPortal(user);
      const apps = allowedApps(content.apps);
      if (run !== revision) return;
      if (!apps.length) { closed('Tu cuenta no tiene acceso a aplicaciones de Nexo.'); return; }
      const identity = `${user.uid}:${apps.map(app => app.key).join(',')}`;
      if (visibleIdentity && identity !== visibleIdentity) { reload(); return; }
      if (!visibleIdentity) {
        // HTML comes exclusively from our authenticated, server-owned template;
        // release notes and all user data are rendered separately as text.
        shell.innerHTML = content.html;
        restrictProducts(document, apps);
        visibleIdentity = identity;
        document.getElementById('portal-logout').addEventListener('click', signOut);
        document.getElementById('year').textContent = String(new Date().getFullYear());
        for (const button of document.querySelectorAll('[data-refresh]')) button.addEventListener('click', reload);
        await onAuthorized({ user, apps, valid: () => currentUser?.uid === user.uid && visibleIdentity === identity && !shell.hidden,
          onDenied: async status => {
            ++revision;
            closed(status === 401 ? 'La sesión dejó de ser válida. Vuelve a iniciar sesión.' : 'El acceso ya no está disponible.');
            if (status === 401) await auth.signOut();
          } });
      }
      if (run !== revision) return;
      shell.hidden = false; gate.hidden = true;
    } catch (error) {
      if (run === revision) {
        closed(error.status === 403 ? 'Tu cuenta no tiene acceso a aplicaciones de Nexo.' :
          'No pudimos verificar tu acceso. Reintenta cuando haya conexión.');
        if (error.status === 401) await auth.signOut();
      }
    }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button'); button.disabled = true;
    const password = form.elements.password.value;
    form.elements.password.value = '';
    message.removeAttribute('data-error');
    for (const input of form.querySelectorAll('input')) input.removeAttribute('aria-invalid');
    try { await auth.signIn(form.elements.email.value.trim(), password); }
    catch {
      message.textContent = 'No se pudo iniciar sesión. Revisa tus datos e inténtalo nuevamente.';
      message.dataset.error = 'true';
      for (const input of form.querySelectorAll('input')) input.setAttribute('aria-invalid', 'true');
    }
    finally { button.disabled = false; }
  });
  const signOut = async () => { ++revision; closed('Sesión cerrada.'); await auth.signOut(); reload(); };
  document.getElementById('portal-gate-logout').addEventListener('click', signOut);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentUser) void session(currentUser);
  });
  const unsubscribe = auth.subscribe(user => void session(user), () => {
    ++revision; currentUser = undefined; closed('No pudimos restaurar la sesión.');
  });
  return { session, stop: () => { ++revision; unsubscribe(); } };
}
