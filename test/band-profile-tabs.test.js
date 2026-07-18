'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const identities = require('../providerIdentityState');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');

test('band profile tabs are ordered, accessible, reset on open, and preserve local tab state on rerender', () => {
  const tabs = app.slice(app.indexOf('function profileTabsHtml'), app.indexOf('function profileAlertsHtml'));
  const open = app.slice(app.indexOf('function openProfile'), app.indexOf('function bandEditFormHtml'));
  assert.match(tabs, /\['concerts', 'alerts', 'news', 'data'\]/);
  assert.match(tabs, /role="tablist"/);
  assert.match(tabs, /role="tab"/);
  assert.match(tabs, /aria-selected/);
  assert.match(tabs, /aria-controls="profile-tab-panel"/);
  assert.match(open, /profileTab = 'concerts';/);
  assert.match(app, /data-profile-tab/);
  assert.match(app, /renderProfileScreen\(bandId\)/);
});

test('band Alerts and News reuse existing renderers and filter exclusively by stable bandId', () => {
  const alerts = app.slice(app.indexOf('function profileAlertsHtml'), app.indexOf('function profileNewsHtml'));
  const news = app.slice(app.indexOf('function profileNewsHtml'), app.indexOf('function profileProviderUrl'));
  assert.match(alerts, /getAlertItems\(\)\.filter\(\(item\) => item\.bandId === bandId\)/);
  assert.match(alerts, /alerts\.map\(alertRowHtml\)/);
  assert.match(alerts, /No current alerts for this band\./);
  assert.match(news, /filter\(\(item\) => item\.bandId === bandId\)/);
  assert.match(news, /items\.map\(newsCardHtml\)/);
  assert.match(news, /No current news for this band\./);
  assert.match(app, /function getAlertItems\(\)/);
  assert.match(app, /function newsCardHtml\(n\)/);
});

test('band Data tab uses provider identity state, compact candidates, safe provider URLs, and no provider calls', () => {
  const data = app.slice(app.indexOf('function profileProviderUrl'), app.indexOf('function renderProfileScreen'));
  assert.match(data, /ProviderIdentityState\.statusForRecord/);
  assert.match(data, /ProviderIdentityState\.retryInfo/);
  assert.match(data, /ProviderIdentityState\.duplicateBandIds/);
  assert.match(data, /profileProviderCandidatesHtml/);
  assert.match(data, /reviewCandidates\.slice\(0, 5\)/);
  assert.match(data, /providerIdentityCandidateUrl/);
  assert.match(data, /Validated name fallback/);
  assert.match(data, /Linked through the confirmed MusicBrainz MBID/);
  assert.match(data, /MusicBrainz official Spotify relation/);
  assert.match(app, /navigator\.clipboard\?\.writeText/);
  assert.doesNotMatch(data, /fetch\(|recordSpotifyCall|recordTicketmasterCall/);
});

test('provider state keeps primary statuses separate from retry scheduling for the band Data tab', () => {
  const now = new Date('2026-07-18T00:00:00.000Z');
  for (const status of ['no_match', 'needs_review', 'error', 'unavailable']) {
    const record = { status, nextEligibleCheckAt: '2026-07-19T00:00:00.000Z' };
    assert.equal(identities.statusForRecord(record, 'spotify', false, now), status);
    assert.equal(identities.retryInfo(record, now).retryScheduled, true);
  }
  assert.equal(identities.statusForRecord({ id: 'same', status: 'confirmed' }, 'spotify', true, now), 'duplicate_conflict');
});

test('profile Data CSS keeps key-value rows, IDs, candidates, and four tabs mobile-safe', () => {
  assert.match(css, /\.profile-data-row/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /\.profile-data-id/);
  assert.match(css, /\.profile-data-candidate/);
  assert.match(css, /@media \(max-width: 390px\).*\.profile-tab-btn/s);
});
