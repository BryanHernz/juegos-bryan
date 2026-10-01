import { writeFile } from 'node:fs/promises';
import { APPS, SNAPSHOT_CHECKED_AT } from '../config.mjs';
import { safeHttps } from '../releases.mjs';
const [id, address] = process.argv.slice(2);
const app = APPS.find(item => item.id === id);
const url = safeHttps(address);
if (!app || !url) {
  console.error('Uso: node tools/configurar-web.mjs carton-lleno https://TU-SITIO/');
  process.exitCode = 1;
} else if (APPS.some(item => item.companion?.url && new URL(url).origin === new URL(item.companion.url).origin)) {
  console.error('Esa dirección pertenece al Micrófono / Companion; no puede configurarse como la versión Web del juego.');
  process.exitCode = 1;
} else {
  app.web.url = url;
  app.web.label = 'Web';
  app.web.description = `Abre la experiencia web de ${app.name} en una nueva pestaña.`;
  await writeFile(new URL('../config.mjs', import.meta.url), `export const APPS = ${JSON.stringify(APPS, null, 2)};\n\nexport const SNAPSHOT_CHECKED_AT = ${JSON.stringify(SNAPSHOT_CHECKED_AT)};\n`);
  console.log(`[web:${id}] ${url}`);
  console.log('Cambio local en config.mjs; publica este archivo con git para actualizar el portal.');
}
