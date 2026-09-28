import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parallaxOffset, scrollProgress, motionEnabled, initMotion, loadLocalLogos} from '../motion.mjs';

test('parallax acotado a 44px y velocidades opuestas', () => {
  assert.equal(parallaxOffset(-5000, 200, 900, .1), 44);
  assert.equal(parallaxOffset(5000, 200, 900, .1), -44);
  assert.equal(parallaxOffset(100, 200, 900, .1), 25);
  assert.equal(parallaxOffset(100, 200, 900, -.1), -25);
});
test('movimiento reducido, mobile y apagado manual no desplazan contenido', () => {
  assert.equal(parallaxOffset(100, 200, 900, .1, false), 0);
  assert.equal(parallaxOffset(NaN, 200, 900, .1), 0);
  assert.equal(motionEnabled(true, false, 'on'), false);
  assert.equal(motionEnabled(false, true, 'on'), false);
  assert.equal(motionEnabled(false, false, 'off'), false);
  assert.equal(motionEnabled(false, false, null), true);
});
test('progreso no divide por cero ni supera los limites', () => {
  assert.equal(scrollProgress(10, 900, 900), 0);
  assert.equal(scrollProgress(500, 2000, 1000), .5);
  assert.equal(scrollProgress(-40, 2000, 1000), 0);
  assert.equal(scrollProgress(8000, 2000, 1000), 1);
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
  assert.match(html, /Sala Uno/);
});
