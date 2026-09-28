import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8080);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.startsWith('/juegos-bryan/')) pathname = pathname.slice('/juegos-bryan'.length);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const target = path.resolve(root, '.' + pathname);
    if (!target.startsWith(root + path.sep) || pathname.split('/').some(p => p.startsWith('.'))) {
      res.writeHead(403); return res.end('Acceso denegado');
    }
    if (!(await stat(target)).isFile()) throw new Error('No es un archivo');
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': (types[path.extname(target)] || 'application/octet-stream') + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404); res.end('No encontrado'); }
}).listen(port, '127.0.0.1', () => console.log(`Portal: http://127.0.0.1:${port}/`)).on('error', error => { console.error(error.message); process.exitCode = 1; });
