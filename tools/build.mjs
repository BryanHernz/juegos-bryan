import { cp, mkdir, rm, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUBLIC_FILES = Object.freeze([
  'index.html', 'styles.css', 'app.js', 'experience.mjs', 'motion.mjs', 'config.mjs', 'releases.mjs',
  'pair.html', 'pair-base.css', 'pair.css', 'pair.mjs', 'pairing.mjs', 'pair-auth.mjs', 'pair-config.mjs',
]);
const REQUIRED_SCREENS = ['nova-library', 'nova-duet', 'carton-75', 'carton-remote']
  .map(name => `assets/screens/${name}.webp`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '_site');

async function assetFiles(directory = 'assets') {
  const files = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await assetFiles(relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

export async function verifySite() {
  for (const file of [...PUBLIC_FILES, ...REQUIRED_SCREENS, 'portal-version.json']) {
    const info = await stat(path.join(output, file));
    if (!info.isFile() || !info.size) throw new Error(`Archivo público ausente o vacío: ${file}`);
  }
  const assets = await assetFiles();
  for (const file of assets) {
    const [source, built] = await Promise.all([readFile(path.join(root, file)), readFile(path.join(output, file))]);
    if (!source.equals(built)) throw new Error(`Asset alterado en el build: ${file}`);
  }
  return assets.length;
}

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
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  await writeFile(path.join(destination, 'portal-version.json'), JSON.stringify({ version }) + '\n');
  return verifySite();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = await buildSite();
  console.log(`Nexo: sitio preparado y verificado en _site/ (${count} assets; portal y pairing completos)`);
}
