// 本機預覽用的簡易靜態伺服器：npm run serve
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};

createServer(async (req, res) => {
  let path = posix.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/]+/, '');
  if (path === '' || path.endsWith('/')) path += 'index.html';
  if (path.startsWith('..')) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
