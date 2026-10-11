'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('v187 History tabs do not get Blue Light, including the pseudo-element or glyph observer', () => {
  const blue = read('bandmarkrLightV186.css');
  const light = read('bandmarkrLightV186.js');
  assert.match(blue, /\.stats-subtabs:not\(\.myconcerts-history-tabs\) > \.stats-subtab-btn\.active\s*[,\{]/);
  assert.match(blue, /\.stats-subtabs:not\(\.myconcerts-history-tabs\) > \.stats-subtab-btn\.active::before/);
  assert.match(light, /\.stats-subtabs:not\(\.myconcerts-history-tabs\) > \.stats-subtab-btn\.active/);
  assert.doesNotMatch(blue, /^\.stats-subtabs > \.stats-subtab-btn\.active/m);
  assert.match(read('musicSectionsV183.css'), /\.music-history-tabs-v183 > \.myconcerts-history-tab\.active\s*\{/);
});

test('v187 My Bands list matches the Past concert surface without recoloring unrelated cards', () => {
  const css = read('bandmarkrVisualV187.css');
  const shared = read('concertCardsV86.css');
  const bands = read('app.js');
  assert.match(css, /#screen-mybands \.row-card\.clickable\[data-band-id\]/);
  assert.match(css, /background-color: var\(--concert-card-background-v86\)/);
  assert.match(shared, /--concert-card-background-v86: #1d2124/);
  assert.match(shared, /--concert-card-background-v86: #eef1f5/);
  assert.match(bands, /class="row-card clickable" data-band-id=/);
  assert.doesNotMatch(css, /\.add-band-card\s*\{|#screen-concerts \.row-card\s*\{/);
});

test('v187 restrained header accent and stats-frame halo preserve layout', () => {
  const css = read('bandmarkrVisualV187.css');
  assert.match(css, /#app-header \.header-title \.brand-blue/);
  assert.match(css, /-webkit-background-clip: text/);
  assert.match(css, /text-shadow: 0 0 5px rgba\(76,149,255,\.25\)/);
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /#screen-myconcerts \.myconcerts-summary > \.start-top-bands-card/);
  assert.match(css, /#screen-myconcerts \.myconcerts-summary > \.stats-teaser-card/);
  assert.match(css, /box-shadow: 0 0 8px rgba\(61,128,250,\.24\)/);
  assert.doesNotMatch(css, /animation:|@keyframes|transition:|\.brand-banner\s*\{/);
});

test('v187 blue-gradient CTA covers all existing primary actions, but no grey controls or pills', () => {
  const css = read('bandmarkrVisualV187.css');
  assert.match(css, /^\.btn-primary,\s*\n\.discover-actions \.discover-add\s*\{/m);
  assert.match(css, /radial-gradient\(ellipse 72% 140% at 35% 43%/);
  assert.match(css, /linear-gradient\(105deg/);
  assert.doesNotMatch(css, /\.btn-secondary\s*[,\{]|\.toggle-pill\s*[,\{]|\.pill-inactive\s*[,\{]|\.listening-timeframe-btn\s*[,\{]/);
});

test('v187 visible build and QA shell versions are synchronized', () => {
  const html = read('index.html');
  const sw = read('service-worker.js');
  const build = JSON.parse(read('docs/LIVEVAULT_BUILD_STATE.json'));
  assert.match(read('version.js'), /const APP_VERSION = 'v187'/);
  assert.match(sw, /const CACHE_NAME_LITERAL = 'v187'/);
  assert.equal(build.appVersion, 'v187');
  assert.equal(build.serviceWorkerCacheVersion, 'v187');
  assert.equal(build.versionsMatch, true);
  assert.ok(html.includes('<link rel="stylesheet" href="bandmarkrVisualV187.css" />'));
  assert.ok(sw.includes("'./bandmarkrVisualV187.css'"));
  assert.ok(read('scripts/build-qa.js').includes("'bandmarkrVisualV187.css'"));
  assert.ok(read('scripts/generate-build-state.js').includes("'bandmarkrVisualV187.css'"));
  assert.ok(build.shellFiles.includes('bandmarkrVisualV187.css'));
});
