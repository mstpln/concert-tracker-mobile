'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const storage = require('../listeningDerivedStorage.js');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('derived listening storage remains isolated from immutable source history', () => {
  assert.equal(storage.DB_NAME, 'bandmarkr-listening-derived-v1');
  assert.equal(storage.SOURCE_DB_NAME, 'livevault-listening-history-v1');
  assert.notEqual(storage.DB_NAME, storage.SOURCE_DB_NAME);
  const source = read('listeningDerivedStorage.js');
  assert.doesNotMatch(source, /indexedDB\.open\(SOURCE_DB_NAME/);
  assert.doesNotMatch(source, /deleteDatabase\(SOURCE_DB_NAME/);
});

test('v89 production and synthetic shells load the derived storage module', () => {
  const index = read('index.html');
  const serviceWorker = read('service-worker.js');
  const qaBuilder = read('scripts/build-qa.js');
  assert.match(index, /<script src="listeningDerivedStorage\.js"><\/script>/);
  assert.match(serviceWorker, /\.\/listeningDerivedStorage\.js/);
  assert.match(qaBuilder, /'listeningDerivedStorage\.js'/);
});
