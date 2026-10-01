const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const INSTALLABLE = /\.(apk|exe|msi|msix|msixbundle|zip|dmg|pkg|appimage|deb|rpm|tar\.gz)$/i;

export function safeHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function productWeb(app, companionUrls = []) {
  const web = safeHttps(app.web.url);
  const companions = [app.companion?.url, ...companionUrls].map(safeHttps).filter(Boolean);
  // A companion Hosting origin must never become the game's Web option.
  return web && !companions.some(companion => new URL(web).origin === new URL(companion).origin) ? web : null;
}

export function safeGithub(value, repo, kind = 'asset') {
  if (!REPO_PATTERN.test(repo)) return null;
  const href = safeHttps(value);
  if (!href) return null;
  const url = new URL(href);
  const prefix = `/${repo}/releases/${kind === 'asset' ? 'download/' : 'tag/'}`;
  return url.origin === 'https://github.com' &&
    url.pathname.startsWith(prefix) && !url.search && !url.hash ? href : null;
}

export function normalizeRelease(raw, repo) {
  if (!raw || raw.draft || raw.prerelease || typeof raw.tag_name !== 'string' ||
      !raw.tag_name.trim() || !Array.isArray(raw.assets)) {
    throw new Error('La respuesta no contiene una publicación estable válida.');
  }
  const htmlUrl = safeGithub(raw.html_url, repo, 'release');
  if (!htmlUrl) throw new Error('La publicación no pertenece al repositorio esperado.');
  const assets = raw.assets.flatMap(asset => {
    const url = safeGithub(asset.browser_download_url, repo);
    if (!url || typeof asset.name !== 'string' || !INSTALLABLE.test(asset.name) ||
        (asset.state && asset.state !== 'uploaded') ||
        !Number.isFinite(asset.size) || asset.size <= 0) return [];
    return [{ name: asset.name, size: asset.size, url,
      digest: /^sha256:[a-f0-9]{64}$/i.test(asset.digest || '') ? asset.digest : null }];
  });
  return { tag: raw.tag_name, publishedAt: raw.published_at || '', url: htmlUrl,
    notes: typeof raw.body === 'string' ? raw.body : '', assets };
}

export function snapshotRelease(app) {
  const raw = { ...app.snapshot, assets: app.snapshot.assets.map(([name, size]) => ({
    name, size, state: 'uploaded',
    browser_download_url: `https://github.com/${app.repo}/releases/download/${encodeURIComponent(app.snapshot.tag_name)}/${encodeURIComponent(name)}`
  })) };
  return normalizeRelease(raw, app.repo);
}

export function selectDownloads(assets) {
  const pick = (...patterns) => {
    for (const pattern of patterns) {
      const match = assets.find(asset => pattern.test(asset.name));
      if (match) return match;
    }
    return null;
  };
  // No se sustituye una arquitectura o plataforma por otra.
  return {
    windows: pick(/windows-(?:instalador|installer|setup)\.exe$/i,
      /(?:instalador|installer|setup).*\.exe$/i),
    phone: pick(/-telefono\.apk$/i, /-arm64-v8a\.apk$/i),
    tv: pick(/-tele\.apk$/i, /-armeabi-v7a\.apk$/i)
  };
}

export function assetLabel(name) {
  if (/telefono\.apk$/i.test(name)) return 'Teléfono Android · ARM64';
  if (/tele\.apk$/i.test(name)) return 'Android TV · ARMv7';
  if (/arm64-v8a\.apk$/i.test(name)) return 'Android · ARM64';
  if (/armeabi-v7a\.apk$/i.test(name)) return 'Android · ARMv7';
  if (/x86_64\.apk$/i.test(name)) return 'Android · x86-64';
  if (/\.apk$/i.test(name)) return 'Android · APK';
  if (/\.(exe|msi|msix|msixbundle)$/i.test(name)) return 'Instalador Windows';
  if (/windows.*\.zip$/i.test(name)) return 'Windows portátil';
  if (/\.(dmg|pkg)$/i.test(name)) return 'macOS';
  if (/\.(appimage|deb|rpm|tar\.gz)$/i.test(name)) return 'Linux / archivo';
  return 'Archivo descargable';
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  return `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(bytes / 1048576)} MB`;
}

export function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('es-CL', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Santiago'
  }).format(date);
}

export async function fetchLatest(app, { fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
  if (!REPO_PATTERN.test(app.repo)) throw new Error('Repositorio inválido.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${app.repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      credentials: 'omit', cache: 'no-store', signal: controller.signal
    });
    if (!response.ok) {
      if (response.status === 403 || response.status === 429)
        throw new Error('GitHub ha limitado temporalmente las consultas.');
      if (response.status === 404)
        throw new Error('No hay una publicación pública disponible.');
      throw new Error(`GitHub respondió HTTP ${response.status}.`);
    }
    const raw = await response.json();
    return { release: normalizeRelease(raw, app.repo), raw };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('La consulta a GitHub tardó demasiado.');
    throw error;
  } finally { clearTimeout(timeout); }
}

export function readCached(app, storage, now = Date.now()) {
  try {
    const cached = JSON.parse(storage.getItem(`juegos-bryan:release:v1:${app.id}`));
    const age = now - cached.checkedAt;
    if (!Number.isFinite(age) || age < 0 || age > 7 * 86400000) return null;
    // A still-fresh browser cache must not downgrade the bundled fallback.
    const version = tag => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag || '')?.slice(1).map(Number);
    const minimum = version(app.snapshot.tag_name), current = version(cached.raw?.tag_name);
    if (minimum) {
      if (!current) return null;
      const firstDifference = current.findIndex((part, index) => part !== minimum[index]);
      if (firstDifference >= 0 && current[firstDifference] < minimum[firstDifference]) return null;
    }
    return { release: normalizeRelease(cached.raw, app.repo), checkedAt: cached.checkedAt };
  } catch { return null; }
}

export function writeCached(app, storage, raw, now = Date.now()) {
  try {
    normalizeRelease(raw, app.repo);
    storage.setItem(`juegos-bryan:release:v1:${app.id}`, JSON.stringify({ raw, checkedAt: now }));
  } catch { /* [cache] Almacenamiento local no disponible. */ }
}
