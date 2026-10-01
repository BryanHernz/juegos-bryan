import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { cleanupTvPairings, CONSUMED_RETENTION_MS, EXPIRED_RETENTION_MS } from '../src/tv/cleanup';

type Row = Record<string, unknown>;
const NOW = Date.parse('2026-10-10T04:00:00Z');
const stamp = (time: number) => Timestamp.fromMillis(time);
function pairing(status = 'pending', expiresAt = NOW - EXPIRED_RETENTION_MS): Row {
  return {
    app: 'novaStar', codeHash: 'test-hash-not-a-real-code', pollTokenHash: 'test-poll-hash',
    status, createdAt: stamp(Math.min(expiresAt, NOW - CONSUMED_RETENTION_MS) - 300_000),
    expiresAt: stamp(expiresAt),
    ...(status === 'approved' || status === 'consumed'
      ? { approvedUid: 'user-a', approvedAt: stamp(NOW - CONSUMED_RETENTION_MS - 1) } : {}),
    ...(status === 'consumed' ? { consumedAt: stamp(NOW - CONSUMED_RETENTION_MS) } : {}),
  };
}

// Exercise the real Firestore cleanup adapter locally: query pagination,
// fresh reads, atomic delete staging, rollback and transaction retries.
function fixture() {
  const rows = new Map<string, Row>();
  const deletedTransactions: string[][] = [];
  const reads: string[] = [];
  let beforeTransaction: (() => void) | undefined;
  let beforeRetry: (() => void) | undefined;
  let retry = false;
  let failCommit = false;
  let failScan = false;
  function reference(path: string) {
    return {
      path, id: path.split('/').at(-1)!,
      collection: (name: string) => query(`${path}/${name}`),
      listCollections: async () => {
        const names = new Set([...rows.keys()].filter(k => k.startsWith(`${path}/`))
          .map(k => k.slice(path.length + 1).split('/')[0]));
        return [...names].map(id => ({ id }));
      },
    };
  }
  function snapshot(path: string) {
    const row = rows.get(path);
    return { id: path.split('/').at(-1)!, ref: reference(path), exists: !!row, data: () => row && { ...row } };
  }
  function query(path: string, limit = Infinity, cursor = '') {
    return {
      path, isQuery: true,
      doc: (id: string) => reference(`${path}/${id}`),
      orderBy: () => query(path, limit, cursor),
      select: () => query(path, limit, cursor),
      limit: (value: number) => query(path, value, cursor),
      startAfter: (id: string) => query(path, limit, id),
      listDocuments: async () => {
        const names = new Set([...rows.keys()].filter(k => k.startsWith(`${path}/`))
          .map(k => k.slice(path.length + 1).split('/')[0]));
        return [...names].map(id => reference(`${path}/${id}`));
      },
      get: async () => {
        if (failScan && path === 'tvPairings') throw new Error('sensitive-provider-detail');
        reads.push(path);
        const paths = [...rows.keys()].filter(k => k.slice(0, k.lastIndexOf('/')) === path &&
          k.split('/').at(-1)! > cursor).sort().slice(0, limit);
        return { docs: paths.map(snapshot), size: paths.length, empty: paths.length === 0 };
      },
    };
  }
  const db = {
    collection: (path: string) => query(path),
    runTransaction: async <T>(work: (tx: unknown) => Promise<T>) => {
      beforeTransaction?.(); beforeTransaction = undefined;
      async function attempt() {
        const staged: string[] = [];
        let writing = false;
        const result = await work({
          get: async (target: ReturnType<typeof reference> | ReturnType<typeof query>) => {
            if (writing) throw new Error('read-after-write');
            if ('isQuery' in target) return target.get();
            reads.push(target.path); return snapshot(target.path);
          },
          delete: (target: { path: string }) => { writing = true; staged.push(target.path); },
        });
        return { result, staged };
      }
      if (retry) { retry = false; await attempt(); beforeRetry?.(); beforeRetry = undefined; }
      const { result, staged } = await attempt();
      if (failCommit) { failCommit = false; throw new Error('sensitive-provider-detail'); }
      if (staged.length) {
        for (const path of staged) rows.delete(path);
        deletedTransactions.push(staged);
      }
      return result;
    },
  };
  return {
    db: db as unknown as Firestore, rows, reads, reference, deletedTransactions,
    beforeTransaction: (fn: () => void) => { beforeTransaction = fn; },
    retryTransaction: (fn?: () => void) => { retry = true; beforeRetry = fn; },
    failCommit: () => { failCommit = true; },
    failScan: () => { failScan = true; },
    run: () => cleanupTvPairings(db as unknown as Firestore, () => NOW),
  };
}

