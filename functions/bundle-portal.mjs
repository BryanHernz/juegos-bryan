import { copyFile } from 'node:fs/promises';
// Backend-owned, authenticated template: deliberately absent from _site.
await copyFile(new URL('./portal-content.html', import.meta.url), new URL('./lib/portal-content.html', import.meta.url));
