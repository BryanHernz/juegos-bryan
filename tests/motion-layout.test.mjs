import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const html = read('index.html');
const css = read('styles.css');
const motion = read('motion.mjs');
const hero = html.slice(html.indexOf('id="inicio"'), html.indexOf('id="nova-star"'));

test('la portada incluye las dos pantallas y ambos telefonos originales', () => {
  for (const file of ['nova-duet.webp', 'carton-75.webp', 'nova-microphone.webp', 'carton-remote.webp']) assert.ok(hero.includes(file), file);
  assert.match(hero, /hero-phone-nova/);
  assert.match(hero, /hero-phone-carton/);
});
test('la portada nunca se reduce por debajo de un viewport', () => {
  const patch = css.slice(css.indexOf('/* [1.2.1]'));
  assert.match(patch, /min-height:max\(1120px,112svh\)/);
  for (const rule of patch.matchAll(/\.hero\{([^}]+)\}/g)) assert.doesNotMatch(rule[1], /min-height:initial/);
});
test('entradas y escenas estan conectadas al documento', () => {
  assert.ok((html.match(/data-reveal=/g) || []).length >= 8);
  assert.ok((html.match(/data-motion-scene/g) || []).length >= 6);
  assert.match(css, /\[data-reveal="up"\]:not\(\.is-visible\)/);
  assert.match(css, /@keyframes device-float/);
});
test('las capas animadas preservan la perspectiva de los dispositivos', () => {
  assert.match(css, /\[data-parallax\]\{ translate:0 var\(--parallax-y,0px\) \}/);
  assert.match(motion, /setProperty\('--parallax-y'/);
  assert.doesNotMatch(motion, /element\.style\.transform\s*=/);
  assert.match(hero, /class="motion-float"/);
});
test('sin controles manuales de movimiento y con aviso de accesibilidad', () => {
  assert.doesNotMatch(html, /data-motion-toggle|data-motion-label|Animaciones activas|Pausar animaciones/);
  assert.match(hero, /data-motion-status hidden role="status"/);
});
test('las descargas no son capas parallax', () => {
  for (const tag of html.matchAll(/<(?:a|button)\b[^>]*>/g)) {
    if (/data-download|data-web|class="button/.test(tag[0])) assert.doesNotMatch(tag[0], /data-parallax/);
  }
});
test('sin JS o con movimiento reducido no se oculta contenido', () => {
  assert.match(css, /\[data-reveal\]\{ opacity:1 \}/);
  assert.match(css, /\.motion-off \[data-reveal\]\{ opacity:1!important/);
  assert.match(motion, /classList\.add\('is-visible'\)/);
});
