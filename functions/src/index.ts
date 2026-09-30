import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { onInit } from 'firebase-functions/v2/core';
import { onRequest } from 'firebase-functions/v2/https';
import { createHttpApp } from './http';
import { firestoreStore } from './tv/firestore';
import { PairingService } from './tv/pairing';

const codeSecret = defineSecret('TV_PAIRING_CODE_SECRET');
const portalUrl = defineString('SALA_UNO_PORTAL_URL', {
  description: 'HTTPS origin of Sala Uno; no path, query, or trailing page name.',
});
const region = defineString('SALA_UNO_FUNCTIONS_REGION', { default: 'southamerica-west1' });

let handler: ReturnType<typeof createHttpApp>;
onInit(() => {
  initializeApp();
  handler = createHttpApp(new PairingService({
    store: firestoreStore(getFirestore()),
    auth: getAuth(),
    codeSecret: codeSecret.value(),
    portalUrl: portalUrl.value(),
  }));
});

export const api = onRequest({
  region,
  secrets: [codeSecret],
  invoker: 'public',
  timeoutSeconds: 30,
  memory: '256MiB',
  maxInstances: 3,
}, (req, res) => { handler(req, res); });
