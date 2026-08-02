'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const security = require('../securityHardening.js');

test('external URL hardening allows HTTPS and rejects active or insecure schemes', () => {
  assert.equal(security.safeExternalUrl('javascript:alert(1)'), null);
  assert.equal(security.safeExternalUrl('data:text/html,test'), null);
  assert.equal(security.safeExternalUrl('http://example.com/path'), null);
  assert.equal(security.safeExternalUrl('https://example.com/path'), 'https://example.com/path');
});

test('production document declares a restrictive compatible security policy', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /securityHardening\.js/);
});

test('production service worker only deletes obsolete Live Vault shell caches', () => {
  const source = fs.readFileSync('service-worker.js', 'utf8');
  assert.match(source, /k\.startsWith\('concert-tracker-shell-'\) && k !== CACHE_NAME/);
  assert.doesNotMatch(source, /keys\.filter\(\(k\) => k !== CACHE_NAME\)/);
});

test('Worker applies bounded JSON validation and private response headers', () => {
  const source = fs.readFileSync('worker.js', 'utf8');
  assert.match(source, /MAX_JSON_BYTES = 10 \* 1024 \* 1024/);
  assert.match(source, /contentType !== 'application\/json'/);
  assert.match(source, /jsonRootIsValid/);
  assert.match(source, /'Cache-Control': 'private, no-store'/);
  assert.match(source, /'X-Content-Type-Options': 'nosniff'/);
});
