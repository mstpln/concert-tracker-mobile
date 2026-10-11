'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = file => fs.readFileSync(file, 'utf8');

test('v185 Highlights spacing is scoped to the two approved gaps', () => {
  const css = read('musicSectionsV183.css').split('/* v185: approved Highlights-only spacing')[1];
  assert.ok(css);
  assert.match(css, /#screen-myconcerts\[data-music-section-v183="highlights"\] > \.music-primary-tabs-v183\s*\{\s*margin-bottom:\s*0;/);
  assert.match(css, /#screen-myconcerts\[data-music-section-v183="highlights"\] > \.myconcerts-summary\s*\{\s*margin-top:\s*12px;/);
  assert.match(css, /#screen-myconcerts\[data-music-section-v183="highlights"\] > \.myconcerts-summary > \.start-top-bands-card\s*\{\s*margin-bottom:\s*12px;/);
  assert.doesNotMatch(css, /#tabbar|#content|font-size:|height:|padding:|position:/);
});
test('v185 version and existing offline/QA shell stay synchronized', () => {
  const state = JSON.parse(read('docs/LIVEVAULT_BUILD_STATE.json'));
  assert.match(read('version.js'), /const APP_VERSION = 'v185'/);
  assert.match(read('service-worker.js'), /const CACHE_NAME_LITERAL = 'v185'/);
  assert.equal(state.appVersion, 'v185');
  assert.equal(state.serviceWorkerCacheVersion, 'v185');
  assert.ok(state.versionsMatch);
  assert.ok(state.shellFiles.includes('musicSectionsV183.css'));
  assert.ok(state.shellFiles.includes('musicCardIntegrationV184.css'));
});
