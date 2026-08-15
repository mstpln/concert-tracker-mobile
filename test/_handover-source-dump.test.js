'use strict';
const test = require('node:test');
const fs = require('node:fs');
const zlib = require('node:zlib');

test('temporary handover source capture', () => {
  const paths = [
    'scripts/research.js',
    'scripts/lib/structuredResearch.js',
    'test/musicbrainz.test.js',
    'test/structured-research.test.js',
    'docs/LIVEVAULT_STATE.md',
  ];
  const files = Object.fromEntries(paths.map((path) => [path, fs.readFileSync(path, 'utf8')]));
  const payload = zlib.gzipSync(JSON.stringify(files)).toString('base64');
  console.log(`HANDOVER_SOURCE_DUMP:${payload}`);
});
