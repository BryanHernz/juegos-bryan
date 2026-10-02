import { createHash } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { Timestamp } from 'firebase-admin/firestore';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHttpApp } from '../src/http';
import { firestoreStore } from '../src/tv/firestore';
import { PairingService, PAIRING_TTL_MS } from '../src/tv/pairing';
import { ApiError, equalHash, hashCode, hashPollToken, portalOrigin } from '../src/tv/validation';
import { fakeFirestore } from './fake-firestore';

const BASE = '/api/v1/tv/pairings';
const SECRET = 'local-test-only-secret-never-used-in-production';
const PORTAL = 'https://portal.test';

function fixture() {
  let clock = Date.parse('2026-09-30T12:00:00.000Z');
  const firestore = fakeFirestore(() => clock);
  firestore.rows.set('access/user-a', { active: true, apps: { cartonLleno: true, novaStar: true } });
  firestore.rows.set('access/user-b', { active: true, apps: { cartonLleno: true, novaStar: true } });
  const auth = {
    verifyIdToken: vi.fn(async (token: string) => {
      if (token !== 'id-user-a' && token !== 'id-user-b') throw new Error('invalid token');
      return { uid: token.slice(3) };
    }),
    createCustomToken: vi.fn(async (uid: string) => `custom-token-for-${uid}`),
  };
  const service = new PairingService({
    store: firestoreStore(firestore.db), auth, codeSecret: SECRET,
    portalUrl: PORTAL, now: () => clock,
  });
  const app = createHttpApp(service);
  return {
    ...firestore, auth, service, app,
    advance: (ms: number) => { clock += ms; },
    create: async (appId = 'cartonLleno') => {
      const response = await request(app).post(BASE).send({ app: appId });
      expect(response.status).toBe(201);
      return response.body as {
        pairingId: string; code: string; pollToken: string;
        app: string; pairUrl: string; expiresAt: string;
      };
    },
    approve: (id: string, code: unknown, token = 'id-user-a') => request(app)
      .post(`${BASE}/${id}/approve`).set('Authorization', `Bearer ${token}`).send({ code }),
    poll: (id: string, token: string) => request(app)
      .get(`${BASE}/${id}`).set('Authorization', `Pairing ${token}`),
  };
}

