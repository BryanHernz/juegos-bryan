import { connectFirebaseAuth } from './pair-auth.mjs';
import { FIREBASE_CONFIG } from './pair-config.mjs';
import { createReleaseClient } from './private-releases.mjs';

export async function connectPortal(loadModule = url => import(url)) {
  const auth = await connectFirebaseAuth(loadModule);
  return { ...auth, loadPortal: user => createReleaseClient({ user }).portal(), projectId: FIREBASE_CONFIG.projectId };
}
