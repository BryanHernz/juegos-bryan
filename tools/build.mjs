import { cp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '_site');
const files = ['index.html', 'styles.css', 'app.js', 'experience.mjs', 'motion.mjs', 'config.mjs', 'releases.mjs'];
try {
  for (const file of files) await access(path.join(root, file));
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const file of files) await cp(path.join(root, file), path.join(output, file));
  await cp(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });
  await writeFile(path.join(output, '.nojekyll'), '');
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  await writeFile(path.join(output, 'portal-version.json'), JSON.stringify({ version }) + '\n');
  console.log(`[build] Sala Uno ${version}: ${output}`);
} catch (error) { console.error(`[build] ${error.message}`); process.exitCode = 1; }
