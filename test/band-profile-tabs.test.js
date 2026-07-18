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

test('profile tab keyboard helper follows visible order with wrapping, Home, End, and safe unsupported keys', () => {
  const source = app.slice(app.indexOf('function profileTabForKey'), app.indexOf('function activateProfileTab'));
  const profileTabForKey = Function(`${source}; return profileTabForKey;`)();
  assert.equal(profileTabForKey('concerts', 'ArrowRight'), 'alerts');
  assert.equal(profileTabForKey('alerts', 'ArrowRight'), 'news');
  assert.equal(profileTabForKey('news', 'ArrowRight'), 'data');
  assert.equal(profileTabForKey('data', 'ArrowRight'), 'concerts');
  assert.equal(profileTabForKey('concerts', 'ArrowLeft'), 'data');
  assert.equal(profileTabForKey('data', 'ArrowLeft'), 'news');
  assert.equal(profileTabForKey('news', 'ArrowLeft'), 'alerts');
  assert.equal(profileTabForKey('alerts', 'ArrowLeft'), 'concerts');
  assert.equal(profileTabForKey('news', 'Home'), 'concerts');
  assert.equal(profileTabForKey('concerts', 'End'), 'data');
  assert.equal(profileTabForKey('concerts', 'Enter'), null);
});

test('profile tab activation shares click and keyboard behavior while restoring focus only on keyboard requests', () => {
  const handlers = app.slice(app.indexOf("container.querySelectorAll('.profile-tab-btn')"), app.indexOf("container.querySelectorAll('.profile-copy-id')"));
  const activation = app.slice(app.indexOf('function activateProfileTab'), app.indexOf('function profileAlertsHtml'));
  assert.match(handlers, /activateProfileTab\(bandId, button\.dataset\.profileTab\)/);
  assert.match(handlers, /keydown/);
  assert.match(handlers, /event\.preventDefault\(\)/);
  assert.match(handlers, /\{ focus: true \}/);
  assert.match(activation, /if \(focus\).*querySelector.*\.focus\(\)/s);
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

test('provider retry summary selects only future retries and reports due unresolved identities separately', () => {
  const now = new Date('2026-07-18T00:00:00.000Z');
  const futureTm = { status: 'no_match', nextEligibleCheckAt: '2026-07-22T00:00:00.000Z' };
  const futureSpotify = { status: 'error', nextEligibleCheckAt: '2026-07-20T00:00:00.000Z' };
  assert.deepEqual(identities.providerRetrySummary([{ provider: 'ticketmaster', record: futureTm }, { provider: 'spotify', record: futureSpotify }], now), { nextRetryAt: '2026-07-20T00:00:00.000Z', eligibleNow: false });
  assert.deepEqual(identities.providerRetrySummary([{ provider: 'ticketmaster', record: { status: 'needs_review', nextEligibleCheckAt: '2026-07-17T00:00:00.000Z' } }], now), { nextRetryAt: null, eligibleNow: true });
  assert.deepEqual(identities.providerRetrySummary([{ provider: 'spotify', record: { status: 'confirmed', id: 'confirmed', nextEligibleCheckAt: '2026-07-17T00:00:00.000Z' } }, { provider: 'ticketmaster', record: { status: 'manual_rejected', nextEligibleCheckAt: '2026-07-17T00:00:00.000Z' } }], now), { nextRetryAt: null, eligibleNow: false });
  assert.deepEqual(identities.providerRetrySummary([{ provider: 'spotify', record: { status: 'error', nextEligibleCheckAt: 'not-a-date' } }, { provider: 'ticketmaster', record: null }], now), { nextRetryAt: null, eligibleNow: false });
});

test('profile Data CSS keeps key-value rows, IDs, candidates, and four tabs mobile-safe', () => {
  assert.match(css, /\.profile-data-row/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /\.profile-data-id/);
  assert.match(css, /\.profile-data-candidate/);
  assert.match(css, /@media \(max-width: 390px\).*\.profile-tab-btn/s);
});
