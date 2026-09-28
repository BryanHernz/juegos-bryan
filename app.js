import { initExperience } from './experience.mjs';
import { APPS, SNAPSHOT_CHECKED_AT } from './config.mjs';
import { safeHttps, snapshotRelease, selectDownloads, assetLabel, formatBytes,
  formatDate, fetchLatest, readCached, writeCached } from './releases.mjs';

initExperience();
const all = (selector, root = document) => [...root.querySelectorAll(selector)];
const roots = app => all(`[data-app="${app.id}"]`);
const states = new Map();
const busy = new Set();
let storage;
try { storage = window.localStorage; } catch { storage = null; }

function setText(root, selector, value) {
  for (const item of all(selector, root)) item.textContent = value;
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
function setLink(link, href, title = '') {
  link.title = title;
  if (href) {
    link.href = href;
    link.removeAttribute('aria-disabled');
    link.removeAttribute('tabindex');
  } else {
    link.removeAttribute('href');
    link.setAttribute('aria-disabled', 'true');
    link.tabIndex = -1;
  }
}
function render(app, release, status, warning = false) {
  const selected = selectDownloads(release.assets);
  const web = safeHttps(app.web.url);
  for (const root of roots(app)) {
    setText(root, '[data-version]', release.tag);
    setText(root, '[data-date]', formatDate(release.publishedAt));
    setText(root, '[data-status]', status);
    for (const item of all('[data-status]', root)) item.classList.toggle('is-warning', warning);
    setText(root, '[data-notes]', release.notes.trim() || 'Las notas completas están en la publicación.');
    setText(root, '[data-asset-count]', `${release.assets.length} archivos`);
    for (const link of all('[data-notes-link]', root)) setLink(link, release.url);
    for (const [kind, asset] of Object.entries(selected)) {
      for (const link of all(`[data-download="${kind}"]`, root)) {
        setLink(link, asset?.url, asset?.name || 'No hay un archivo publicado para esta variante.');
        setText(link, '[data-size]', asset ? formatBytes(asset.size) : 'Aún no publicado');
      }
    }
    for (const link of all('[data-web]', root)) setLink(link, web, app.web.description);
    setText(root, '[data-web-label]', web ? (app.id === 'nova-star' ? 'Abrir micrófono web' : app.web.label) : 'Web pendiente');
    setText(root, '[data-web-note]', app.web.description);
    for (const container of all('[data-assets]', root)) {
      const fragment = document.createDocumentFragment();
      for (const asset of release.assets) {
        const link = document.createElement('a');
        link.className = 'asset-link';
        link.href = asset.url;
        link.rel = 'noopener noreferrer';
        const copy = document.createElement('span');
        copy.append(element('strong', '', assetLabel(asset.name)), element('small', 'asset-name', asset.name));
        link.append(copy, element('span', 'asset-size', formatBytes(asset.size)));
        if (asset.digest) link.title = asset.digest;
        fragment.append(link);
      }
      container.replaceChildren(fragment);
    }
  }
}
async function refresh(app) {
  if (busy.has(app.id)) return;
  busy.add(app.id);
  const buttons = roots(app).flatMap(root => all('[data-refresh]', root));
  for (const button of buttons) { button.disabled = true; button.classList.add('is-loading'); }
  for (const root of roots(app)) setText(root, '[data-status]', 'Consultando la publicación…');
  try {
    const { release, raw } = await fetchLatest(app, { timeoutMs: 9000 });
    states.set(app.id, release);
    writeCached(app, storage, raw);
    render(app, release, 'Versión comprobada ahora en GitHub.');
  } catch (error) {
    console.warn(`[releases:${app.id}] ${error.message}`);
    render(app, states.get(app.id), `${error.message} Mostrando información guardada, no verificada ahora.`, true);
  } finally {
    busy.delete(app.id);
    for (const button of buttons) { button.disabled = false; button.classList.remove('is-loading'); }
  }
}
for (const app of APPS) {
  const cached = readCached(app, storage);
  const release = cached?.release || snapshotRelease(app);
  states.set(app.id, release);
  const checked = cached ? formatDate(cached.checkedAt) : formatDate(`${SNAPSHOT_CHECKED_AT}T12:00:00Z`);
  render(app, release, `Información guardada · ${checked}`, true);
  for (const root of roots(app)) {
    for (const button of all('[data-refresh]', root)) button.addEventListener('click', () => refresh(app));
  }
  void refresh(app);
}
document.querySelector('#year').textContent = String(new Date().getFullYear());
document.addEventListener('click', event => {
  if (event.target.closest('a[aria-disabled="true"]')) event.preventDefault();
});
