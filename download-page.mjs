import { connectFirebaseAuth } from './pair-auth.mjs';
import { appFromDownloadPath, initDownloadPage } from './download.mjs';

try {
  // Invalid routes do not initialize Auth or request any catalog data.
  const auth = appFromDownloadPath(window.location.pathname) ? await connectFirebaseAuth() : null;
  initDownloadPage({ document, window, auth });
} catch {
  document.getElementById('download-message').textContent = 'No pudimos cargar el inicio de sesión. Comprueba tu conexión y recarga la página.';
}
