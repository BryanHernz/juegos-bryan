import { connectFirebaseAuth } from './pair-auth.mjs';
import { FIREBASE_CONFIG, FIREBASE_SDK_VERSION } from './pair-config.mjs';
import { createReleaseClient } from './private-releases.mjs';

export async function connectPortal(loadModule = url => import(url)) {
  const auth = await connectFirebaseAuth(loadModule);
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
  const [apps, firestore] = await Promise.all([
    loadModule(`${base}/firebase-app.js`), loadModule(`${base}/firebase-firestore.js`),
  ]);
  const db = firestore.getFirestore(apps.getApp());
  return { ...auth, readAccess: async uid => {
    const snapshot = await firestore.getDocFromServer(firestore.doc(db, 'access', uid));
    return snapshot.exists() ? snapshot.data() : undefined;
  }, loadPortal: user => createReleaseClient({ user }).portal(), projectId: FIREBASE_CONFIG.projectId };
}
