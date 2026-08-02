'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const policy = require('../scripts/lib/tavilyConcertPolicy');
const { cleanupReleaseFeed } = require('../scripts/lib/releaseFeedPolicy');

function at(iso) { return Date.parse(iso); }

function bandWithState(state = {}) {
  return { id: 'band-1', name: 'Example Band', structuredResearch: { routing: { tavilyConcert: state } } };
}

test('release cleanup keeps only actual Spotify catalogue releases and preserves their fields', () => {
  const kept = { id: 'keep', category: 'album', spotifyReleaseId: 'abc123', spotifyUrl: 'https://open.spotify.com/album/abc123', releaseType: 'Album', artworkUrl: 'https://i.scdn.co/image/example', unknownFutureField: { preserved: true } };
  const source = [
    kept,
    { id: 'article', category: 'album', headline: 'Album announced', sourceUrl: 'https://example.com/article' },
    { id: 'status', category: 'hiatus', headline: 'Band pauses touring' },
    { id: 'concert', category: 'concert', headline: 'New date' },
  ];
  const result = cleanupReleaseFeed(source);
  assert.deepEqual(result.kept, [kept]);
  assert.equal(result.summary.before, 4);
  assert.equal(result.summary.after, 1);
  assert.equal(result.summary.removed, 3);
});

test('new bands receive an immediate Tavily concert check', () => {
  const result = policy.eligibility({ id: 'new-band', structuredResearch: { routing: {} } }, [], at('2026-08-02T12:00:00Z'));
  assert.equal(result.due, true);
  assert.equal(result.reason, 'first_concert_web_check');
});

test('empty Tavily results back off for 30, 60 and then 90 days', () => {
  const first = policy.nextState(bandWithState(), [], 0, '2026-08-02T00:00:00Z');
  assert.equal(first.consecutiveEmpty, 1);
  assert.equal(first.nextEligibleAt, '2026-09-01T00:00:00.000Z');

  const second = policy.nextState(bandWithState(first), [], 0, '2026-09-01T00:00:00Z');
  assert.equal(second.consecutiveEmpty, 2);
  assert.equal(second.nextEligibleAt, '2026-10-31T00:00:00.000Z');

  const third = policy.nextState(bandWithState(second), [], 0, '2026-10-31T00:00:00Z');
  assert.equal(third.consecutiveEmpty, 3);
  assert.equal(third.nextEligibleAt, '2027-01-29T00:00:00.000Z');

  const fourth = policy.nextState(bandWithState(third), [], 0, '2027-01-29T00:00:00Z');
  assert.equal(fourth.consecutiveEmpty, 3);
  assert.equal(fourth.nextEligibleAt, '2027-04-29T00:00:00.000Z');
});

test('a concert observation resets Tavily backoff to the active cadence', () => {
  const prior = { consecutiveEmpty: 3, lastCheckedAt: '2026-07-01T00:00:00.000Z', nextEligibleAt: '2026-10-01T00:00:00.000Z' };
  const next = policy.nextState(bandWithState(prior), [], 1, '2026-08-02T00:00:00Z');
  assert.equal(next.consecutiveEmpty, 0);
  assert.equal(next.lastResult, 'concerts_found');
  assert.equal(next.nextEligibleAt, '2026-08-30T00:00:00.000Z');
});

test('recent Ticketmaster activity resets an old empty-result backoff', () => {
  const band = bandWithState({ consecutiveEmpty: 3, lastCheckedAt: '2026-07-01T00:00:00.000Z', nextEligibleAt: '2026-10-01T00:00:00.000Z' });
  const concerts = [{ bandId: 'band-1', ticketRetailerVerified: true, foundAt: '2026-08-01T00:00:00.000Z' }];
  const result = policy.eligibility(band, concerts, at('2026-08-30T00:00:00Z'));
  assert.equal(result.due, true);
  assert.equal(result.reason, 'ticketmaster_activity_reset');
  assert.equal(result.state.consecutiveEmpty, 0);
});

