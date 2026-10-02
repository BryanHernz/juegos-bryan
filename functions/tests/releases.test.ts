import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createHttpApp } from '../src/http';
import { PairingService } from '../src/tv/pairing';
import { firestoreStore } from '../src/tv/firestore';
import { fakeFirestore } from './fake-firestore';
import { Asset, assetPath, digest, Manifest, validateManifest } from '../src/releases/manifest';
import { DOWNLOAD_TTL_MS, ReleaseService, ReleaseStorage } from '../src/releases/service';
import { readFileSync } from 'node:fs';

function fixture() {
  const clock = Date.parse('2026-10-01T12:00:00.000Z');
  const db = fakeFirestore(() => clock);
  const auth = {
    verifyIdToken: vi.fn(async (token: string) => {
      if (['invalid', 'expired', 'revoked'].includes(token)) throw new Error('private_provider_detail');
      return { uid: 'user', firebase: { sign_in_provider: token === 'anonymous' ? 'anonymous' : 'password' } };
    }),
    getUser: vi.fn(async () => ({ uid: 'user', disabled: false, providerData: [{ providerId: 'password' }] })),
    createCustomToken: vi.fn(async () => 'unused'),
  };
  let access: { active: boolean; apps: { novaStar: boolean; cartonLleno: boolean } } | undefined =
    { active: true, apps: { novaStar: true, cartonLleno: false } };
  const getAccess = vi.fn(async () => access);
  const manifest: Manifest = { schemaVersion: 1, app: 'novaStar', version: '1.0.27', build: 28,
    releasedAt: '2026-10-01T00:00:00.000Z', notes: 'Local test fixture',
    recommendations: { windows: 'novaStar-1.0.27-installer', phone: 'novaStar-1.0.27-phone', tv: 'novaStar-1.0.27-tv' },
    assets: [
      ['installer', 'windows', 'installer', 'standard', 'x64', 'exe'],
      ['phone', 'android', 'package', 'phone', 'arm64-v8a', 'apk'],
      ['tv', 'android', 'package', 'tv', 'armeabi-v7a', 'apk'],
      ['updater', 'windows', 'updater', 'standard', 'x64', 'zip'],
      ['arm64', 'android', 'package', 'standard', 'arm64-v8a', 'apk'],
      ['armv7', 'android', 'package', 'standard', 'armeabi-v7a', 'apk'],
      ['x86', 'android', 'package', 'standard', 'x86_64', 'apk'],
    ].map(([suffix, platform, purpose, variant, architecture, format], i) => ({
      id: `novaStar-1.0.27-${suffix}`, platform, purpose, variant, architecture, format, versionCode: platform === 'windows' ? null : 3029,
      filename: `artifact-${i}.bin`, size: 100, sha256: 'a'.repeat(64), generation: String(i + 1),
      downloadEndpoint: `/api/v1/releases/novaStar/1.0.27/download/novaStar-1.0.27-${suffix}`,
    })) as Asset[] };
  const bytes = Buffer.from(JSON.stringify(manifest));
  const objects = new Map([
    ['releases/novaStar/1.0.27/manifest.json', { bytes, sha256: digest(bytes), generation: '10' }],
    ['releases/novaStar/latest.json', { bytes: Buffer.from(JSON.stringify({ schemaVersion: 1, app: 'novaStar',
      version: '1.0.27', manifestSha256: digest(bytes), manifestGeneration: '10', updatedAt: '2026-10-01T00:00:00.000Z' })),
    sha256: '', generation: '11' }],
  ]);
  const storage: ReleaseStorage = {
    read: vi.fn(async path => objects.get(path) ?? null),
    metadata: vi.fn(async (_path, generation) => ({ size: 100, sha256: 'a'.repeat(64), generation })),
    sign: vi.fn(async () => 'https://storage.googleapis.com/private/artifact?X-Goog-Signature=test'),
  };
  const pointer = objects.get('releases/novaStar/latest.json')!;
  pointer.sha256 = digest(pointer.bytes);
  const releases = new ReleaseService({ auth, access: getAccess, storage, now: () => clock });
  const pairing = new PairingService({ auth, store: firestoreStore(db.db), codeSecret: 'local-test-only-secret-never-used-in-production', portalUrl: 'https://nexo.test' });
  const app = createHttpApp(pairing, { releases, portalTemplate: () => readFileSync('portal-content.html', 'utf8') });
  return { app, auth, getAccess, storage, manifest, objects, clock,
    setAccess: (value: typeof access) => { access = value; },
    get: (path = 'novaStar/latest', token = 'valid') => request(app).get(`/api/v1/releases/${path}`).set('Authorization', `Bearer ${token}`),
    download: (id = 'novaStar-1.0.27-installer') => request(app).post(`/api/v1/releases/novaStar/1.0.27/download/${id}`)
      .set('Authorization', 'Bearer valid').send({}),
  };
}
describe('private releases API', () => {
  it('delivers private HTML only after Auth/access, filtering unauthorized products on the server', async () => {
    const f = fixture();
    expect((await request(f.app).get('/api/v1/portal')).status).toBe(401);
    const response = await request(f.app).get('/api/v1/portal').set('Authorization', 'Bearer valid');
    expect(response.status).toBe(200);
    expect(response.body.apps).toEqual(['novaStar']);
    expect(response.body.html).toContain('Nova Star');
    expect(response.body.html).not.toMatch(/Cartón Lleno|data-app="carton-lleno"|carton-75/);
    f.setAccess({ active: false, apps: { novaStar: true, cartonLleno: false } });
    expect((await request(f.app).get('/api/v1/portal').set('Authorization', 'Bearer valid')).status).toBe(403);
  });
  it('returns authorized latest, portable schema, no signed URL/storage/admin fields', async () => {
    const f = fixture(), res = await f.get();
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ app: 'novaStar', version: '1.0.27', build: 28 });
    expect(res.body.assets).toHaveLength(7);
    expect(res.body.assets[0].downloadEndpoint).toBe('/api/v1/releases/novaStar/1.0.27/download/novaStar-1.0.27-installer');
    expect(JSON.stringify(res.body)).not.toMatch(/https:|bucket|codeHash|signedUrl/);
    expect(f.auth.verifyIdToken).toHaveBeenCalledWith('valid', true);
  });
  it('requires a token', async () => {
    const f = fixture();
    expect((await request(f.app).get('/api/v1/releases/novaStar/latest')).status).toBe(401);
    expect(f.getAccess).not.toHaveBeenCalled();
  });
  it.each(['invalid', 'expired', 'revoked', 'anonymous'])('rejects %s token', async token => {
    const f = fixture(); expect((await f.get(undefined, token)).status).toBe(401);
    expect(f.storage.read).not.toHaveBeenCalled();
  });
  it('rejects a disabled or deleted Auth identity', async () => {
    const f = fixture();
    f.auth.getUser.mockResolvedValueOnce({ uid: 'user', disabled: true, providerData: [{ providerId: 'password' }] });
    expect((await f.get()).status).toBe(401);
    f.auth.getUser.mockRejectedValueOnce(new Error('user-not-found'));
    expect((await f.get()).status).toBe(401);
  });
  it.each(['missing', 'inactive', 'app-false'])('rejects %s access', async condition => {
    const f = fixture();
    f.setAccess(condition === 'missing' ? undefined : { active: condition !== 'inactive',
      apps: { novaStar: condition !== 'app-false', cartonLleno: false } });
    expect((await f.get()).status).toBe(403);
    expect(f.storage.read).not.toHaveBeenCalled();
  });
  it('Nova permission cannot authorize Cartón', async () => {
    const f = fixture(); expect((await f.get('cartonLleno/latest')).status).toBe(403);
    expect(f.storage.read).not.toHaveBeenCalled();
  });
  it('checks access again for the download and fails closed on Firestore failure', async () => {
    const f = fixture(); expect((await f.get()).status).toBe(200);
    f.setAccess({ active: false, apps: { novaStar: true, cartonLleno: false } });
    expect((await f.download()).status).toBe(403);
    f.getAccess.mockRejectedValueOnce(new Error('offline'));
    expect((await f.get()).status).toBe(503);
    expect(f.storage.sign).not.toHaveBeenCalled();
  });
  it.each(['unknown/latest', 'novaStar/01.0.27', 'novaStar/..%2Fsecret'])('rejects invalid app/version/path %s', async path => {
    expect((await fixture().get(path)).status).toBe(400);
  });
  it('rejects query token and invalid platforms; reports nonexistent version', async () => {
    const f = fixture();
    expect((await f.get('novaStar/latest?token=forbidden')).status).toBe(400);
    expect((await f.download('portable')).status).toBe(404);
    expect((await f.download('..%2Fsecret')).status).toBe(400);
    expect((await f.get('novaStar/0.0.1')).status).toBe(404);
  });
  it('signs only the immutable verified object for exactly five minutes', async () => {
    const f = fixture(), res = await f.download();
    expect(res.status).toBe(200);
    expect(Date.parse(res.body.expiresAt) - f.clock).toBe(DOWNLOAD_TTL_MS);
    expect(f.storage.sign).toHaveBeenCalledWith(assetPath(f.manifest, f.manifest.assets[0]), '1', 'artifact-0.bin', f.clock + DOWNLOAD_TTL_MS);
    expect(JSON.stringify(f.manifest)).not.toMatch(/signedUrl|X-Goog|https:/);
  });
  it.each(['cartonLleno-1.0.27-installer', 'novaStar-1.0.28-installer', 'novaStar-1.0.27-no-variant', 'novaStar-1.0.27-arm128'])('never signs a foreign or missing asset %s', async id => {
    const f = fixture(); expect((await f.download(id)).status).toBe(404);
    expect(f.storage.sign).not.toHaveBeenCalled();
  });
  it('selects installer, updater and each Android ABI by explicit asset identity, regardless of filename', async () => {
    const f = fixture();
    for (const a of f.manifest.assets) {
      expect((await f.download(a.id)).status).toBe(200);
      expect(f.storage.sign).toHaveBeenLastCalledWith(assetPath(f.manifest, a), a.generation, a.filename, f.clock + DOWNLOAD_TTL_MS);
    }
    expect(f.manifest.assets.find(a => a.id === f.manifest.recommendations.windows)?.purpose).toBe('installer');
    expect(f.manifest.assets.find(a => a.id === f.manifest.recommendations.phone)?.variant).toBe('phone');
    expect(f.manifest.assets.find(a => a.id === f.manifest.recommendations.tv)?.variant).toBe('tv');
  });
  it('rejects unknown variant/architecture, duplicate selectors and updater as portal default', () => {
    const m = fixture().manifest;
    for (const bad of [{ ...m.assets[1], variant: 'missing' }, { ...m.assets[1], architecture: 'arm128' }]) {
      expect(() => validateManifest({ ...m, assets: [m.assets[0], bad, ...m.assets.slice(2)] }, m.app, m.version)).toThrow();
    }
    const duplicate = { ...m.assets[0], id: 'novaStar-1.0.27-another-installer',
      downloadEndpoint: '/api/v1/releases/novaStar/1.0.27/download/novaStar-1.0.27-another-installer' };
    expect(() => validateManifest({ ...m, assets: [...m.assets, duplicate] }, m.app, m.version)).toThrow('duplicate_asset');
    const updater = m.assets.find(a => a.purpose === 'updater')!;
    expect(() => validateManifest({ ...m, recommendations: { ...m.recommendations, windows: updater.id } }, m.app, m.version)).toThrow('invalid_recommendation');
  });
  it('rejects manipulated manifests, pointers and asset hashes', async () => {
    const f = fixture();
    const key = 'releases/novaStar/1.0.27/manifest.json', original = f.objects.get(key)!;
    f.objects.set(key, { ...original, bytes: Buffer.from('{}') });
    expect((await f.get()).status).toBe(503);
    f.objects.set(key, original);
    f.storage.metadata = vi.fn(async () => ({ size: 100, generation: '1', sha256: 'b'.repeat(64) }));
    expect((await f.download()).status).toBe(503);
    expect(f.storage.sign).not.toHaveBeenCalled();
    const malicious = Buffer.from(JSON.stringify({ ...f.manifest, signedUrl: 'https://evil.test' }));
    f.objects.set(key, { ...original, bytes: malicious, sha256: digest(malicious) });
    expect((await f.get('novaStar/1.0.27')).status).toBe(503);
  });
  it('keeps pairing creation available independently without login', async () => {
    const res = await request(fixture().app).post('/api/v1/tv/pairings').send({ app: 'novaStar' });
    expect(res.status).toBe(201); expect(res.body.pairUrl).toContain('/pair/');
  });
});
