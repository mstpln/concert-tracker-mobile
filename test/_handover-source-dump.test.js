'use strict';
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

test('temporary handover source capture', () => {
  const paths = [
    'scripts/research.js',
    'scripts/lib/structuredResearch.js',
    'scripts/lib/musicbrainz.js',
    'conflictMerge.js',
    'scripts/lib/workerClient.js',
    'test/musicbrainz.test.js',
    'test/structured-research.test.js',
    'docs/LIVEVAULT_STATE.md',
    'docs/LIVEVAULT_DECISIONS.md',
    'docs/LIVEVAULT_BUILD_STATE.json',
  ];
  const root = path.join('test-results', 'handover-source');
  for (const source of paths) {
    const target = path.join(root, source);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
});