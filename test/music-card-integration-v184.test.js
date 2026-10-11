'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('v184 card integrations ship with identical app/cache version and QA/offline shells', () => {
  const html = read('index.html');
  const serviceWorker = read('service-worker.js');
  const qa = read('scripts/build-qa.js');
  const generator = read('scripts/generate-build-state.js');
  const state = JSON.parse(read('docs/LIVEVAULT_BUILD_STATE.json'));
  for (const file of ['musicCardIntegrationV184.js', 'musicCardIntegrationV184.css']) {
    assert.ok(html.includes(file), 'index missing ' + file);
    assert.ok(serviceWorker.includes("'./" + file + "'"), 'offline cache missing ' + file);
    assert.ok(qa.includes("'" + file + "'"), 'synthetic QA missing ' + file);
    assert.ok(generator.includes("'" + file + "'"), 'generator missing ' + file);
    assert.ok(state.shellFiles.includes(file), 'build state missing ' + file);
  }
  assert.match(read('version.js'), /const APP_VERSION = 'v185'/);
  assert.match(serviceWorker, /const CACHE_NAME_LITERAL = 'v185'/);
  assert.equal(state.appVersion, 'v185');
  assert.equal(state.serviceWorkerCacheVersion, 'v185');
  assert.equal(state.versionsMatch, true);
  assert.match(html, /<script src="musicSectionsV183.js"><\/script>\s*<script src="musicCardIntegrationV184.js"><\/script>/);
});

test('v184 leaves production data, original concert rendering and timeframe logic unchanged', () => {
  const source = read('musicCardIntegrationV184.js');
  const style = read('musicCardIntegrationV184.css');
  assert.doesNotMatch(source, /dlWriteJsonFile|dlReadJsonFile|fetch\s*\(|localStorage|remoteStore|Worker|R2/);
  assert.match(source, /wrapper\.append\(summary, chart\)/);
  assert.match(source, /music-history-first-card-v184/);
  assert.match(style, /\.myconcerts-history-tabs\.music-history-tabs-v183/);
  assert.match(style, /\.music-band-combined-v184 > \.listening-card/);
});
