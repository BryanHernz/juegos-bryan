import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AppId } from '../tv/validation';

export function authorizedPortal(template: string, apps: AppId[]) {
  // Only versioned, server-owned HTML is parsed here. Markers are generated
  // from data-app/data-product at build time; never parse user/manifest HTML.
  const html = template.replace(/<!-- app:(novaStar|cartonLleno) -->([\s\S]*?)<!-- \/app:\1 -->/g,
    (_match, app: AppId, content: string) => apps.includes(app) ? content : '');
  const names = apps.map(app => app === 'novaStar' ? 'Nova Star' : 'Cartón Lleno').join(' y ');
  return html.replace('Descubre Nova Star y Cartón Lleno.', `Descubre ${names}.`);
}
export function portalTemplate() {
  return readFileSync(path.join(__dirname, '..', 'portal-content.html'), 'utf8');
}
