'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function pngSize(file) {
  const data = fs.readFileSync(path.join(root, file));
  assert.equal(data.subarray(1, 4).toString('ascii'), 'PNG');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

test('v87 exposes the approved BANDMARKR identity without changing internal storage identifiers', () => {
  const html = read('index.html');
  const manifest = JSON.parse(read('manifest.json'));
  const css = read('bandmarkrV87.css');
  const version = read('version.js');
  const serviceWorker = read('service-worker.js');

  assert.match(html, /<title>BANDMARKR<\/title>/);
  assert.match(html, /apple-mobile-web-app-title" content="BANDMARKR"/);
  assert.match(html, /brand-wordmark">BANDMARKR<\/span>/);
  assert.doesNotMatch(html, />THE LIVE VAULT</);
  assert.equal(manifest.name, 'BANDMARKR');
  assert.equal(manifest.short_name, 'BANDMARKR');
  assert.match(css, /--bandmarkr-blue:\s*#024ddf/);
  assert.match(css, /scaleX\(0\.78\)/);
  assert.match(version, /APP_VERSION = 'v87'/);
  assert.match(serviceWorker, /CACHE_NAME_LITERAL = 'v87'/);
  assert.match(serviceWorker, /concert-tracker-shell-/);
  assert.match(serviceWorker, /bandmarkrV87\.css/);

  assert.deepEqual(pngSize('icons/icon-192.png'), { width: 192, height: 192 });
  assert.deepEqual(pngSize('icons/icon-192-maskable.png'), { width: 192, height: 192 });
  assert.deepEqual(pngSize('icons/icon-512.png'), { width: 512, height: 512 });
  assert.deepEqual(pngSize('icons/icon-512-maskable.png'), { width: 512, height: 512 });
});
