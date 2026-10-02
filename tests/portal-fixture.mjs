import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { restrictProducts } from '../portal-gate.mjs';
import { APPS } from '../config.mjs';
export const portalContent = readFileSync(new URL('../functions/portal-content.html', import.meta.url), 'utf8');
export function portalHtml() {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    .replace('<div id="portal-content" hidden></div>', `<div id="portal-content" hidden>${portalContent}</div>`);
  const dom = new JSDOM(html);
  restrictProducts(dom.window.document, APPS);
  const result = dom.serialize(); dom.window.close(); return result;
}
