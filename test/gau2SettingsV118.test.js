'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const gau2 = require(path.join(root, 'gau2SettingsV118.js'));
const source = fs.readFileSync(path.join(root, 'gau2SettingsV118.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'gau2SettingsV118.css'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const version = fs.readFileSync(path.join(root, 'version.js'), 'utf8');
const qaBuild = fs.readFileSync(path.join(root, 'scripts/build-qa.js'), 'utf8');

test('GAU2 automation names and approved Web Concert Search copy are stable', () => {
  assert.deepEqual(gau2.AUTOMATION_GROUPS.map((item) => item[0]), ['Concert Updates','Web Concert Search','Listening Updates','Artist Updates','Artist Images','Setlist Updates']);
  assert.equal(gau2.AUTOMATION_GROUPS[1][1], 'Looks for concerts that structured providers may have missed.');
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

test('missing or contradictory automation state is not reported as healthy', () => {
  assert.equal(gau2.statusFromRun(null).kind, 'warning');
  assert.equal(gau2.statusFromRun({ status: 'ok' }).kind, 'healthy');
  assert.equal(gau2.statusFromRun({ status: 'error' }).kind, 'failed');
  assert.equal(gau2.statusFromRun({ error: 'provider unavailable' }).kind, 'failed');
  assert.equal(gau2.statusFromRun({ status: 'ok', error: 'late failure' }).kind, 'failed');
});

test('setlist automation surfaces a caught setlist failure from an otherwise successful structured run', () => {
  assert.equal(gau2.setlistStatusFromRun({ status: 'ok', notes: [] }).kind, 'healthy');
  assert.equal(gau2.setlistStatusFromRun({ status: 'ok', notes: ['setlist.fm lookup failed for synthetic show: HTTP 503'] }).kind, 'failed');
  assert.equal(gau2.setlistStatusFromRun({ status: 'error', notes: [] }).kind, 'failed');
});

test('ListenBrainz is healthy only after a recorded successful sync', () => {
  assert.equal(gau2.listenBrainzAutomationState(null).kind, 'warning');
  assert.equal(gau2.listenBrainzAutomationState({ userName: 'qa-user' }).kind, 'warning');
  assert.equal(gau2.listenBrainzAutomationState({ lastSyncAt: 'not-a-date' }).kind, 'warning');
  assert.equal(gau2.listenBrainzAutomationState({ lastSyncAt: '2026-08-13T12:00:00.000Z' }).kind, 'healthy');
});

test('artist automation uses the newest recorded artist run', () => {
  const older = { finishedAt: '2026-08-12T12:00:00.000Z', status: 'ok' };
  const newer = { finishedAt: '2026-08-13T12:00:00.000Z', status: 'error' };
  assert.equal(gau2.latestRun(older, newer), newer);
  assert.equal(gau2.latestRun(newer, older), newer);
  assert.equal(gau2.latestRun(null, older), older);
});

test('approved schedules remain deterministic', () => {
  assert.equal(gau2.nextMwfUtc(new Date('2026-08-13T12:00:00Z')), '2026-08-14T01:00:00.000Z');
  assert.equal(gau2.nextFocusedWebUtc(new Date('2026-08-13T12:00:00Z')), '2026-08-15T02:00:00.000Z');
});

test('GAU2 presentation avoids repeated observed-subtree rewrites', () => {
  assert.match(source, /setHtmlIfChanged/);
  assert.match(source, /gau2Signature/);
  assert.match(source, /gau2Summary/);
  assert.doesNotMatch(source, /card\.innerHTML = automationRows\(\)\.map/);
});

test('GAU2 does not invent provider usage or a verified core connection', () => {
  assert.match(source, /Recent usage not reported/);
  assert.match(source, /Core Live Vault connection:<\/strong> Configured on this device/);
  assert.doesNotMatch(source, /Core Live Vault data:<\/strong> Connected/);
});

test('GAU2 leaves existing listening maintenance controls usable', () => {
  assert.doesNotMatch(css, /data-canonical-activation/);
  assert.doesNotMatch(css, /data-v104-listening-identity/);
  assert.doesNotMatch(css, /data-v99-spotify-listening-metadata/);
});

test('GAU2 assets and v118 shell are wired', () => {
  assert.match(index, /gau2SettingsV118\.css/);
  assert.match(index, /gau2SettingsV118\.js/);
  assert.match(sw, /gau2SettingsV118\.css/);
  assert.match(sw, /gau2SettingsV118\.js/);
  assert.match(qaBuild, /gau2SettingsV118\.css/);
  assert.match(qaBuild, /gau2SettingsV118\.js/);
  assert.match(version, /APP_VERSION = 'v118'/);
  assert.match(sw, /CACHE_NAME_LITERAL = 'v118'/);
  assert.match(css, /gau2-status\.is-failed/);
});
