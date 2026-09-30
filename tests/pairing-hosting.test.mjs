import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createPreviewServer } from '../tools/serve.mjs';
import { PUBLIC_FILES } from '../tools/build.mjs';

test('vista previa reconoce /pair/:pairingId y sirve módulos sin exponer archivos privados', async t => {
  const server = createPreviewServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/pair/${'ab'.repeat(24)}`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Vincular dispositivo · NEXO/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  for (const file of ['/pair.mjs', '/pair-auth.mjs', '/pairing.mjs', '/pair-config.mjs', '/pair.css', '/styles.css', '/assets/favicon.svg', '/']) {
    assert.equal((await fetch(origin + file)).status, 200, file);
  }
  for (const file of ['/functions/package.json', '/functions/.env.nova-star-bd0d9', '/package-lock.json', '/tests/pairing-web.test.mjs', '/node_modules/jsdom/package.json']) {
    assert.notEqual((await fetch(origin + file)).status, 200, file);
  }
});

test('Hosting usa el target portal asociado a nexo-hub y publica solo archivos estáticos', async () => {
  const config = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8'));
  const rc = JSON.parse(await readFile(new URL('../.firebaserc', import.meta.url), 'utf8'));
  assert.equal(config.hosting.target, 'portal');
  assert.equal(config.hosting.site, undefined);
  assert.deepEqual(rc.targets['nova-star-bd0d9'].hosting.portal, ['nexo-hub']);
  assert.equal(config.hosting.public, '_site');
  assert.deepEqual(config.hosting.rewrites, [{ source: '/pair/**', destination: '/pair.html' }]);
  assert.ok(PUBLIC_FILES.includes('pair.html'));
  assert.ok(PUBLIC_FILES.includes('pair-config.mjs'));
  assert.ok(PUBLIC_FILES.every(file => !file.includes('/') && !file.startsWith('.') && !file.includes('package')));
});
