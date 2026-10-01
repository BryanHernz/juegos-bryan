import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { onInit } from 'firebase-functions/v2/core';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { createHttpApp } from './http';
import { cleanupTvPairings } from './tv/cleanup';
import { firestoreStore } from './tv/firestore';
import { PairingService } from './tv/pairing';

const codeSecret = defineSecret('TV_PAIRING_CODE_SECRET');
const portalUrl = defineString('NEXO_PORTAL_URL', {
  description: 'HTTPS origin of Nexo; no path, query, or trailing page name.',
});
const region = defineString('NEXO_FUNCTIONS_REGION', { default: 'southamerica-west1' });

let handler: ReturnType<typeof createHttpApp>;
onInit(() => {
  initializeApp();
});

function apiHandler() {
  // Only the HTTP function needs the secret; scheduled cleanup does not bind
  // or read it. Keep the router cached once per API instance.
  handler ??= createHttpApp(new PairingService({
    store: firestoreStore(getFirestore()),
    auth: getAuth(),
    codeSecret: codeSecret.value(),
    portalUrl: portalUrl.value(),
  }));
  return handler;
}

export const api = onRequest({
  region,
  secrets: [codeSecret],
  invoker: 'public',
  timeoutSeconds: 30,
  memory: '256MiB',
  maxInstances: 3,
}, (req, res) => { apiHandler()(req, res); });

export const cleanupTvPairingsDaily = onSchedule({
  schedule: '0 4 * * *',
  timeZone: 'UTC',
  region,
  timeoutSeconds: 300,
  memory: '256MiB',
  minInstances: 0,
  maxInstances: 1,
  concurrency: 1,
  retryCount: 0,
}, async () => {
  const summary = await cleanupTvPairings(getFirestore());
  if (summary.errors > 0) {
    logger.warn('tv_pairings_cleanup', summary);
    throw new Error('TV pairing cleanup completed with errors; inspect execution summary.');
  }
  logger.info('tv_pairings_cleanup', summary);
});
