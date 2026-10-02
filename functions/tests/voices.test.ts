import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createHttpApp } from '../src/http';
import { ReleaseService, ReleaseStorage, DOWNLOAD_TTL_MS } from '../src/releases/service';
import { digest } from '../src/releases/manifest';
import { VoiceCatalog, VoiceService } from '../src/voices/service';
import { CATALOG_PATH, voiceObjectPath } from '../voices-contract.cjs';
import { PairingService } from '../src/tv/pairing';
import { firestoreStore } from '../src/tv/firestore';
import { fakeFirestore } from './fake-firestore';

const route = '/api/v1/apps/cartonLleno/voices';
function fixture() {
  let clock = Date.parse('2026-10-02T12:00:00.000Z');
  const auth = {
    verifyIdToken: vi.fn(async (token: string) => {
      if (['invalid', 'revoked', 'expired'].includes(token)) throw new Error('private_token_provider_details');
      return { uid: 'user', firebase: { sign_in_provider: token === 'anonymous' ? 'anonymous' : 'password' } };
    }),
    getUser: vi.fn(async () => ({ uid: 'user', disabled: false, providerData: [{ providerId: 'password' }] })),
    createCustomToken: vi.fn(async () => 'unused'),
  };
  let access = { active: true, apps: { cartonLleno: true, novaStar: true } };
  const catalog: VoiceCatalog = { schemaVersion: 1, app: 'cartonLleno', updatedAt: '2026-10-02T00:00:00.000Z',
    voces: [{ id: 'es-MX-JorgeNeural', name: 'Jorge · mexicano', label: 'Jorge · mexicano', gender: 'M', language: null,
      clips: 1824, version: '90f648d6d8ab', size: 1234, bytes: 1234, sha256: 'a'.repeat(64),
      filename: 'es-MX-JorgeNeural.zip', generation: '123', downloadEndpoint: `${route}/es-MX-JorgeNeural/download` }] };
  const stored = () => { const bytes = Buffer.from(JSON.stringify(catalog)); return { bytes, sha256: digest(bytes), generation: '100' }; };
  const storage: ReleaseStorage = {
    read: vi.fn(async () => stored()),
    metadata: vi.fn(async () => ({ size: 1234, sha256: 'a'.repeat(64), generation: '123' })),
    sign: vi.fn(async () => 'https://storage.googleapis.com/private/voice.zip?X-Goog-Signature=test'),
  };
  const releases = new ReleaseService({ auth, storage, access: async () => access });
  const voices = new VoiceService(storage, () => clock);
  const pairing = new PairingService({ auth, store: firestoreStore(fakeFirestore(() => clock).db),
    codeSecret: 'synthetic-test-secret-at-least-thirty-two-bytes', portalUrl: 'https://nexo.test' });
  const app = createHttpApp(pairing, { releases, voices });
  return { app, auth, storage, catalog, releases,
    get: (token = 'valid') => request(app).get(route).set('Authorization', `Bearer ${token}`),
    download: (id = catalog.voces[0].id, token = 'valid') => request(app).post(`${route}/${id}/download`).set('Authorization', `Bearer ${token}`).send({}),
    setAccess: (value: typeof access) => { access = value; },
    advance: (ms: number) => { clock += ms; }, now: () => clock,
  };
}

