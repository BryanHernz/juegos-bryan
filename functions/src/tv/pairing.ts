import { randomBytes, randomInt } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  ApiError, AppId, equalHash, hashCode, hashPollToken, portalOrigin,
} from './validation';

export const PAIRING_TTL_MS = 5 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;

export interface PairingRecord {
  app: AppId;
  codeHash: string;
  pollTokenHash: string;
  status: 'pending' | 'approved' | 'consumed';
  createdAt: Timestamp | FieldValue;
  expiresAt: Timestamp;
  approvedUid?: string;
  approvedAt?: Timestamp | FieldValue;
  consumedAt?: Timestamp | FieldValue;
}

export interface AccessRecord {
  active?: unknown;
  apps?: Partial<Record<AppId, unknown>>;
}

export interface PairingTransaction {
  getPairing(id: string): Promise<PairingRecord | undefined>;
  getFailedAttempts(id: string): Promise<number>;
  getAccess(uid: string): Promise<AccessRecord | undefined>;
  updatePairing(id: string, patch: Partial<PairingRecord>): void;
  setFailedAttempts(id: string, attempts: number): void;
}

export interface PairingStore {
  create(id: string, record: PairingRecord): Promise<void>;
  transaction<T>(work: (tx: PairingTransaction) => Promise<T>): Promise<T>;
}

export interface AuthGateway {
  verifyIdToken(token: string): Promise<{ uid: string }>;
  createCustomToken(uid: string): Promise<string>;
}

export interface PairingDependencies {
  store: PairingStore;
  auth: AuthGateway;
  codeSecret: string;
  portalUrl: string;
  now?: () => number;
}

export class PairingService {
  private readonly now: () => number;
  readonly portalUrl: string;

  constructor(private readonly deps: PairingDependencies) {
    if (Buffer.byteLength(deps.codeSecret, 'utf8') < 32) {
      throw new Error('TV_PAIRING_CODE_SECRET must contain at least 32 bytes');
    }
    this.portalUrl = portalOrigin(deps.portalUrl);
    this.now = deps.now ?? Date.now;
  }

  async create(app: AppId) {
    const id = randomBytes(24).toString('hex');
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Timestamp.fromMillis(this.now() + PAIRING_TTL_MS);
    await this.deps.store.create(id, {
      app,
      codeHash: hashCode(this.deps.codeSecret, id, app, code),
      pollTokenHash: hashPollToken(token),
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
    });
    return {
      pairingId: id, code, pollToken: token, app,
      pairUrl: `${this.portalUrl}/pair/${id}`,
      expiresAt: expiresAt.toDate().toISOString(),
    };
  }

  async verifyUser(token: string): Promise<string> {
    try {
      return (await this.deps.auth.verifyIdToken(token)).uid;
    } catch {
      throw new ApiError(401, 'invalid_id_token');
    }
  }

  private live(record: PairingRecord | undefined): PairingRecord {
    if (!record) throw new ApiError(404, 'pairing_not_found');
    if (record.expiresAt.toMillis() <= this.now()) throw new ApiError(410, 'pairing_expired');
    return record;
  }

  async approve(id: string, uid: string, code: string | null): Promise<void> {
    const result = await this.deps.store.transaction(async (tx) => {
      const record = this.live(await tx.getPairing(id));
      const attempts = await tx.getFailedAttempts(id);
      if (attempts >= MAX_CODE_ATTEMPTS) throw new ApiError(429, 'pairing_locked');
      if (record.status !== 'pending') throw new ApiError(409, 'pairing_already_approved');
      const access = await tx.getAccess(uid);
      if (access?.active !== true || access.apps?.[record.app] !== true) {
        throw new ApiError(403, 'app_access_denied');
      }
      if (code === null || !equalHash(record.codeHash,
        hashCode(this.deps.codeSecret, id, record.app, code))) {
        tx.setFailedAttempts(id, attempts + 1);
        // Return the error so Firestore commits the increment instead of rolling it back.
        return attempts + 1 >= MAX_CODE_ATTEMPTS ? 'locked' : 'incorrect';
      }
      tx.updatePairing(id, {
        status: 'approved', approvedUid: uid, approvedAt: FieldValue.serverTimestamp(),
      });
      return 'approved';
    });
    if (result === 'locked') throw new ApiError(429, 'pairing_locked');
    if (result === 'incorrect') throw new ApiError(403, 'incorrect_code');
  }

  async poll(id: string, token: string) {
    const result = await this.deps.store.transaction(async (tx) => {
      const record = await tx.getPairing(id);
      if (!record || !equalHash(record.pollTokenHash, hashPollToken(token))) {
        throw new ApiError(401, 'invalid_poll_token');
      }
      this.live(record);
      const attempts = await tx.getFailedAttempts(id);
      if (attempts >= MAX_CODE_ATTEMPTS) throw new ApiError(429, 'pairing_locked');
      if (record.status === 'pending') return { status: 'pending' } as const;
      if (record.status === 'consumed') throw new ApiError(409, 'pairing_consumed');
      if (!record.approvedUid) throw new ApiError(500, 'invalid_pairing_state');
      tx.updatePairing(id, { status: 'consumed', consumedAt: FieldValue.serverTimestamp() });
      return { status: 'approved', uid: record.approvedUid } as const;
    });
    if (result.status === 'pending') return { status: 'pending' } as const;
    // Sign only after the transaction commits; Firestore may retry its callback.
    const customToken = await this.deps.auth.createCustomToken(result.uid);
    return { status: 'approved', customToken } as const;
  }
}
