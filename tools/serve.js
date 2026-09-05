#!/usr/bin/env node
/* Tiny zero-dependency static server for local use.
 *   node tools/serve.js [port]
 * Browsers treat http://localhost as a secure origin, so the service worker and
 * the "install this site as an app" button work from here.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
  const requested = decodeURIComponent(req.url.split('?')[0]);
  let target = path.join(ROOT, requested === '/' ? 'index.html' : requested);

  // Never serve anything outside the project directory.
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, 'index.html');
  }

  fs.readFile(target, (err, body) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(body);
  });
}).listen(PORT, () => {
  console.log(`Calendar & Notes running at http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop.');
});
