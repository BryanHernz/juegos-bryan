import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parallaxOffset, scrollProgress, motionEnabled, motionStrength, approach, initMotion, loadLocalLogos} from '../motion.mjs';

test('parallax usa limites por capa y velocidades opuestas', () => {
  assert.equal(parallaxOffset(-5000, 200, 900, .1), 96);
  assert.equal(parallaxOffset(5000, 200, 900, .1), -96);
  assert.equal(parallaxOffset(100, 200, 900, .1), 25);
  assert.equal(parallaxOffset(100, 200, 900, -.1), -25);
  assert.equal(parallaxOffset(-5000, 200, 900, .2, true, 48), 48);
});
test('el parallax cambia con el scroll, no solo con el tiempo', () => {
  const initial = parallaxOffset(150, 860, 900, -.13);
  const scrolled = parallaxOffset(-210, 860, 900, -.13);
  assert.ok(Math.abs(scrolled - initial) > 40);
});
test('movimiento reducido y pausa manual desactivan las capas', () => {
  assert.equal(motionEnabled(true, false, 'on'), false);
  assert.equal(motionEnabled(true, true, null), false);
  assert.equal(motionEnabled(false, false, 'off'), false);
  assert.equal(motionEnabled(false, false, null), true);
  assert.equal(parallaxOffset(100, 200, 900, .1, false), 0);
});
test('en movil el efecto sigue activo con amplitud reducida', () => {
  assert.equal(motionEnabled(false, true, null), true);
  assert.equal(motionEnabled(false, true, 'on'), true);
  assert.equal(motionStrength(true), .45);
  assert.equal(motionStrength(false), 1);
  assert.ok(Math.abs(parallaxOffset(100, 400, 800, .2 * motionStrength(true))) < Math.abs(parallaxOffset(100, 400, 800, .2)));
});
test('entradas no finitas y dimensiones invalidas no producen transformaciones', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.equal(parallaxOffset(value, 200, 900, .1), 0);
    assert.equal(parallaxOffset(100, value, 900, .1), 0);
    assert.equal(parallaxOffset(100, 200, 900, value), 0);
  }
  assert.equal(parallaxOffset(100, 200, 0, .1), 0);
  assert.equal(parallaxOffset(100, 0, 900, .1), 0);
  assert.equal(parallaxOffset(100, 200, 900, .1, true, -4), 0);
});
test('suavizado converge y deja de solicitar cuadros', () => {
  let value = 0;
  for (let n = 0; n < 200; n++) value = approach(value, 70);
  assert.equal(value, 70);
  assert.equal(approach(NaN, 10), 0);
  assert.equal(approach(0, 40, 2), 40);
});
test('progreso no divide por cero ni supera los limites', () => {
  assert.equal(scrollProgress(10, 900, 900), 0);
  assert.equal(scrollProgress(500, 2000, 1000), .5);
  assert.equal(scrollProgress(-40, 2000, 1000), 0);
  assert.equal(scrollProgress(8000, 2000, 1000), 1);
  assert.equal(scrollProgress(NaN, 2000, 1000), 0);
});
test('modulos no necesitan navegador para ser importados', () => {
  assert.doesNotThrow(initMotion);
  assert.doesNotThrow(loadLocalLogos);
});
test('la identidad no usa gradientes, fuentes editoriales ni cartones simulados', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /(?:linear|radial|conic)-gradient\(/i);
  assert.doesNotMatch(html, /<em\b|bingo-ticket|ticket-grid|bingo-ball|Juegos Bryan/);
  assert.doesNotMatch(css, /Georgia|Times New Roman|font-style:\s*italic/);
  assert.match(html, /Nexo/);
});