test('structured preload creates only actual Spotify release items', () => {
  require('../scripts/preloadStructuredRun');
  const { planLifecycleAlerts } = require('../scripts/lib/releaseAlertPlan');
  const band = { id: 'band-1', name: 'Example Band' };
  const actual = { lifecycleEligible: true, canonicalReleaseId: 'spotify:abc', title: 'Available Album', type: 'Album', releaseDate: '2026-08-02', spotifyReleaseId: 'abc', spotifyUrl: 'https://open.spotify.com/album/abc', artworkUrl: 'https://i.scdn.co/image/abc' };
  const future = { ...actual, canonicalReleaseId: 'spotify:future', title: 'Future Album', releaseDate: '2026-08-20', spotifyReleaseId: 'future', spotifyUrl: 'https://open.spotify.com/album/future' };
  const nonSpotify = { lifecycleEligible: true, canonicalReleaseId: 'mbid:one', title: 'Web Announcement', type: 'Album', releaseDate: '2026-08-02' };
  const plan = planLifecycleAlerts({ band, releases: [actual, future, nonSpotify], alerts: [], today: '2026-08-02T12:00:00.000Z' });
  assert.equal(plan.alertsToCreate.length, 1);
  assert.equal(plan.alertsToCreate[0].spotifyReleaseId, 'abc');
  assert.equal(plan.alertsToCreate[0].artworkUrl, actual.artworkUrl);
  assert.equal(plan.alertsToCreate[0].lifecycleStage, 'spotify_release');
});

test('structured preload reuses an existing Spotify release item instead of duplicating it', () => {
  require('../scripts/preloadStructuredRun');
  const { planLifecycleAlerts } = require('../scripts/lib/releaseAlertPlan');
  const release = { lifecycleEligible: true, canonicalReleaseId: 'spotify:abc', title: 'Available Album', type: 'Album', releaseDate: '2026-08-02', spotifyReleaseId: 'abc', spotifyUrl: 'https://open.spotify.com/album/abc' };
  const plan = planLifecycleAlerts({ band: { id: 'band-1', name: 'Example Band' }, releases: [release], alerts: [{ id: 'legacy-id', category: 'album', spotifyReleaseId: 'abc', spotifyUrl: release.spotifyUrl }], today: '2026-08-02T12:00:00.000Z' });
  assert.equal(plan.alertsToCreate.length, 0);
  assert.deepEqual(plan.alertsToEnrich, [{ id: 'legacy-id', lifecycleStage: 'spotify_release' }]);
  assert.equal(plan.lifecycleUpdates[0].alertId, 'legacy-id');
});

test('focused workflows separate structured providers from Tavily web research', () => {
  const structured = fs.readFileSync(path.join('.github', 'workflows', 'research.yml'), 'utf8');
  const tavily = fs.readFileSync(path.join('.github', 'workflows', 'tavily-concert-research.yml'), 'utf8');
  const cleanup = fs.readFileSync(path.join('.github', 'workflows', 'release-feed-cleanup.yml'), 'utf8');
  const scheduleGuard = /github\.event_name == 'workflow_dispatch' \|\| vars\.LIVEVAULT_RESEARCH_SCHEDULES_ENABLED == 'true'/;
  assert.match(structured, /0 1 \* \* 1,3,5/);
  assert.match(structured, scheduleGuard);
  assert.match(structured, /preloadStructuredRun\.js/);
  assert.doesNotMatch(structured, /cleanupReleaseFeed\.js/);
  assert.doesNotMatch(structured, /TAVILY_API_KEY/);
  assert.doesNotMatch(structured, /GROQ_API_KEY/);
  assert.match(tavily, scheduleGuard);
  assert.match(tavily, /tavilyConcertRun\.js/);
  assert.doesNotMatch(tavily, /SPOTIFY_CLIENT_ID/);
  assert.match(cleanup, /workflow_dispatch:/);
  assert.doesNotMatch(cleanup, /schedule:/);
  assert.match(cleanup, /news-before-v77-cleanup\.json/);
  assert.match(cleanup, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(structured, /group: live-vault-data-writes/);
  assert.match(tavily, /group: live-vault-data-writes/);
  assert.match(cleanup, /group: live-vault-data-writes/);
});

test('visible alert labels are Concerts and Releases everywhere', () => {
  const source = fs.readFileSync('v72FinalAdjustments.js', 'utf8');
  assert.match(source, />Concerts<\/button>/);
  assert.match(source, />Releases<\/button>/);
  assert.match(source, /\['news', 'Releases'\]/);
  assert.doesNotMatch(source, />News<\/button>/);
});
