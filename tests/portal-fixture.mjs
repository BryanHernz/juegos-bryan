import { readFileSync } from 'node:fs';
export const portalContent = readFileSync(new URL('../functions/portal-content.html', import.meta.url), 'utf8');
export function portalHtml() {
  return readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    .replace('<div id="portal-content" hidden></div>', `<div id="portal-content" hidden>${portalContent}</div>`);
}
