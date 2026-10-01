import { FieldPath, Firestore, Timestamp } from 'firebase-admin/firestore';
import { isApp } from './validation';

export const EXPIRED_RETENTION_MS = 24 * 60 * 60 * 1000;
export const CONSUMED_RETENTION_MS = 7 * EXPIRED_RETENTION_MS;
const PAGE_SIZE = 200;
// Keep each parent + children transaction well below the Firestore write limit.
const MAX_SECURITY_DOCUMENTS = 100;
const fields = [
  'app', 'codeHash', 'pollTokenHash', 'status', 'createdAt', 'expiresAt',
  'approvedUid', 'approvedAt', 'consumedAt',
];

type Decision = 'deletedExpired' | 'deletedConsumed' | 'skippedActive' |
  'skippedInvalid' | 'skippedRetention' | 'skippedMissing';

export interface CleanupSummary {
  scanned: number;
  deletedExpired: number;
  deletedConsumed: number;
  skippedActive: number;
  skippedInvalid: number;
  skippedRetention: number;
  skippedMissing: number;
  errors: number;
}

export function retentionDecision(data: Record<string, unknown>, now: number): Decision {
  if (!Number.isFinite(now) || !isApp(data.app) ||
      !(data.createdAt instanceof Timestamp) || !(data.expiresAt instanceof Timestamp) ||
      typeof data.codeHash !== 'string' || !data.codeHash ||
      typeof data.pollTokenHash !== 'string' || !data.pollTokenHash ||
      Object.keys(data).some((key) => !fields.includes(key)) ||
      typeof data.status !== 'string' || !['pending', 'approved', 'consumed'].includes(data.status)) {
    return 'skippedInvalid';
  }
  if (data.expiresAt.toMillis() < data.createdAt.toMillis()) return 'skippedInvalid';
  if (data.status === 'pending') {
    if (['approvedUid', 'approvedAt', 'consumedAt'].some((key) => Object.hasOwn(data, key))) {
      return 'skippedInvalid';
    }
  } else {
    if (typeof data.approvedUid !== 'string' || !data.approvedUid ||
        !(data.approvedAt instanceof Timestamp)) return 'skippedInvalid';
    if (data.status === 'approved' && Object.hasOwn(data, 'consumedAt')) return 'skippedInvalid';
    if (data.status === 'consumed' && !(data.consumedAt instanceof Timestamp)) {
      return 'skippedInvalid';
    }
  }
  if (now < data.expiresAt.toMillis()) return 'skippedActive';
  if (data.status === 'consumed') {
    return now >= (data.consumedAt as Timestamp).toMillis() + CONSUMED_RETENTION_MS
      ? 'deletedConsumed' : 'skippedRetention';
  }
  return now >= data.expiresAt.toMillis() + EXPIRED_RETENTION_MS
    ? 'deletedExpired' : 'skippedRetention';
}

export async function cleanupTvPairings(
  db: Firestore, now: () => number = Date.now,
): Promise<CleanupSummary> {
  const summary: CleanupSummary = {
    scanned: 0, deletedExpired: 0, deletedConsumed: 0, skippedActive: 0,
    skippedInvalid: 0, skippedRetention: 0, skippedMissing: 0, errors: 0,
  };
  const pairings = db.collection('tvPairings');
  let cursor: string | undefined;
  while (true) {
    // Scan by ID so malformed/missing state fields are also counted. No hashes
    // or token fields are loaded by the paginated scan; no custom index needed.
    let query = pairings.orderBy(FieldPath.documentId()).select().limit(PAGE_SIZE);
    if (cursor !== undefined) query = query.startAfter(cursor);
    let page;
    try {
      page = await query.get();
    } catch {
      summary.errors++;
      break;
    }
    if (page.empty) break;
    for (const candidate of page.docs) {
      summary.scanned++;
      try {
        const outcome = await db.runTransaction<Decision>(async (tx) => {
          // Eligibility is determined from the fresh transactional read, never
          // from the earlier scan. Firestore retries on concurrent changes.
          const current = await tx.get(candidate.ref);
          if (!current.exists) return 'skippedMissing';
          const decision = retentionDecision(current.data()!, now());
          if (decision !== 'deletedExpired' && decision !== 'deletedConsumed') return decision;

          const collections = await candidate.ref.listCollections();
          if (collections.some((collection) => collection.id !== 'security')) return 'skippedInvalid';
          const securityCollection = candidate.ref.collection('security');
          const security = await tx.get(securityCollection.limit(MAX_SECURITY_DOCUMENTS + 1));
          if (security.size > MAX_SECURITY_DOCUMENTS) return 'skippedInvalid';
          // Queries omit missing parent documents that still have descendants.
          // Detect those too instead of deleting the pairing above orphan data.
          const childRefs = await securityCollection.listDocuments();
          const existingPaths = new Set(security.docs.map((child) => child.ref.path));
          if (childRefs.length !== security.size || childRefs.some((child) =>
            !existingPaths.has(child.path))) return 'skippedInvalid';
          // Unknown nested data is preserved instead of leaving orphaned docs.
          for (const child of security.docs) {
            if ((await child.ref.listCollections()).length !== 0) return 'skippedInvalid';
          }
          // All reads precede writes. Children and parent commit together or
          // none do. No recursive deletion can cross into other collections.
          for (const child of security.docs) tx.delete(child.ref);
          tx.delete(candidate.ref);
          return decision;
        });
        // Count only the committed transaction result, not retry callbacks.
        summary[outcome]++;
      } catch {
        // Provider exceptions can contain sensitive details. Only count errors.
        summary.errors++;
      }
    }
    cursor = page.docs[page.docs.length - 1].id;
    if (page.size < PAGE_SIZE) break;
  }
  return summary;
}
