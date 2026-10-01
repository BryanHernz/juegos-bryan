import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { initExperience } from '../experience.mjs';
import { initMotion } from '../motion.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const html = read('index.html');

test('el monograma SVG coincide en navbar, hero, pie y favicon', () => {
  const dom = new JSDOM(html);
  const mark = new JSDOM(read('assets/nexo-mark.svg'), { contentType: 'image/svg+xml' });
  const favicon = new JSDOM(read('assets/favicon.svg'), { contentType: 'image/svg+xml' });
  try {
    const paths = document => [...document.querySelectorAll('path')].map(path => path.getAttribute('d'));
    const expected = paths(mark.window.document);
    assert.equal(expected.length, 2);
    assert.deepEqual(paths(dom.window.document.querySelector('#i-nexo')), expected);
    assert.deepEqual(paths(favicon.window.document), expected);
    assert.equal(dom.window.document.querySelectorAll('use[href="#i-nexo"]').length, 3);
    assert.equal(mark.window.document.documentElement.getAttribute('viewBox'), '0 0 32 32');
    assert.equal(favicon.window.document.documentElement.getAttribute('viewBox'), '0 0 32 32');
    assert.doesNotMatch(read('assets/nexo-mark.svg'), /<circle|gradient|<script|<image/);
  } finally { dom.window.close(); mark.window.close(); favicon.window.close(); }
});

test('la navegación conserva sus cuatro destinos y añade CTA móvil sin duplicar capítulos', () => {
  const dom = new JSDOM(html);
  try {
    const nav = dom.window.document.getElementById('site-nav');
    assert.deepEqual([...nav.querySelectorAll('[data-chapter]')].map(link => link.getAttribute('href')),
      ['#nova-star', '#carton-lleno', '#descargas', '#ayuda']);
    assert.equal(nav.querySelector('.mobile-cta').getAttribute('href'), '#nova-star');
    assert.equal(dom.window.document.querySelector('.header-inner > .header-cta').getAttribute('href'), '#nova-star');
    assert.doesNotMatch(html, /data-motion-toggle|Animaciones activas/);
  } finally { dom.window.close(); }
});

test('menú móvil admite teclado, Escape, salida de foco, click exterior y cambio de breakpoint', t => {
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:8081/', pretendToBeVisual: true });
  const { window } = dom, { document } = window;
  const previous = { window: globalThis.window, document: globalThis.document };
  const media = new Map();
  window.matchMedia = query => {
    if (!media.has(query)) {
      const target = new window.EventTarget();
      target.matches = query.includes('max-width');
      media.set(query, target);
    }
    return media.get(query);
  };
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
  globalThis.window = window; globalThis.document = document;
  let dispose;
  t.after(() => {
    dispose?.();
    for (const key of ['window', 'document']) {
      if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key];
    }
    window.close();
  });
  initExperience(); dispose = initMotion();
  const button = document.querySelector('.menu-toggle'), nav = document.getElementById('site-nav');
  button.focus();
  button.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.ok(nav.classList.contains('is-open'));
  assert.equal(document.activeElement, nav.querySelector('a'));
  document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, button);
  button.click();
  document.querySelector('.hero-links a').focus();
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  button.click();
  document.querySelector('main').click();
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  button.click();
  media.get('(min-width: 901px)').dispatchEvent(new window.Event('change'));
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  button.click();
  nav.querySelector('a').click();
  assert.equal(button.getAttribute('aria-expanded'), 'false');
});

test('Ayuda queda activa al final de la página aunque no alcance la línea de activación', t => {
  const dom = new JSDOM('<a data-chapter="descargas"></a><a data-chapter="ayuda"></a><section id="descargas"></section><div id="ayuda"></div>', { pretendToBeVisual: true });
  const { window } = dom, { document } = window;
  const previous = { window: globalThis.window, document: globalThis.document };
  let paint, dispose;
  window.matchMedia = () => Object.assign(new window.EventTarget(), { matches: false });
  window.requestAnimationFrame = callback => { paint = callback; return 1; };
  window.cancelAnimationFrame = () => {};
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 2000 });
  window.innerHeight = 800;
  window.scrollY = 1200;
  document.getElementById('descargas').getBoundingClientRect = () => ({ top: 0, bottom: 790 });
  document.getElementById('ayuda').getBoundingClientRect = () => ({ top: 600, bottom: 780 });
  globalThis.window = window; globalThis.document = document;
  t.after(() => {
    dispose?.();
    for (const key of ['window', 'document']) {
      if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key];
    }
    window.close();
  });
  dispose = initMotion(); paint();
  assert.equal(document.querySelector('[data-chapter="ayuda"]').getAttribute('aria-current'), 'true');
  assert.equal(document.querySelector('[data-chapter="descargas"]').hasAttribute('aria-current'), false);
  window.scrollY = 800;
  window.dispatchEvent(new window.Event('scroll')); paint();
  assert.equal(document.querySelector('[data-chapter="descargas"]').getAttribute('aria-current'), 'true');
  assert.equal(document.querySelector('[data-chapter="ayuda"]').hasAttribute('aria-current'), false);
});
