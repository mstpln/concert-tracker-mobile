'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('v186 palette matches approved asymmetric v3 and keeps the original next-concert spotlight', () => {
  const css = read('bandmarkrLightV186.css');
  const original = read('startConcertTabsV181.css');
  assert.match(css, /linear-gradient\(103deg,#102f85 0%,#2350c1 21%,#315edf 40%,#214abd 68%,#112a7e 100%\)/);
  assert.match(css, /linear-gradient\(104deg,#102d82 0%,#1c49b8 31%,#1c48af 60%,#0b2874 100%\)/);
  assert.match(css, /linear-gradient\(107deg,#102e83 0%,#2250bf 34%,#1947aa 59%,#09276e 100%\)/);
  assert.match(css, /at var\(--v186-first-letter-x,30%\) 50%/);
  assert.match(css, /at 48% 29%/);
  assert.match(original, /radial-gradient\(circle at 20% 38%, rgba\(126,181,255,.22\), transparent 34%\)/);
  assert.match(original, /linear-gradient\(90deg, #1858eb 0%, #0e46c7 42%, #072a81 100%\)/);
  assert.doesNotMatch(css, /animation\s*:|@keyframes|transition\s*:/);
});

test('v186 shimmering 1px stats-card outlines use a slightly deeper but still blue opposing edge', () => {
  const css = read('bandmarkrLightV186.css');
  assert.match(css, /#screen-myconcerts \.myconcerts-summary > \.start-top-bands-card::before/);
  assert.match(css, /#screen-myconcerts \.myconcerts-summary > \.stats-teaser-card::before/);
  assert.match(css, /rgba\(11,69,180,.78\) 58%/);
  assert.match(css, /rgba\(12,73,189,.80\) 76%/);
  assert.match(css, /padding: 1px/);
  assert.match(css, /pointer-events: none/);
  assert.match(css, /mask-composite: exclude/);
});

test('v186 unified past surface applies to every concert-listing renderer without recoloring unrelated UI', () => {
  const css = read('bandmarkrLightV186.css');
  assert.match(css, /#screen-myconcerts \.row-card-mc\.is-cancelled/);
  assert.match(css, /#screen-myconcerts \.row-card-mc\.is-past/);
  assert.match(css, /#screen-venue-detail \.row-card\.is-past/);
  assert.match(css, /opacity: 1/);
  assert.match(css, /#screen-profile \.profile-divider \.row-card/);
  assert.match(css, /#screen-concerts \.row-card\[data-band-id\]/);
  assert.match(css, /#screen-venue-detail \.row-card\[data-band-id\]/);
  assert.match(css, /background-color: var\(--concert-card-background-v86\)/);
  assert.doesNotMatch(css, /#screen-news \.row-card|#screen-mybands \.row-card|\.discover-card\s*\{/);
  const shared = read('concertCardsV86.css');
  assert.match(shared, /--concert-card-background-v86: #232a32/);
  assert.match(shared, /--concert-card-background-v86: #eef1f5/);
});

test('v186 first-letter locator does not mutate source labels or touch provider/persistent data', () => {
  const js = read('bandmarkrLightV186.js');
  assert.match(js, /range\.setStart\(text\.node, text\.first\)/);
  assert.match(js, /range\.setEnd\(text\.node, text\.first \+ 1\)/);
  assert.match(js, /--v186-first-letter-x/);
  assert.match(js, /MutationObserver/);
  assert.doesNotMatch(js, /innerHTML|replaceChildren|insertAdjacentHTML|fetch\(|localStorage|dlWriteJsonFile|remoteStore|R2|Cloudflare/);
});

test('v186 shell, QA, service-worker and deterministic build facts are synchronized', () => {
  const html = read('index.html'), sw = read('service-worker.js'),
    build = JSON.parse(read('docs/LIVEVAULT_BUILD_STATE.json'));
  assert.match(read('version.js'), /const APP_VERSION = 'v186'/);
  assert.match(sw, /const CACHE_NAME_LITERAL = 'v186'/);
  assert.equal(build.appVersion, 'v186');
  assert.equal(build.serviceWorkerCacheVersion, 'v186');
  assert.equal(build.versionsMatch, true);
  for (const file of ['bandmarkrLightV186.css','bandmarkrLightV186.js']) {
    assert.ok(html.includes(file), 'HTML missing ' + file);
    assert.ok(sw.includes("'./" + file + "'"), 'service-worker missing ' + file);
    assert.ok(read('scripts/build-qa.js').includes("'" + file + "'"), 'QA shell missing ' + file);
    assert.ok(read('scripts/generate-build-state.js').includes("'" + file + "'"), 'build-state generator missing ' + file);
    assert.ok(build.shellFiles.includes(file), 'build state missing ' + file);
  }
  assert.match(html, /<script src="musicCardIntegrationV184.js"><\/script>\s*<script src="bandmarkrLightV186.js"><\/script>/);
});
