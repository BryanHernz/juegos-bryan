'use strict';
const APPS = ['novaStar', 'cartonLleno'];
const ARCHITECTURES = ['x64', 'arm64-v8a', 'armeabi-v7a', 'x86_64', 'universal'];
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{2,159}$/;
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error('invalid_manifest');
}
function validateAsset(a, app, version, stored = true) {
  exact(a, ['id', 'purpose', 'variant', 'platform', 'architecture', 'format', 'versionCode', 'filename', 'size', 'sha256',
    'downloadEndpoint', ...(stored ? ['generation'] : [])]);
  if (!idPattern.test(a.id) || !a.id.startsWith(`${app}-${version}-`) ||
    typeof a.filename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(a.filename) ||
    !Number.isSafeInteger(a.size) || a.size <= 0 || a.size > 4 * 1024 ** 3 ||
    !/^[a-f0-9]{64}$/.test(a.sha256) ||
    a.downloadEndpoint !== `/api/v1/releases/${app}/${version}/download/${a.id}` ||
    (stored && !/^[1-9]\d{0,24}$/.test(a.generation))) throw new Error('invalid_asset');
  if (a.platform === 'windows') {
    if (a.versionCode !== null) throw new Error('invalid_version_code');
    if (!['standard', 'alias'].includes(a.variant) || !['x64', 'universal'].includes(a.architecture) ||
      !((a.purpose === 'installer' && a.format === 'exe') || (a.purpose === 'updater' && a.format === 'zip'))) throw new Error('invalid_windows_asset');
  } else if (a.platform === 'android') {
    if (!Number.isSafeInteger(a.versionCode) || a.versionCode <= 0) throw new Error('invalid_version_code');
    if (a.purpose !== 'package' || a.format !== 'apk' || !['standard', 'phone', 'tv'].includes(a.variant) ||
      !ARCHITECTURES.filter(v => v !== 'x64').includes(a.architecture)) throw new Error('invalid_android_asset');
  } else throw new Error('invalid_platform');
  // Compatibility comes exclusively from explicit fields, never filename.
  return a;
}
function validateManifest(m, app, version) {
  exact(m, ['schemaVersion', 'app', 'version', 'build', 'releasedAt', 'notes', 'recommendations', 'assets']);
  if (!APPS.includes(app) || m.app !== app || m.version !== version || m.schemaVersion !== 1 ||
    !Number.isSafeInteger(m.build) || m.build < 1 ||
    typeof m.releasedAt !== 'string' || !Number.isFinite(Date.parse(m.releasedAt)) || new Date(m.releasedAt).toISOString() !== m.releasedAt ||
    typeof m.notes !== 'string' || m.notes.length > 12000 || !Array.isArray(m.assets) || !m.assets.length || m.assets.length > 32) throw new Error('invalid_manifest');
  const ids = new Set(), selectors = new Set();
  for (const a of m.assets) {
    validateAsset(a, app, version);
    const selector = [a.platform, a.purpose, a.variant, a.architecture].join(':');
    if (ids.has(a.id) || selectors.has(selector)) throw new Error('duplicate_asset');
    ids.add(a.id); selectors.add(selector);
  }
  exact(m.recommendations, ['windows', 'phone', 'tv']);
  for (const target of ['windows', 'phone', 'tv']) {
    const a = m.assets.find(a => a.id === m.recommendations[target]);
    if (!a || (target === 'windows' ? a.platform !== 'windows' || a.purpose !== 'installer' :
      a.platform !== 'android' || a.purpose !== 'package' || a.variant !== target)) throw new Error('invalid_recommendation');
  }
  return m;
}
module.exports = { validateAsset, validateManifest, idPattern };
