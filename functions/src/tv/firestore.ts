import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { AccessRecord, PairingRecord, PairingStore, PairingTransaction } from './pairing';
import { ApiError, isApp } from './validation';

export function firestoreStore(db: Firestore): PairingStore {
  const pairing = (id: string) => db.collection('tvPairings').doc(id);
  const attempts = (id: string) => pairing(id).collection('security').doc('approval');

  return {
    async create(id, record) {
      await pairing(id).create(record);
    },
    transaction<T>(work: (tx: PairingTransaction) => Promise<T>): Promise<T> {
      return db.runTransaction(async (tx) => work({
        async getPairing(id) {
          const snapshot = await tx.get(pairing(id));
          if (!snapshot.exists) return undefined;
          const data = snapshot.data();
          if (!data || !isApp(data.app) || !(data.expiresAt instanceof Timestamp) ||
              typeof data.codeHash !== 'string' || typeof data.pollTokenHash !== 'string' ||
              !['pending', 'approved', 'consumed'].includes(data.status) ||
              (data.status === 'approved' &&
                (typeof data.approvedUid !== 'string' || !data.approvedUid))) {
            throw new ApiError(500, 'invalid_pairing_state');
          }
          return data as PairingRecord;
        },
        async getFailedAttempts(id) {
          const snapshot = await tx.get(attempts(id));
          if (!snapshot.exists) return 0;
          const count: unknown = snapshot.data()?.failedAttempts;
          if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
            throw new ApiError(500, 'invalid_pairing_state');
          }
          return count;
        },
        async getAccess(uid) {
          const snapshot = await tx.get(db.collection('access').doc(uid));
          return snapshot.data() as AccessRecord | undefined;
        },
        updatePairing(id, patch) { tx.update(pairing(id), patch); },
        setFailedAttempts(id, count) { tx.set(attempts(id), { failedAttempts: count }); },
      }));
    },
  };
}
