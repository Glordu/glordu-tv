// Static server for trying the app in a desktop browser. Serves the repo root
// so the app can read docs/ locally instead of from GitHub Pages:
//
//   node scripts/serve.mjs [port]
//   http://localhost:8080/app-tizen/index.html?config=/docs/v1/config.json

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
};

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (urlPath === '/') {
      res.writeHead(302, { Location: '/app-tizen/index.html?config=/docs/v1/config.json' });
      return res.end();
    }
    const file = path.join(ROOT, urlPath);
    if (!file.startsWith(ROOT + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`Serving ${ROOT} at http://localhost:${PORT}/`));
