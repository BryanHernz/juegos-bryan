import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
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
test('movimiento activo normalmente y reducido segun el sistema', () => {
  assert.equal(motionEnabled(true), false);
  assert.equal(motionEnabled(false), true);
  assert.equal(parallaxOffset(100, 200, 900, .1, false), 0);
});
test('en movil el efecto sigue activo con amplitud reducida', () => {
  assert.equal(motionEnabled(false), true);
  assert.equal(motionStrength(true), .45);
  assert.equal(motionStrength(false), 1);
  assert.ok(Math.abs(parallaxOffset(100, 400, 800, .2 * motionStrength(true))) < Math.abs(parallaxOffset(100, 400, 800, .2)));
});

test('ignora la antigua pausa manual y conserva accesibilidad y suspension automatica', () => {
  const dom = new JSDOM('<section data-motion-scene><div data-parallax="0.1" data-reveal="up"></div></section><p data-motion-status hidden role="status"></p>', {
    url: 'https://nexo.example/', pretendToBeVisual: true
  });
  const {window} = dom;
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const reduced = new window.EventTarget();
  reduced.matches = false;
  const compact = new window.EventTarget();
  compact.matches = false;
  window.matchMedia = query => query.includes('prefers-reduced-motion') ? reduced : compact;
  const frames = new Map();
  let frameId = 0;
  window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  window.cancelAnimationFrame = id => frames.delete(id);
  let hidden = false;
  Object.defineProperty(window.document, 'hidden', {get: () => hidden});
  window.localStorage.setItem('sala-uno.motion', 'off');
  const scene = window.document.querySelector('section');
  scene.getBoundingClientRect = () => ({top: 100, bottom: 300, height: 200});
  globalThis.window = window;
  globalThis.document = window.document;
  let dispose;
  try {
    dispose = initMotion();
    const html = window.document.documentElement;
    const plane = window.document.querySelector('[data-parallax]');
    const status = window.document.querySelector('[data-motion-status]');
    assert.equal(html.dataset.motion, 'on');
    assert.ok(html.classList.contains('motion-ready'));
    assert.equal(status.hidden, true);
    const [id, paint] = frames.entries().next().value;
    frames.delete(id);
    paint();
    assert.ok(parseFloat(plane.style.getPropertyValue('--parallax-y')) > 0);

    reduced.matches = true;
    reduced.dispatchEvent(new window.Event('change'));
    assert.equal(html.dataset.motion, 'reduced');
    assert.ok(html.classList.contains('motion-off'));
    assert.equal(plane.style.getPropertyValue('--parallax-y'), '0px');
    assert.ok(plane.classList.contains('is-visible'));
    assert.equal(status.hidden, false);
    assert.match(status.textContent, /movimiento reducido/);

    reduced.matches = false;
    reduced.dispatchEvent(new window.Event('change'));
    assert.equal(html.dataset.motion, 'on');
    assert.equal(status.hidden, true);
    hidden = true;
    window.document.dispatchEvent(new window.Event('visibilitychange'));
    assert.ok(html.classList.contains('motion-suspended'));
    assert.equal(frames.size, 0);
    hidden = false;
    window.document.dispatchEvent(new window.Event('visibilitychange'));
    assert.equal(html.classList.contains('motion-suspended'), false);
    assert.equal(frames.size, 1);
  } finally {
    dispose?.();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    window.close();
  }
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
test('la identidad no usa gradientes, fuentes editoriales ni cartones simulados', async () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const { portalHtml } = await import('./portal-fixture.mjs');
  const html = portalHtml();
  assert.doesNotMatch(css, /(?:linear|radial|conic)-gradient\(/i);
  assert.doesNotMatch(html, /<em\b|bingo-ticket|ticket-grid|bingo-ball|Juegos Bryan/);
  assert.doesNotMatch(css, /Georgia|Times New Roman|font-style:\s*italic/);
  assert.match(html, /Nexo/);
});
