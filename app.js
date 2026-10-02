import { initExperience } from './experience.mjs';
import { initMotion } from './motion.mjs';
import { connectPortal } from './portal-auth.mjs?v=private-v2';
import { initPortalGate } from './portal-gate.mjs?v=private-v3';
import { createReleaseClient } from './private-releases.mjs';

export async function initDownloads({ document, window, apps, user, fetchImpl = fetch,
  valid = () => true, onDenied = () => {}, navigate = url => window.location.assign(url) }) {
  const client = createReleaseClient({ user, fetchImpl });
  async function failure(error, roots) {
    if ([401, 403].includes(error.status)) await onDenied(error.status);
    for (const root of roots) {
      root.querySelector('[data-status]')?.replaceChildren(document.createTextNode('Descarga no disponible. Revisa el acceso o reintenta.'));
    }
  }
  await Promise.all(apps.map(async app => {
    const roots = [...document.querySelectorAll(`[data-app="${app.id}"]`)];
    for (const root of roots) {
      for (const button of root.querySelectorAll('[data-download]')) {
        button.removeAttribute('href'); button.setAttribute('role', 'button');
        button.setAttribute('aria-disabled', 'true'); button.tabIndex = -1;
      }
    }
    try {
      const manifest = await client.latest(app.key);
      if (!valid()) return;
      for (const root of roots) {
        root.querySelector('[data-version]')?.replaceChildren(document.createTextNode(`v${manifest.version}`));
        root.querySelector('[data-notes]')?.replaceChildren(document.createTextNode(manifest.notes));
        root.querySelector('[data-status]')?.replaceChildren(document.createTextNode('Versión disponible para tu cuenta.'));
        root.querySelector('[data-date]')?.replaceChildren(document.createTextNode(new Date(manifest.releasedAt).toLocaleDateString('es')));
        for (const button of root.querySelectorAll('[data-download]')) {
          const asset = manifest.assets.find(item => item.id === manifest.recommendations[button.dataset.download]);
          if (!asset) continue;
          button.setAttribute('aria-disabled', 'false'); button.tabIndex = 0;
          button.querySelector('[data-size]')?.replaceChildren(document.createTextNode(`· ${(asset.size / 1024 ** 2).toFixed(1)} MB`));
          let busy = false;
          const download = async event => {
            event.preventDefault();
            if (busy || !valid()) return;
            busy = true; button.setAttribute('aria-busy', 'true');
            try {
              const response = await client.download(app.key, manifest.version, asset.id);
              if (valid()) navigate(response.url);
            } catch (error) { if (valid()) await failure(error, roots); }
            finally { busy = false; button.removeAttribute('aria-busy'); }
          };
          button.addEventListener('click', download);
          button.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') void download(event);
          });
        }
      }
    } catch (error) { if (valid()) await failure(error, roots); }
  }));
}

if (typeof document !== 'undefined') {
  const disposeLoginMotion = initMotion();
  document.getElementById('portal-retry').addEventListener('click', () => window.location.reload());
  connectPortal().then(auth => initPortalGate({ document, window, auth,
    onAuthorized: context => {
      // Rescan the newly mounted portal; do not leave a controller bound only
      // to the login's screenshots.
      disposeLoginMotion?.();
      initExperience();
      void initDownloads({ document, window, ...context });
    },
  })).catch(() => {
    document.getElementById('portal-message').textContent = 'No pudimos iniciar la conexión. Recarga para reintentar.';
  });
}