describe('daily TV pairing retention (local, no Firebase credentials)', () => {
  it.each(['pending', 'approved'])('%s vigente -> conserva', async status => {
    const f = fixture(); f.rows.set('tvPairings/a', pairing(status, NOW + 1));
    expect(await f.run()).toMatchObject({ scanned: 1, skippedActive: 1, errors: 0 });
    expect(f.rows.has('tvPairings/a')).toBe(true);
  });

  it.each(['pending', 'approved'])('%s expirado <24h -> conserva', async status => {
    const f = fixture(); f.rows.set('tvPairings/a', pairing(status, NOW - EXPIRED_RETENTION_MS + 1));
    expect(await f.run()).toMatchObject({ skippedRetention: 1, deletedExpired: 0 });
    expect(f.rows.has('tvPairings/a')).toBe(true);
  });

  it.each(['pending', 'approved'])('%s expirado >=24h -> elimina en el límite exacto', async status => {
    const f = fixture(); f.rows.set('tvPairings/a', pairing(status));
    expect(await f.run()).toMatchObject({ deletedExpired: 1, errors: 0 });
    expect(f.rows.has('tvPairings/a')).toBe(false);
  });

  it('consumed <7d -> conserva', async () => {
    const f = fixture(); f.rows.set('tvPairings/a', { ...pairing('consumed'), consumedAt: stamp(NOW - CONSUMED_RETENTION_MS + 1) });
    expect(await f.run()).toMatchObject({ skippedRetention: 1, deletedConsumed: 0 });
    expect(f.rows.has('tvPairings/a')).toBe(true);
  });

  it('consumed >=7d -> elimina en el límite exacto', async () => {
    const f = fixture(); f.rows.set('tvPairings/a', pairing('consumed', NOW));
    expect(await f.run()).toMatchObject({ deletedConsumed: 1, errors: 0 });
    expect(f.rows.has('tvPairings/a')).toBe(false);
  });

  it('consumed >=7d pero aún no expirado -> conserva', async () => {
    const f = fixture(); f.rows.set('tvPairings/a', pairing('consumed', NOW + 1));
    expect(await f.run()).toMatchObject({ skippedActive: 1, deletedConsumed: 0 });
    expect(f.rows.has('tvPairings/a')).toBe(true);
  });

  it('elimina todos los security junto al padre en un único commit', async () => {
    const f = fixture(); f.rows.set('tvPairings/a', pairing());
    f.rows.set('tvPairings/a/security/approval', { failedAttempts: 2 });
    f.rows.set('tvPairings/a/security/other', { failedAttempts: 1 });
    f.rows.set('users/real', { preserve: true });
    f.rows.set('access/real', { preserve: true });
    f.rows.set('playlists/real', { preserve: true });
    f.rows.set('tvPairings/b', pairing('pending', NOW + 1));
    const before = new Map(f.rows);
    expect(await f.run()).toMatchObject({ deletedExpired: 1, skippedActive: 1 });
    expect(f.deletedTransactions).toEqual([['tvPairings/a/security/approval', 'tvPairings/a/security/other', 'tvPairings/a']]);
    for (const path of ['users/real', 'access/real', 'playlists/real', 'tvPairings/b']) expect(f.rows.get(path)).toEqual(before.get(path));
    expect(f.reads.every(path => path.startsWith('tvPairings'))).toBe(true);
  });

  it.each([
    { status: 'unknown' }, { expiresAt: null }, { expiresAt: NOW }, { createdAt: null },
    { codeHash: null }, { app: 'other' }, { futureRetentionFlag: true },
    { status: 'approved' }, { status: 'consumed' },
  ])('estado desconocido/incompleto -> omite (%j)', async patch => {
    const f = fixture(); f.rows.set('tvPairings/a', { ...pairing(), ...patch });
    expect(await f.run()).toMatchObject({ skippedInvalid: 1, deletedExpired: 0, deletedConsumed: 0 });
    expect(f.deletedTransactions).toHaveLength(0);
  });

  it('segunda ejecución es idempotente', async () => {
    const f = fixture(); f.rows.set('tvPairings/a', pairing());
    f.rows.set('tvPairings/a/security/approval', { failedAttempts: 2 });
    expect(await f.run()).toMatchObject({ scanned: 1, deletedExpired: 1, errors: 0 });
    expect(await f.run()).toMatchObject({ scanned: 0, deletedExpired: 0, errors: 0 });
    expect(f.deletedTransactions).toHaveLength(1);
  });

  it('relee el padre y conserva si cambió a vigente desde el escaneo', async () => {
    const f = fixture(); f.rows.set('tvPairings/a', pairing());
    f.beforeTransaction(() => f.rows.set('tvPairings/a', pairing('pending', NOW + 1)));
    expect(await f.run()).toMatchObject({ skippedActive: 1, deletedExpired: 0 });
    expect(f.rows.has('tvPairings/a')).toBe(true);
  });

  it('un retry relee el nuevo estado y no cuenta escrituras descartadas', async () => {
    const f = fixture(); f.rows.set('tvPairings/a', pairing());
    f.retryTransaction(() => f.rows.set('tvPairings/a', pairing('consumed')));
    expect(await f.run()).toMatchObject({ deletedConsumed: 1, deletedExpired: 0 });
    expect(f.deletedTransactions).toEqual([['tvPairings/a']]);
  });

  it('un padre eliminado concurrentemente se omite sin fallar', async () => {
    const f = fixture(); f.rows.set('tvPairings/a', pairing());
    f.beforeTransaction(() => { f.rows.delete('tvPairings/a'); });
    expect(await f.run()).toMatchObject({ skippedMissing: 1, errors: 0 });
  });

  it('un fallo de commit conserva security y padre, cuenta el error y continúa', async () => {
    const f = fixture(); f.rows.set('tvPairings/a', pairing());
    f.rows.set('tvPairings/a/security/approval', { failedAttempts: 2 });
    f.rows.set('tvPairings/b', pairing()); f.failCommit();
    const summary = await f.run();
    expect(summary).toMatchObject({ scanned: 2, deletedExpired: 1, errors: 1 });
    expect(f.rows.has('tvPairings/a')).toBe(true);
    expect(f.rows.has('tvPairings/a/security/approval')).toBe(true);
    expect(f.rows.has('tvPairings/b')).toBe(false);
    expect(JSON.stringify(summary)).not.toContain('sensitive-provider-detail');
  });

  it('un fallo de escaneo devuelve un resumen seguro', async () => {
    const f = fixture(); f.failScan();
    expect(await f.run()).toMatchObject({ scanned: 0, errors: 1 });
  });

  it('pagina más de 200 pairings sin omitir documentos al borrar', async () => {
    const f = fixture();
    for (let i = 0; i < 205; i++) f.rows.set(`tvPairings/${String(i).padStart(3, '0')}`, pairing());
    expect(await f.run()).toMatchObject({ scanned: 205, deletedExpired: 205, errors: 0 });
    expect(f.rows.size).toBe(0);
  });

  it.each(['other', 'security/approval/nested'])('conserva estructuras inesperadas: %s', async path => {
    const f = fixture(); f.rows.set('tvPairings/a', pairing());
    if (path.startsWith('security')) f.rows.set('tvPairings/a/security/approval', { failedAttempts: 2 });
    f.rows.set(`tvPairings/a/${path}/child`, { preserve: true });
    const before = new Map(f.rows);
    expect(await f.run()).toMatchObject({ skippedInvalid: 1 });
    expect(f.rows).toEqual(before);
  });

  it('omite una subcolección security excesiva para mantener el borrado atómico', async () => {
    const f = fixture(); f.rows.set('tvPairings/a', pairing());
    for (let i = 0; i < 101; i++) f.rows.set(`tvPairings/a/security/${i}`, { failedAttempts: 0 });
    expect(await f.run()).toMatchObject({ skippedInvalid: 1 });
    expect(f.rows.size).toBe(102);
  });

  it('omite security con un padre ausente pero descendientes existentes', async () => {
    const f = fixture(); f.rows.set('tvPairings/a', pairing());
    f.rows.set('tvPairings/a/security/missing/nested/child', { preserve: true });
    const before = new Map(f.rows);
    expect(await f.run()).toMatchObject({ skippedInvalid: 1, deletedExpired: 0 });
    expect(f.rows).toEqual(before);
  });
});
