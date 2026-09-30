import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUBLIC_FILES = Object.freeze([
  'index.html', 'styles.css', 'app.js', 'config.mjs', 'releases.mjs',
  'pair.html', 'pair.css', 'pair.mjs', 'pairing.mjs', 'pair-auth.mjs', 'pair-config.mjs',
]);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildSite() {
  const destination = path.resolve(root, '_site');
  if (path.dirname(destination) !== root || path.basename(destination) !== '_site') {
    throw new Error('Directorio de salida no válido');
  }
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const file of PUBLIC_FILES) await cp(path.join(root, file), path.join(destination, file));
  await cp(path.join(root, 'assets'), path.join(destination, 'assets'), { recursive: true });
  await writeFile(path.join(destination, '.nojekyll'), '');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildSite();
  console.log('Sitio estático preparado en _site/');
}
