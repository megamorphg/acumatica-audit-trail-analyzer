// Minimal static server for the panel preview. The preview loads the fixture
// as an ES module, which browsers refuse to do over file://.
//
//   node tools/serve.mjs [port]

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2]) || 8123;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(root, rel || 'test/panel-preview.html');

    // Never serve outside the project root.
    if (!file.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(file);
    const target = info.isDirectory() ? path.join(file, 'index.html') : file;
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(port, () => {
  console.log(`Serving ${root} at http://localhost:${port}/test/panel-preview.html`);
});
