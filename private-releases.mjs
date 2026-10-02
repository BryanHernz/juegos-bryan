import { PAIRING_API_ORIGIN } from './pair-config.mjs';

export class ReleaseError extends Error {
  constructor(status) { super('release_request_failed'); this.status = status; }
}
const APPS = ['novaStar', 'cartonLleno'];
const versionPattern = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
export function validateRelease(value, app) {
  if (!value || value.schemaVersion !== 1 || value.app !== app || !versionPattern.test(value.version) ||
    !Number.isSafeInteger(value.build) || value.build < 1 || typeof value.notes !== 'string' ||
    !Array.isArray(value.assets) || !value.assets.length || value.assets.length > 32 || !value.recommendations) throw new ReleaseError(503);
  const ids = new Set();
  for (const a of value.assets) {
    if (!a || typeof a.id !== 'string' || !a.id.startsWith(`${app}-${value.version}-`) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{2,159}$/.test(a.id) || ids.has(a.id) ||
      !['windows', 'android'].includes(a.platform) || !['installer', 'updater', 'package'].includes(a.purpose) ||
      !['standard', 'alias', 'phone', 'tv'].includes(a.variant) ||
      !['x64', 'arm64-v8a', 'armeabi-v7a', 'x86_64', 'universal'].includes(a.architecture) ||
      !Number.isSafeInteger(a.size) || a.size < 1 || !/^[a-f0-9]{64}$/.test(a.sha256) ||
      !/^[1-9]\d{0,24}$/.test(a.generation) ||
      a.downloadEndpoint !== `/api/v1/releases/${app}/${value.version}/download/${a.id}` || 'url' in a || 'signedUrl' in a) throw new ReleaseError(503);
    if (typeof a.filename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(a.filename) ||
      (a.platform === 'windows' ? a.versionCode !== null || !['standard', 'alias'].includes(a.variant) ||
        !['x64', 'universal'].includes(a.architecture) || !((a.purpose === 'installer' && a.format === 'exe') ||
          (a.purpose === 'updater' && a.format === 'zip')) : !Number.isSafeInteger(a.versionCode) || a.versionCode <= 0 ||
        a.purpose !== 'package' || a.format !== 'apk' || !['standard', 'phone', 'tv'].includes(a.variant) ||
        a.architecture === 'x64')) throw new ReleaseError(503);
    ids.add(a.id);
  }
  for (const target of ['windows', 'phone', 'tv']) {
    const asset = value.assets.find(a => a.id === value.recommendations[target]);
    if (!asset || (target === 'windows' ? asset.platform !== 'windows' || asset.purpose !== 'installer' :
      asset.platform !== 'android' || asset.purpose !== 'package' || asset.variant !== target)) throw new ReleaseError(503);
  }
  return value;
}
export function createReleaseClient({ user, fetchImpl = fetch, origin = PAIRING_API_ORIGIN }) {
  async function call(path, method = 'GET') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const token = await user.getIdToken();
      const response = await fetchImpl(`${origin}${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body: '{}' } : {}),
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
      });
      if (!response.ok) throw new ReleaseError(response.status);
      return await response.json();
    } finally { clearTimeout(timeout); }
  }
  return {
    async portal() {
      const result = await call('/api/v1/portal');
      if (!result || typeof result.html !== 'string' || result.html.length > 100000 ||
        !Array.isArray(result.apps) || !result.apps.length || result.apps.some(app => !APPS.includes(app))) throw new ReleaseError(503);
      return result;
    },
    async latest(app) {
      if (!APPS.includes(app)) throw new ReleaseError(400);
      return validateRelease(await call(`/api/v1/releases/${app}/latest`), app);
    },
    async download(app, version, assetId) {
      if (!APPS.includes(app) || !versionPattern.test(version) || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,159}$/.test(assetId)) throw new ReleaseError(400);
      const result = await call(`/api/v1/releases/${app}/${version}/download/${assetId}`, 'POST');
      let url;
      try { url = new URL(result.url); } catch { throw new ReleaseError(503); }
      const expiry = Date.parse(result.expiresAt);
      if (url.protocol !== 'https:' || url.hostname !== 'storage.googleapis.com' || url.username || url.password ||
        !url.searchParams.has('X-Goog-Signature') || !Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 310000) throw new ReleaseError(503);
      return result;
    },
  };
}