describe('private Cartón voice catalog and downloads', () => {
  it('requires Authorization on both endpoints before reading Storage', async () => {
    const f = fixture();
    expect((await request(f.app).get(route)).status).toBe(401);
    expect((await request(f.app).post(`${route}/es-MX-JorgeNeural/download`).send({})).status).toBe(401);
    expect(f.storage.read).not.toHaveBeenCalled();
  });
  it.each(['invalid', 'expired', 'revoked', 'anonymous'])('rejects %s identity on both endpoints', async token => {
    const f = fixture();
    expect((await f.get(token)).status).toBe(401);
    expect((await f.download(undefined, token)).status).toBe(401);
    expect(f.storage.read).not.toHaveBeenCalled();
    expect(f.auth.verifyIdToken).toHaveBeenCalledWith(token, true);
  });
  it('rejects disabled/deleted accounts even with a decoded ID token', async () => {
    const f = fixture();
    f.auth.getUser.mockResolvedValueOnce({ uid: 'user', disabled: true, providerData: [{ providerId: 'password' }] });
    expect((await f.get()).status).toBe(401);
    f.auth.getUser.mockRejectedValueOnce(new Error('deleted_user'));
    expect((await f.download()).status).toBe(401);
    expect(f.storage.sign).not.toHaveBeenCalled();
  });
  it.each(['inactive', 'app-denied'])('denies %s access on every request', async condition => {
    const f = fixture();
    f.setAccess({ active: condition !== 'inactive', apps: { novaStar: true, cartonLleno: condition !== 'app-denied' } });
    expect((await f.get()).status).toBe(403);
    expect((await f.download()).status).toBe(403);
    expect(f.storage.read).not.toHaveBeenCalled();
  });
  it('returns all legacy metadata without signed URLs or an app release dependency', async () => {
    const f = fixture(), manifest = vi.spyOn(f.releases, 'manifest');
    const response = await f.get();
    expect(response.status).toBe(200);
    expect(response.body).toEqual(f.catalog);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(response.body)).not.toMatch(/https:|signedUrl|X-Goog-Signature/);
    expect(f.storage.read).toHaveBeenCalledWith(CATALOG_PATH);
    expect(manifest).not.toHaveBeenCalled();
  });
  it('signs only the selected catalog ZIP/generation for five minutes and never persists the URL', async () => {
    const f = fixture(), voice = f.catalog.voces[0];
    const response = await f.download();
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: voice.id, version: voice.version, generation: '123', size: voice.size, sha256: voice.sha256 });
    expect(Date.parse(response.body.expiresAt)).toBe(f.now() + DOWNLOAD_TTL_MS);
    expect(f.storage.sign).toHaveBeenCalledWith(voiceObjectPath(voice), voice.generation, voice.filename, f.now() + DOWNLOAD_TTL_MS);
    f.advance(DOWNLOAD_TTL_MS + 1);
    const fresh = await f.download();
    expect(Date.parse(response.body.expiresAt)).toBeLessThan(f.now());
    expect(Date.parse(fresh.body.expiresAt)).toBe(f.now() + DOWNLOAD_TTL_MS);
    expect(f.storage.sign).toHaveBeenCalledTimes(2);
    expect((await f.get()).body).toEqual(f.catalog);
  });
  it('returns 404 for nonexistent/cross-app IDs without guessing an object path', async () => {
    const f = fixture();
    for (const id of ['missing-voice', 'novaStar-voice']) expect((await f.download(id)).status).toBe(404);
    expect(f.storage.metadata).not.toHaveBeenCalled();
    expect(f.storage.sign).not.toHaveBeenCalled();
    expect((await request(f.app).get('/api/v1/apps/novaStar/voices')).status).toBe(404);
  });
  it('rejects traversal, query parameters and client-supplied download data', async () => {
    const f = fixture();
    expect((await f.download('bad%2Fid')).status).toBe(400);
    expect((await request(f.app).get(route + '?url=bad').set('Authorization', 'Bearer valid')).status).toBe(400);
    expect((await request(f.app).post(`${route}/${f.catalog.voces[0].id}/download`)
      .set('Authorization', 'Bearer valid').send({ url: 'https://not-trusted.test' })).status).toBe(400);
    expect(f.storage.sign).not.toHaveBeenCalled();
  });
  it('fails closed for missing, malformed, hash-mismatched or manipulated catalogs', async () => {
    const f = fixture();
    vi.mocked(f.storage.read).mockResolvedValueOnce(null);
    expect((await f.get()).status).toBe(404);
    for (const bytes of [Buffer.from('{}'), Buffer.from('not json'), Buffer.from(JSON.stringify({ ...f.catalog, signedUrl: 'forbidden' }))]) {
      vi.mocked(f.storage.read).mockResolvedValueOnce({ bytes, sha256: digest(bytes), generation: '100' });
      expect((await f.get()).status).toBe(503);
    }
    vi.mocked(f.storage.read).mockResolvedValueOnce({ bytes: Buffer.from(JSON.stringify(f.catalog)), sha256: 'b'.repeat(64), generation: '100' });
    expect((await f.get()).status).toBe(503);
    f.catalog.voces.push({ ...f.catalog.voces[0] });
    expect((await f.get()).status).toBe(503);
    expect(f.storage.sign).not.toHaveBeenCalled();
  });
  it.each(['size', 'sha256', 'generation'])('rejects mismatched %s metadata before signing', async field => {
    const f = fixture();
    vi.mocked(f.storage.metadata).mockResolvedValueOnce({ size: 1234, sha256: 'a'.repeat(64), generation: '123',
      [field]: field === 'size' ? 999 : '999' });
    expect((await f.download()).status).toBe(503);
    expect(f.storage.sign).not.toHaveBeenCalled();
  });
  it('rechecks access after catalog load and does not leak signing provider details', async () => {
    const f = fixture();
    expect((await f.get()).status).toBe(200);
    f.setAccess({ active: true, apps: { novaStar: true, cartonLleno: false } });
    expect((await f.download()).status).toBe(403);
    f.setAccess({ active: true, apps: { novaStar: true, cartonLleno: true } });
    vi.mocked(f.storage.sign).mockRejectedValueOnce(new Error('private-ID-token X-Goog-Signature=sensitive'));
    const failure = await f.download();
    expect(failure.status).toBe(503);
    expect(failure.body).toEqual({ error: 'voice_download_unavailable' });
  });
});