describe('TV pairing HTTP API with injected Auth and local Firestore double', () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => { f = fixture(); });

  it.each(['novaStar', 'cartonLleno'])('metadata exposes only app/status/expiry for %s without writes', async (app) => {
    const p = await f.create(app);
    const before = new Map(f.rows);
    for (let i = 0; i < 2; i++) {
      const response = await request(f.app).get(`${BASE}/${p.pairingId}/metadata`).set('Origin', PORTAL);
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual({ app, status: 'pending', expiresAt: p.expiresAt });
    }
    expect(f.rows).toEqual(before);
    expect(f.auth.verifyIdToken).not.toHaveBeenCalled();
    expect(f.auth.createCustomToken).not.toHaveBeenCalled();
  });

  it('reading approved metadata does not consume or sign; consumed and expired are read-only', async () => {
    const p = await f.create();
    await f.approve(p.pairingId, p.code);
    const before = new Map(f.rows);
    expect((await request(f.app).get(`${BASE}/${p.pairingId}/metadata`)).body.status).toBe('approved');
    expect(f.rows).toEqual(before);
    expect(f.auth.createCustomToken).not.toHaveBeenCalled();
    f.advance(PAIRING_TTL_MS);
    expect((await request(f.app).get(`${BASE}/${p.pairingId}/metadata`)).body.status).toBe('expired');
    const row = f.rows.get(`tvPairings/${p.pairingId}`)!;
    f.rows.set(`tvPairings/${p.pairingId}`, { ...row, status: 'consumed' });
    const consumed = new Map(f.rows);
    const response = await request(f.app).get(`${BASE}/${p.pairingId}/metadata`);
    expect(response.body).toEqual({ app: 'cartonLleno', status: 'consumed', expiresAt: p.expiresAt });
    expect(f.rows).toEqual(consumed);
    expect(f.auth.createCustomToken).not.toHaveBeenCalled();
  });

  it('metadata rejects malformed id, unknown pairing, query params and foreign origin', async () => {
    const p = await f.create();
    expect((await request(f.app).get(`${BASE}/invalid/metadata`)).status).toBe(400);
    expect((await request(f.app).get(`${BASE}/${'ab'.repeat(24)}/metadata`)).status).toBe(404);
    expect((await request(f.app).get(`${BASE}/${p.pairingId}/metadata?app=novaStar`)).status).toBe(400);
    expect((await request(f.app).get(`${BASE}/${p.pairingId}/metadata`).set('Origin', 'https://other.test')).status).toBe(403);
  });

  it.each(['cartonLleno', 'novaStar'])('creates %s without login', async (appId) => {
    const p = await f.create(appId);
    expect(p.app).toBe(appId);
    expect(p.pairUrl).toBe(`${PORTAL}/pair/${p.pairingId}`);
    expect(f.auth.verifyIdToken).not.toHaveBeenCalled();
  });

  it.each(['other', 'CartonLleno', '', null, 7, true])('rejects invalid app %s with 400', async (appId) => {
    expect((await request(f.app).post(BASE).send({ app: appId })).status).toBe(400);
    expect(f.rows.size).toBe(2);
  });

  it('generates random ids, six-digit codes and 256-bit poll tokens', async () => {
    const pairings = await Promise.all(Array.from({ length: 24 }, () => f.create()));
    for (const p of pairings) {
      expect(p.pairingId).toMatch(/^[a-f0-9]{48}$/);
      expect(p.code).toMatch(/^\d{6}$/);
      expect(p.pollToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(p.pollToken, 'base64url').length).toBe(32);
    }
    expect(new Set(pairings.map((p) => p.pairingId)).size).toBe(24);
    expect(new Set(pairings.map((p) => p.pollToken)).size).toBe(24);
    // Codes can collide legitimately; only check they are not a fixed constant.
    expect(new Set(pairings.map((p) => p.code)).size).toBeGreaterThan(1);
  });

  it('stores only permitted pairing fields, HMAC code and SHA-256 poll token', async () => {
    const p = await f.create();
    const row = f.rows.get(`tvPairings/${p.pairingId}`)!;
    expect(Object.keys(row).sort()).toEqual([
      'app', 'codeHash', 'createdAt', 'expiresAt', 'pollTokenHash', 'status',
    ]);
    expect(Object.values(row)).not.toContain(p.code);
    expect(Object.values(row)).not.toContain(p.pollToken);
    expect(row.codeHash).toBe(hashCode(SECRET, p.pairingId, 'cartonLleno', p.code));
    expect(row.codeHash).not.toBe(createHash('sha256').update(p.code).digest('hex'));
    expect(row.pollTokenHash).toBe(hashPollToken(p.pollToken));
    expect(hashCode('different-secret', p.pairingId, 'cartonLleno', p.code)).not.toBe(row.codeHash);
    expect(row.createdAt).toBeInstanceOf(Timestamp);
    expect((row.expiresAt as Timestamp).toMillis() - (row.createdAt as Timestamp).toMillis())
      .toBe(PAIRING_TTL_MS);
    expect(p.expiresAt).toBe('2026-09-30T12:05:00.000Z');
  });

  it('requires a Firebase token to approve', async () => {
    const p = await f.create();
    expect((await request(f.app).post(`${BASE}/${p.pairingId}/approve`).send({ code: p.code })).status)
      .toBe(401);
  });

  it('rejects an invalid Firebase token and does not change state', async () => {
    const p = await f.create();
    expect((await f.approve(p.pairingId, p.code, 'invalid-id-token')).status).toBe(401);
    expect(f.auth.verifyIdToken).toHaveBeenCalledWith('invalid-id-token');
    expect(f.rows.get(`tvPairings/${p.pairingId}`)?.status).toBe('pending');
  });

  it.each([
    undefined, { active: false, apps: { cartonLleno: true } },
    { active: 'true', apps: { cartonLleno: true } },
    { active: true }, { active: true, apps: { novaStar: true } },
    { active: true, apps: { cartonLleno: 'true' } },
  ])('requires active=true and explicit app permission (%j)', async (access) => {
    const p = await f.create();
    if (access) f.rows.set('access/user-a', access);
    else f.rows.delete('access/user-a');
    expect((await f.approve(p.pairingId, p.code)).status).toBe(403);
    expect(f.rows.has(`tvPairings/${p.pairingId}/security/approval`)).toBe(false);
  });

  it.each(['cartonLleno', 'novaStar'])('approves %s for the permitted UID atomically', async (appId) => {
    const p = await f.create(appId);
    expect((await f.approve(p.pairingId, p.code)).body).toEqual({ status: 'approved' });
    const row = f.rows.get(`tvPairings/${p.pairingId}`)!;
    expect(row.status).toBe('approved');
    expect(row.approvedUid).toBe('user-a');
    expect(row.approvedAt).toBeInstanceOf(Timestamp);
    expect(f.auth.createCustomToken).not.toHaveBeenCalled();
  });

  it('uses the selected app permission for novaStar as well', async () => {
    const p = await f.create('novaStar');
    f.rows.set('access/user-a', { active: true, apps: { cartonLleno: true } });
    expect((await f.approve(p.pairingId, p.code)).status).toBe(403);
  });

  it('rejects an incorrect code and commits the attempt counter', async () => {
    const p = await f.create();
    const wrong = p.code === '000000' ? '000001' : '000000';
    expect((await f.approve(p.pairingId, wrong)).body).toEqual({ error: 'incorrect_code' });
    expect(f.rows.get(`tvPairings/${p.pairingId}/security/approval`)).toEqual({ failedAttempts: 1 });
    expect(f.rows.get(`tvPairings/${p.pairingId}`)?.status).toBe('pending');
  });

  it('pairingId alone cannot approve; malformed and missing codes count as attempts', async () => {
    const p = await f.create();
    for (const code of [undefined, '12345', '1234567', 123456, 'abcdef']) {
      const result = await f.approve(p.pairingId, code);
      expect([403, 429]).toContain(result.status);
    }
    expect(f.rows.get(`tvPairings/${p.pairingId}/security/approval`)).toEqual({ failedAttempts: 5 });
    expect((await f.approve(p.pairingId, p.code)).status).toBe(429);
    expect((await f.poll(p.pairingId, p.pollToken)).status).toBe(429);
  });

  it('blocks after five wrong codes, including concurrent attempts', async () => {
    const p = await f.create();
    const wrong = p.code === '000000' ? '000001' : '000000';
    const results = await Promise.all(Array.from({ length: 8 }, () => f.approve(p.pairingId, wrong)));
    expect(results.filter((r) => r.status === 403)).toHaveLength(4);
    expect(results.filter((r) => r.status === 429)).toHaveLength(4);
    expect(f.rows.get(`tvPairings/${p.pairingId}/security/approval`)).toEqual({ failedAttempts: 5 });
    expect((await f.approve(p.pairingId, p.code)).status).toBe(429);
  });

  it('expires precisely at five minutes on approval and polling', async () => {
    const p = await f.create();
    f.advance(PAIRING_TTL_MS - 1);
    expect((await f.poll(p.pairingId, p.pollToken)).status).toBe(200);
    f.advance(1);
    expect((await f.approve(p.pairingId, p.code)).status).toBe(410);
    expect((await f.poll(p.pairingId, p.pollToken)).status).toBe(410);
    expect(f.auth.createCustomToken).not.toHaveBeenCalled();
  });

  it('also refuses to consume expired approved pairings', async () => {
    const p = await f.create();
    await f.approve(p.pairingId, p.code);
    f.advance(PAIRING_TTL_MS);
    expect((await f.poll(p.pairingId, p.pollToken)).status).toBe(410);
    expect(f.rows.get(`tvPairings/${p.pairingId}`)?.status).toBe('approved');
  });

  it('rejects missing, malformed, incorrect, and query-string poll tokens', async () => {
    const p = await f.create();
    expect((await request(f.app).get(`${BASE}/${p.pairingId}`)).status).toBe(401);
    expect((await f.poll(p.pairingId, 'short')).status).toBe(401);
    const wrong = `${p.pollToken[0] === 'A' ? 'B' : 'A'}${p.pollToken.slice(1)}`;
    expect((await f.poll(p.pairingId, wrong)).status).toBe(401);
    expect((await request(f.app).get(`${BASE}/${p.pairingId}`).query({ pollToken: p.pollToken })).status)
      .toBe(400);
    expect((await f.poll(p.pairingId, p.pollToken).query({ pollToken: p.pollToken })).status).toBe(400);
  });

  it('returns pending without leaking stored hashes or other fields', async () => {
    const p = await f.create();
    expect((await f.poll(p.pairingId, p.pollToken)).body).toEqual({ status: 'pending' });
    expect(f.auth.createCustomToken).not.toHaveBeenCalled();
  });

  it('consumes once, signs for approvedUid, and never stores the custom token', async () => {
    const p = await f.create();
    await f.approve(p.pairingId, p.code);
    const response = await f.poll(p.pairingId, p.pollToken);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'approved', customToken: 'custom-token-for-user-a' });
    expect(f.auth.createCustomToken).toHaveBeenCalledExactlyOnceWith('user-a');
    const row = f.rows.get(`tvPairings/${p.pairingId}`)!;
    expect(row.status).toBe('consumed');
    expect(row.consumedAt).toBeInstanceOf(Timestamp);
    expect(Object.keys(row).sort()).toEqual([
      'app', 'approvedAt', 'approvedUid', 'codeHash', 'consumedAt',
      'createdAt', 'expiresAt', 'pollTokenHash', 'status',
    ]);
    expect(JSON.stringify([...f.rows.values()])).not.toContain('custom-token-for');
    expect((await f.poll(p.pairingId, p.pollToken)).status).toBe(409);
    expect(f.auth.createCustomToken).toHaveBeenCalledTimes(1);
  });

  it('concurrent consumers receive at most one custom token', async () => {
    const p = await f.create();
    await f.approve(p.pairingId, p.code);
    const results = await Promise.all(Array.from({ length: 4 }, () => f.poll(p.pairingId, p.pollToken)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(f.auth.createCustomToken).toHaveBeenCalledTimes(1);
  });

  it('does not sign inside transaction retries', async () => {
    const p = await f.create();
    await f.approve(p.pairingId, p.code);
    f.retryNextTransaction();
    expect((await f.poll(p.pairingId, p.pollToken)).status).toBe(200);
    expect(f.auth.createCustomToken).toHaveBeenCalledExactlyOnceWith('user-a');
  });

  it('failed attempt transaction retries increment only once', async () => {
    const p = await f.create();
    f.retryNextTransaction();
    await f.approve(p.pairingId, 'abcdef');
    expect(f.rows.get(`tvPairings/${p.pairingId}/security/approval`)).toEqual({ failedAttempts: 1 });
  });

  it('a signing failure leaves the pairing consumed, requiring a fresh pairing', async () => {
    const p = await f.create();
    await f.approve(p.pairingId, p.code);
    f.auth.createCustomToken.mockRejectedValueOnce(new Error('provider error with secret details'));
    const response = await f.poll(p.pairingId, p.pollToken);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'internal_error' });
    expect(f.rows.get(`tvPairings/${p.pairingId}`)?.status).toBe('consumed');
    expect((await f.poll(p.pairingId, p.pollToken)).status).toBe(409);
  });

  it('user B cannot reapprove or take over a pairing approved by A', async () => {
    const p = await f.create();
    await f.approve(p.pairingId, p.code);
    expect((await f.approve(p.pairingId, p.code, 'id-user-b')).status).toBe(409);
    expect((await f.approve(p.pairingId, p.code)).status).toBe(409);
    expect(f.rows.get(`tvPairings/${p.pairingId}`)?.approvedUid).toBe('user-a');
  });

  it('concurrent approvals cannot replace the first UID', async () => {
    const p = await f.create();
    const results = await Promise.all([
      f.approve(p.pairingId, p.code), f.approve(p.pairingId, p.code, 'id-user-b'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const uid = f.rows.get(`tvPairings/${p.pairingId}`)?.approvedUid;
    await f.poll(p.pairingId, p.pollToken);
    expect(f.auth.createCustomToken).toHaveBeenCalledWith(uid);
  });

  it('sets no-store on secret responses and errors', async () => {
    const created = await request(f.app).post(BASE).send({ app: 'cartonLleno' });
    expect(created.headers['cache-control']).toBe('no-store');
    const p = created.body;
    await f.approve(p.pairingId, p.code);
    expect((await f.poll(p.pairingId, p.pollToken)).headers['cache-control']).toBe('no-store');
    expect((await f.poll(p.pairingId, p.pollToken)).headers['cache-control']).toBe('no-store');
  });

  it('limits JSON bytes, requires Content-Type and rejects malformed JSON', async () => {
    expect((await request(f.app).post(BASE).set('Content-Type', 'text/plain').send('hello')).status)
      .toBe(415);
    expect((await request(f.app).post(BASE).send({ app: 'x'.repeat(1100) })).status).toBe(413);
    expect((await request(f.app).post(BASE).set('Content-Type', 'application/json').send('{')).status)
      .toBe(400);
    expect((await request(f.app).post(BASE).set('Content-Encoding', 'gzip').send({ app: 'novaStar' })).status)
      .toBe(415);
    expect((await request(f.app).post(BASE).send({ app: 'novaStar', unexpected: true })).status).toBe(400);
  });

  it('limits pre-parsed Cloud Functions rawBody even without Content-Length', async () => {
    const express = (await import('express')).default;
    const wrapper = express();
    wrapper.use((req, _res, next) => {
      Object.assign(req, { rawBody: Buffer.alloc(1025), body: { app: 'novaStar' } });
      delete req.headers['content-length'];
      next();
    });
    wrapper.use(f.app);
    expect((await request(wrapper).post(BASE).send({ app: 'novaStar' })).status).toBe(413);
  });

  it('limits chunked JSON without Content-Length', async () => {
    const server = createServer(f.app);
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('missing test server port');
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest({
          hostname: '127.0.0.1', port: address.port, path: BASE, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
        }, (res) => {
          res.resume();
          res.on('end', () => { resolve(res.statusCode!); });
        });
        req.on('error', reject);
        req.write(JSON.stringify({ app: 'x'.repeat(1100) }));
        req.end();
      });
      expect(status).toBe(413);
    } finally {
      await new Promise<void>((resolve) => { server.close(() => resolve()); });
    }
  });

  it('allows portal CORS preflight and refuses other browser origins', async () => {
    const preflight = await request(f.app).options(BASE).set('Origin', PORTAL);
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(PORTAL);
    expect(preflight.headers['access-control-allow-headers']).toContain('Authorization');
    expect((await request(f.app).post(BASE).set('Origin', 'https://other.test').send({ app: 'novaStar' })).status)
      .toBe(403);
  });

  it('exposes an asynchronous creation guard for a future distributed limiter/App Check', async () => {
    const beforeCreate = vi.fn(async () => { throw new ApiError(429, 'rate_limited'); });
    const guarded = createHttpApp(f.service, { beforeCreate });
    expect((await request(guarded).post(BASE).send({ app: 'novaStar' })).status).toBe(429);
    expect(beforeCreate).toHaveBeenCalledOnce();
    expect(f.rows.size).toBe(2);
  });

  it('validates pairing IDs and fails safely for missing pairings', async () => {
    expect((await f.poll('bad', 'A'.repeat(43))).status).toBe(400);
    expect((await f.approve('a'.repeat(48), '123456')).status).toBe(404);
    expect((await f.poll('a'.repeat(48), 'A'.repeat(43))).status).toBe(401);
  });

  it('fails closed on corrupted Firestore state and counters', async () => {
    const p = await f.create();
    f.rows.set(`tvPairings/${p.pairingId}/security/approval`, { failedAttempts: '0' });
    expect((await f.approve(p.pairingId, p.code)).status).toBe(500);
    expect((await f.poll(p.pairingId, p.pollToken)).status).toBe(500);
    f.rows.delete(`tvPairings/${p.pairingId}/security/approval`);
    Object.assign(f.rows.get(`tvPairings/${p.pairingId}`)!, { status: 'approved', approvedUid: null });
    expect((await f.poll(p.pairingId, p.pollToken)).status).toBe(500);
  });

  it('does not log secrets on successful or failed requests', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    try {
      const p = await f.create();
      await f.approve(p.pairingId, 'abcdef');
      await f.approve(p.pairingId, p.code);
      f.auth.createCustomToken.mockRejectedValueOnce(new Error('sensitive provider details'));
      await f.poll(p.pairingId, p.pollToken);
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    } finally { for (const log of logs) log.mockRestore(); }
  });
});

describe('configuration and hashing', () => {
  it('requires a configured HTTPS portal origin', () => {
    for (const invalid of ['', 'garbage', 'http://portal.test', 'https://user:pass@portal.test',
      'https://portal.test/page', 'https://portal.test/?x=1', 'https://portal.test/#x']) {
      expect(() => portalOrigin(invalid)).toThrow();
    }
    expect(portalOrigin('https://portal.test/')).toBe(PORTAL);
  });

  it('refuses a missing or short server secret', () => {
    const f = fixture();
    expect(() => new PairingService({ store: firestoreStore(f.db), auth: f.auth,
      codeSecret: '', portalUrl: PORTAL })).toThrow();
  });

  it('compares fixed-size valid hashes and rejects malformed hashes safely', () => {
    const hash = hashPollToken('random-token');
    expect(equalHash(hash, hash)).toBe(true);
    expect(equalHash(hash, hashPollToken('another-token'))).toBe(false);
    expect(equalHash(hash, 'short')).toBe(false);
    expect(equalHash('g'.repeat(64), hash)).toBe(false);
  });
});
