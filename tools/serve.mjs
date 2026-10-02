import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_FILES } from './build.mjs';
import { appFromDownloadPath } from '../download.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8080);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.pdf': 'application/pdf', '.json': 'application/json; charset=utf-8' };
export function createPreviewServer() {
  return http.createServer(async (req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
      let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname.startsWith('/juegos-bryan/')) pathname = pathname.slice('/juegos-bryan'.length);
      if (pathname.startsWith('/pair/')) pathname = '/pair.html';
      if (appFromDownloadPath(pathname)) pathname = '/download.html';
      if (pathname.endsWith('/')) pathname += 'index.html';
      const target = path.resolve(root, '.' + pathname);
      if (!target.startsWith(root + path.sep) || pathname.split('/').some(p => p.startsWith('.'))) {
        res.writeHead(403); return res.end('Acceso denegado');
      }
      if (!PUBLIC_FILES.includes(pathname.slice(1)) && !/^\/assets\/[a-zA-Z0-9_./-]+$/.test(pathname)) {
        res.writeHead(404); return res.end('No encontrado');
      }
      if (!(await stat(target)).isFile()) throw new Error('No es un archivo');
      const body = await readFile(target);
      res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404); res.end('No encontrado'); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createPreviewServer().listen(port, '127.0.0.1', () => console.log(`Portal: http://127.0.0.1:${port}/`))
    .on('error', error => { console.error(error.message); process.exitCode = 1; });
}
