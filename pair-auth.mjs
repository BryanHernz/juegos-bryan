import { FIREBASE_CONFIG, FIREBASE_SDK_VERSION } from './pair-config.mjs';

export async function connectFirebaseAuth(loadModule = url => import(url)) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
  const [appSdk, authSdk] = await Promise.all([
    loadModule(`${base}/firebase-app.js`), loadModule(`${base}/firebase-auth.js`),
  ]);
  const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(FIREBASE_CONFIG);
  // Let Firebase restore/store the session in IndexedDB. Session storage/memory
  // are fallbacks; never select browserLocalPersistence (localStorage).
  const auth = authSdk.initializeAuth(app, {
    persistence: [authSdk.indexedDBLocalPersistence, authSdk.browserSessionPersistence,
      authSdk.inMemoryPersistence],
  });
  return {
    subscribe: (listener, onError) => authSdk.onAuthStateChanged(auth, listener, onError),
    signIn: async (email, password) =>
      (await authSdk.signInWithEmailAndPassword(auth, email, password)).user,
    signOut: () => authSdk.signOut(auth),
  };
}
