'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const gau2 = require(path.join(root, 'gau2SettingsV118.js'));
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'gau2SettingsV118.css'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const version = fs.readFileSync(path.join(root, 'version.js'), 'utf8');

test('GAU2 automation names are stable', () => {
  assert.deepEqual(gau2.AUTOMATION_GROUPS.map((item) => item[0]), ['Concert Updates','Web Concert Search','Listening Updates','Artist Updates','Artist Images','Setlist Updates']);
});

test('GAU2 provider set is stable', () => {
  assert.deepEqual(Object.keys(gau2.PROVIDER_PURPOSES), ['ticketmaster','tavily','groq','setlistfm','spotify','musicbrainz','listenbrainz']);
});

test('missing MusicBrainz confidence has a truthful fallback', () => {
  assert.equal(gau2.formatMusicbrainzConfidence(undefined), 'Confidence unavailable');
  assert.equal(gau2.formatMusicbrainzConfidence(null), 'Confidence unavailable');
  assert.equal(gau2.formatMusicbrainzConfidence(88), '88/100');
  assert.equal(gau2.repairMusicbrainzConfidenceHtml('undefined/100'), 'Confidence unavailable');
});

test('missing automation state is not reported as healthy', () => {
  assert.equal(gau2.statusFromRun(null).kind, 'warning');
  assert.equal(gau2.statusFromRun({ status: 'ok' }).kind, 'healthy');
  assert.equal(gau2.statusFromRun({ status: 'error' }).kind, 'failed');
});

test('approved schedules remain deterministic', () => {
  assert.equal(gau2.nextMwfUtc(new Date('2026-08-13T12:00:00Z')), '2026-08-14T01:00:00.000Z');
  assert.equal(gau2.nextFocusedWebUtc(new Date('2026-08-13T12:00:00Z')), '2026-08-15T02:00:00.000Z');
});

test('GAU2 assets and v118 shell are wired', () => {
  assert.match(index, /gau2SettingsV118\.css/);
  assert.match(index, /gau2SettingsV118\.js/);
  assert.match(sw, /gau2SettingsV118\.css/);
  assert.match(sw, /gau2SettingsV118\.js/);
  assert.match(version, /APP_VERSION = 'v118'/);
  assert.match(sw, /CACHE_NAME_LITERAL = 'v118'/);
  assert.match(css, /data-canonical-activation/);
  assert.match(css, /data-v104-listening-identity/);
  assert.match(css, /data-v99-spotify-listening-metadata/);
  assert.match(css, /gau2-status\.is-failed/);
});
