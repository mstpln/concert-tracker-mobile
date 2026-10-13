'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve('dist');
const host = process.env.HOST || '127.0.0.1';
const port = process.env.PORT || 4173;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

http.createServer((request, response) => {
  let raw;
  try {
    raw = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    return response.writeHead(400).end('Bad request');
  }
  const file = path.resolve(root, '.' + (raw === '/' ? '/index.html' : raw));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return response.writeHead(404).end('Not found');
  }
  response.writeHead(200, {
    'Content-Type': types[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  const stream = fs.createReadStream(file);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}).listen(port, host, () => console.log(`QA preview at http://${host}:${port}`));
