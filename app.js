import { APPS, SNAPSHOT_CHECKED_AT } from './config.mjs';
import { safeHttps, snapshotRelease, selectDownloads, assetLabel, formatBytes,
  formatDate, fetchLatest, readCached, writeCached } from './releases.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const state = new Map();
let storage;
try { storage = window.localStorage; } catch { storage = null; }

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function renderRelease(app, release, status, warning = false) {
  const root = document.getElementById(app.id);
  $('[data-version]', root).textContent = release.tag;
  $('[data-date]', root).textContent = formatDate(release.publishedAt);
  const statusElement = $('[data-status]', root);
  statusElement.textContent = status;
  statusElement.classList.toggle('is-warning', warning);
  $('[data-notes-link]', root).href = release.url;
  $('[data-notes]', root).textContent = release.notes.trim() || 'Consulta las notas completas en GitHub.';
  const selected = selectDownloads(release.assets);
  for (const [kind, asset] of Object.entries(selected)) {
    const link = $(`[data-download="${kind}"]`, root);
    if (asset) {
      link.href = asset.url;
      link.removeAttribute('aria-disabled');
      link.removeAttribute('tabindex');
      link.title = asset.name;
      $('[data-size]', link).textContent = formatBytes(asset.size);
    } else {
      link.removeAttribute('href');
      link.setAttribute('aria-disabled', 'true');
      link.setAttribute('tabindex', '-1');
      link.title = 'Este archivo no está publicado en la versión mostrada.';
      $('[data-size]', link).textContent = 'Sin archivo publicado';
    }
  }
  const container = $('[data-assets]', root);
  container.replaceChildren();
  for (const asset of release.assets) {
    const link = document.createElement('a');
    link.className = 'asset-link';
    link.href = asset.url;
    link.rel = 'noopener noreferrer';
    const copy = document.createElement('span');
    copy.append(textElement('strong', '', assetLabel(asset.name)), textElement('small', 'asset-name', asset.name));
    link.append(copy, textElement('span', 'asset-size', formatBytes(asset.size)));
    if (asset.digest) link.title = asset.digest;
    container.append(link);
  }
  $('[data-asset-count]', root).textContent = `${release.assets.length} archivos`;
  root.removeAttribute('aria-busy');
}

async function refresh(app) {
  const root = document.getElementById(app.id);
  const button = $('[data-refresh]', root);
  if (button.disabled) return;
  button.disabled = true;
  button.classList.add('is-loading');
  $('[data-status]', root).textContent = 'Consultando GitHub…';
  try {
    const { release, raw } = await fetchLatest(app);
    state.set(app.id, release);
    writeCached(app, storage, raw);
    renderRelease(app, release, 'Última versión comprobada ahora');
  } catch (error) {
    console.warn(`[releases:${app.id}]`, error.message);
    renderRelease(app, state.get(app.id), `${error.message} Se muestra la última información guardada.`, true);
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
  }
}

for (const app of APPS) {
  const root = document.getElementById(app.id);
  const cached = readCached(app, storage);
  const release = cached?.release || snapshotRelease(app);
  state.set(app.id, release);
  renderRelease(app, release, `Información guardada · ${cached ? formatDate(cached.checkedAt) : formatDate(SNAPSHOT_CHECKED_AT + 'T12:00:00Z')}`, true);
  const webLink = $('[data-web]', root);
  const webUrl = safeHttps(app.web.url);
  $('[data-web-label]', root).textContent = webUrl ? app.web.label : 'Enlace web pendiente';
  $('[data-web-note]', root).textContent = app.web.description;
  if (webUrl) { webLink.href = webUrl; webLink.removeAttribute('aria-disabled'); webLink.removeAttribute('tabindex'); }
  else { webLink.removeAttribute('href'); webLink.setAttribute('aria-disabled', 'true'); webLink.setAttribute('tabindex', '-1'); }
  $('[data-refresh]', root).addEventListener('click', () => refresh(app));
  refresh(app);
}

$('#year').textContent = String(new Date().getFullYear());
document.addEventListener('click', event => {
  const disabled = event.target.closest('a[aria-disabled="true"]');
  if (disabled) event.preventDefault();
});
