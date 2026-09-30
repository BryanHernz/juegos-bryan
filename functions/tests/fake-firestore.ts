import { FieldValue, Firestore, Timestamp } from 'firebase-admin/firestore';

type Row = Record<string, unknown>;

// Local Firestore double: atomic staged writes, rollback, retry, server timestamps,
// read-before-write enforcement and serialization of concurrent transactions.
// Does not initialize Firebase or contact any service.
export function fakeFirestore(now: () => number) {
  const rows = new Map<string, Row>();
  let queue: Promise<unknown> = Promise.resolve();
  let retryNext = false;
  const resolve = (row: Row): Row => Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key, value instanceof FieldValue ? Timestamp.fromMillis(now()) : value,
  ]));
  const reference = (path: string) => ({
    path,
    collection: (name: string) => collection(`${path}/${name}`),
    create: async (data: Row) => {
      if (rows.has(path)) throw new Error('already-exists');
      rows.set(path, resolve(data));
    },
  });
  const collection = (path: string) => ({ doc: (id: string) => reference(`${path}/${id}`) });

  const db = {
    collection,
    runTransaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      const run = async () => {
        const attempt = async () => {
          const changes: Array<() => void> = [];
          let writing = false;
          const result = await work({
            get: async (ref: { path: string }) => {
              if (writing) throw new Error('Firestore reads must precede writes');
              const data = rows.get(ref.path);
              return { exists: data !== undefined, data: () => data && { ...data } };
            },
            set: (ref: { path: string }, data: Row) => {
              writing = true;
              changes.push(() => rows.set(ref.path, resolve(data)));
            },
            update: (ref: { path: string }, patch: Row) => {
              writing = true;
              if (!rows.has(ref.path)) throw new Error('not-found');
              changes.push(() => rows.set(ref.path, { ...rows.get(ref.path), ...resolve(patch) }));
            },
          });
          return { result, changes };
        };
        if (retryNext) {
          retryNext = false;
          await attempt(); // Discard writes to simulate a transaction conflict/retry.
        }
        const { result, changes } = await attempt();
        for (const commit of changes) commit();
        return result;
      };
      const pending = queue.then(run);
      queue = pending.catch(() => undefined);
      return pending;
    },
  };
  return {
    db: db as unknown as Firestore,
    rows,
    retryNextTransaction: () => { retryNext = true; },
  };
}
