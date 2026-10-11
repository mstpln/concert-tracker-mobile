'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('v181 Start tab assets belong to HTML, QA, build state and offline service-worker shell', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const worker = fs.readFileSync('service-worker.js', 'utf8');
  const qa = fs.readFileSync('scripts/build-qa.js', 'utf8');
  const state = JSON.parse(fs.readFileSync('docs/LIVEVAULT_BUILD_STATE.json', 'utf8'));
  const generator = fs.readFileSync('scripts/generate-build-state.js', 'utf8');

  for (const file of ['startConcertTabsV181.css', 'startConcertTabsV181.js']) {
    assert.ok(html.includes(file), `index missing ${file}`);
    assert.ok(worker.includes(`'./${file}'`), `offline cache missing ${file}`);
    assert.ok(qa.includes(`'${file}'`), `synthetic QA shell missing ${file}`);
    assert.ok(generator.includes(`'${file}'`), `build-state generator missing ${file}`);
    assert.ok(state.shellFiles.includes(file), `build state missing ${file}`);
  }
  assert.equal(state.appVersion, 'v185');
  assert.equal(state.serviceWorkerCacheVersion, 'v185');
  assert.equal(state.versionsMatch, true);
});

test('v181 cancelled concert tabs switch real hidden state and preserve source records', () => {
  const app = fs.readFileSync('app.js', 'utf8');
  const tabs = fs.readFileSync('startConcertTabsV181.js', 'utf8');
  assert.match(app, /panel\.hidden = name !== key/);
  assert.match(tabs, /panel\.hidden = key !== active/);
  assert.match(app, /myConcertsHistoryTab = action === 'cancel' \? 'cancelled' : 'upcoming'/);
  assert.doesNotMatch(tabs, /dlWriteJsonFile|concerts\.json/);
});
