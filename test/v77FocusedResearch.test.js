'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const policy = require('../scripts/lib/tavilyConcertPolicy');
const { cleanupReleaseFeed, isSpotifyReleaseItem } = require('../scripts/lib/releaseFeedPolicy');
const { planSpotifyReleaseAlerts } = require('../scripts/lib/spotifyReleaseAlertPlan');
const config = require('../scripts/lib/config');
const { UsageTracker, freshState } = require('../scripts/lib/usageTracker');

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

test('Spotify release planner creates only actual Spotify release items', () => {
  const band = { id: 'band-1', name: 'Example Band' };
  const actual = { lifecycleEligible: true, canonicalReleaseId: 'spotify:abc', title: 'Available Album', type: 'Album', releaseDate: '2026-08-02', spotifyReleaseId: 'abc', spotifyUrl: 'https://open.spotify.com/album/abc', artworkUrl: 'https://i.scdn.co/image/abc' };
  const future = { ...actual, canonicalReleaseId: 'spotify:future', title: 'Future Album', releaseDate: '2026-08-20', spotifyReleaseId: 'future', spotifyUrl: 'https://open.spotify.com/album/future' };
  const nonSpotify = { lifecycleEligible: true, canonicalReleaseId: 'mbid:one', title: 'Web Announcement', type: 'Album', releaseDate: '2026-08-02' };
  const plan = planSpotifyReleaseAlerts({ band, releases: [actual, future, nonSpotify], alerts: [], today: '2026-08-02T12:00:00.000Z' });
  assert.equal(plan.alertsToCreate.length, 1);
  assert.equal(plan.alertsToCreate[0].spotifyReleaseId, 'abc');
  assert.equal(plan.alertsToCreate[0].artworkUrl, actual.artworkUrl);
  assert.equal(plan.alertsToCreate[0].lifecycleStage, 'spotify_album_release');
  assert.equal(isSpotifyReleaseItem(plan.alertsToCreate[0]), true);
});

test('structured merge preserves Spotify newness after MusicBrainz and Spotify observations merge', () => {
  const structured = require('../scripts/lib/structuredResearch');
  const mb = structured.musicbrainzRelease({ id: 'mb-release', title: 'Same Release', 'primary-type': 'Album', 'first-release-date': '2026-08-14' }, 'mb-artist');
  const sp = structured.spotifyRelease({ id: 'spotify-release', name: 'Same Release', album_type: 'album', release_date: '2026-08-14', release_date_precision: 'day', artists: [{ id: 'spotify-artist', name: 'Example Band' }], external_urls: { spotify: 'https://open.spotify.com/album/spotify-release' } }, 'spotify-artist');
  const spotifyKey = structured.releaseKey(sp);
  const mergedObservations = structured.mergeReleaseList([mb, sp]);
  assert.equal(mergedObservations.length, 1);
  assert.equal(mergedObservations[0].musicbrainzReleaseGroupMbid, 'mb-release');
  assert.equal(mergedObservations[0].spotifyReleaseId, 'spotify-release');
  const canonical = structured.mergeLifecycleReleases([], mergedObservations, '2026-08-14T12:00:00.000Z', [spotifyKey]);
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].lifecycleEligible, true);
});

test('Spotify release planner catches up recent pre-fix releases that were already suppressed', () => {
  const release = {
    lifecycleEligible: false,
    canonicalReleaseId: 'spotify:recent',
    firstSeenAt: '2026-08-10T12:00:00.000Z',
    title: 'Recent Single',
    type: 'Single',
    releaseDate: '2026-07-25',
    spotifyReleaseId: 'recent',
    spotifyUrl: 'https://open.spotify.com/album/recent',
    artworkUrl: 'https://i.scdn.co/image/recent',
  };
  const plan = planSpotifyReleaseAlerts({ band: { id: 'band-1', name: 'Example Band' }, releases: [release], alerts: [], today: '2026-08-14T12:00:00.000Z' });
  assert.equal(plan.alertsToCreate.length, 1);
  assert.equal(plan.alertsToCreate[0].spotifyReleaseId, 'recent');
  assert.equal(plan.alertsToCreate[0].lifecycleStage, 'spotify_single_release');
  assert.equal(isSpotifyReleaseItem(plan.alertsToCreate[0]), true);
});

test('Spotify release planner does not let durable lifecycle eligibility bypass the 30-day recency bound', () => {
  const oldEligible = {
    lifecycleEligible: true,
    canonicalReleaseId: 'spotify:oldeligible',
    firstSeenAt: '2026-08-01T00:00:00.000Z',
    title: 'Old Eligible Album',
    type: 'Album',
    releaseDate: '2026-06-01',
    spotifyReleaseId: 'oldeligible',
    spotifyUrl: 'https://open.spotify.com/album/oldeligible',
  };
  const plan = planSpotifyReleaseAlerts({ band: { id: 'band-1', name: 'Example Band' }, releases: [oldEligible], alerts: [], today: '2026-08-15T12:00:00.000Z' });
  assert.equal(plan.alertsToCreate.length, 0);
  assert.equal(plan.skipped[0].reason, 'outside_recency_window');
});

test('Spotify release planner does not recreate a release after its typed lifecycle stage was generated', () => {
  const release = {
    lifecycleEligible: true,
    canonicalReleaseId: 'spotify:generated',
    title: 'Generated Album',
    type: 'Album',
    releaseDate: '2026-08-14',
    spotifyReleaseId: 'generated',
    spotifyUrl: 'https://open.spotify.com/album/generated',
    lifecycle: { spotify_album_release: { alertId: 'release-band-1-spotify-generated', generatedAt: '2026-08-14T12:00:00.000Z' } },
  };
  const plan = planSpotifyReleaseAlerts({ band: { id: 'band-1', name: 'Example Band' }, releases: [release], alerts: [], today: '2026-08-15T12:00:00.000Z' });
  assert.equal(plan.alertsToCreate.length, 0);
  assert.equal(plan.lifecycleUpdates.length, 0);
  assert.equal(plan.skipped[0].reason, 'already_generated');
});

test('Spotify release planner keeps future first baselines and old history silent and rejects malformed URLs', () => {
  const postFixBaseline = { lifecycleEligible: false, canonicalReleaseId: 'spotify:newband', firstSeenAt: '2026-08-15T00:00:00.000Z', title: 'Fresh Baseline Album', type: 'Album', releaseDate: '2026-08-14', spotifyReleaseId: 'newband', spotifyUrl: 'https://open.spotify.com/album/newband' };
  const old = { lifecycleEligible: false, canonicalReleaseId: 'spotify:old', firstSeenAt: '2026-08-01T00:00:00.000Z', title: 'Old Album', type: 'Album', releaseDate: '2026-06-01', spotifyReleaseId: 'old', spotifyUrl: 'https://open.spotify.com/album/old' };
  const malformed = { lifecycleEligible: true, canonicalReleaseId: 'spotify:bad', title: 'Bad Link', type: 'Single', releaseDate: '2026-08-14', spotifyReleaseId: 'bad', spotifyUrl: 'https://example.com/album/bad' };
  const plan = planSpotifyReleaseAlerts({ band: { id: 'band-1', name: 'Example Band' }, releases: [postFixBaseline, old, malformed], alerts: [], today: '2026-08-15T12:00:00.000Z' });
  assert.equal(plan.alertsToCreate.length, 0);
  assert.equal(plan.skipped.find(({ release }) => release === postFixBaseline)?.reason, 'baseline');
});

test('Spotify release planner reuses an existing release item instead of duplicating it', () => {
  const release = { lifecycleEligible: true, canonicalReleaseId: 'spotify:abc', title: 'Available Album', type: 'Album', releaseDate: '2026-08-02', spotifyReleaseId: 'abc', spotifyUrl: 'https://open.spotify.com/album/abc' };
  const plan = planSpotifyReleaseAlerts({ band: { id: 'band-1', name: 'Example Band' }, releases: [release], alerts: [{ id: 'legacy-id', category: 'album', spotifyReleaseId: 'abc', spotifyUrl: release.spotifyUrl }], today: '2026-08-02T12:00:00.000Z' });
  assert.equal(plan.alertsToCreate.length, 0);
  assert.deepEqual(plan.alertsToEnrich, [{ id: 'legacy-id', lifecycleStage: 'spotify_album_release' }]);
  assert.equal(plan.lifecycleUpdates[0].alertId, 'legacy-id');
});

test('structured preload wires the pure Spotify release planner before research loads', () => {
  const preload = fs.readFileSync(path.join('scripts', 'preloadStructuredRun.js'), 'utf8');
  assert.match(preload, /planSpotifyReleaseAlerts/);
  assert.match(preload, /releasePlan\.planLifecycleAlerts = planSpotifyReleaseAlerts/);
});

test('v122 release labels load after app.js and distinguish album and single availability', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const labels = fs.readFileSync('releaseAlertsV122.js', 'utf8');
  assert.ok(html.indexOf('<script src="releaseAlertsV122.js"></script>') > html.indexOf('<script src="app.js"></script>'));
  assert.match(labels, /spotify_album_release/);
  assert.match(labels, /NEW ALBUM/);
  assert.match(labels, /spotify_single_release/);
  assert.match(labels, /NEW SINGLE/);
});

test('focused workflows separate structured providers from Tavily web research and are scheduled', () => {
  const structured = fs.readFileSync(path.join('.github', 'workflows', 'research.yml'), 'utf8');
  const tavily = fs.readFileSync(path.join('.github', 'workflows', 'tavily-concert-research.yml'), 'utf8');
  const cleanup = fs.readFileSync(path.join('.github', 'workflows', 'release-feed-cleanup.yml'), 'utf8');
  assert.match(structured, /0 1 \* \* 1,3,5/);
  assert.doesNotMatch(structured, /LIVEVAULT_RESEARCH_SCHEDULES_ENABLED/);
  assert.match(structured, /preloadStructuredRun\.js/);
  assert.doesNotMatch(structured, /cleanupReleaseFeed\.js/);
  assert.doesNotMatch(structured, /TAVILY_API_KEY/);
  assert.doesNotMatch(structured, /GROQ_API_KEY/);
  assert.match(tavily, /0 2 1,15 \* \*/);
  assert.doesNotMatch(tavily, /LIVEVAULT_RESEARCH_SCHEDULES_ENABLED/);
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

test('Ticketmaster cap covers the current library with retry and growth headroom', () => {
  assert.equal(config.TICKETMASTER.perRunCap, 650);
  assert.ok(config.TICKETMASTER.perRunCap < config.TICKETMASTER.freeTierDailyLimit);
});

test('Ticketmaster pacing gate enforces the stricter published two-per-second guidance', async () => {
  assert.ok(config.TICKETMASTER.minDelayMs >= 600);
  assert.ok(1000 / config.TICKETMASTER.minDelayMs < 2);

  const usage = new UsageTracker(freshState());
  await usage.recordTicketmasterCall();
  const firstReservationAt = usage._lastTicketmasterCallAt;
  await usage.recordTicketmasterCall();

  assert.ok(usage._lastTicketmasterCallAt - firstReservationAt >= config.TICKETMASTER.minDelayMs);
  assert.equal(usage.state.ticketmaster.callsThisRun, 2);
  assert.equal(usage.state.ticketmaster.callsToday, 2);
});

test('visible alert labels are Concerts and Releases everywhere', () => {
  const source = fs.readFileSync('v72FinalAdjustments.js', 'utf8');
  assert.match(source, />Concerts<\/button>/);
  assert.match(source, />Releases<\/button>/);
  assert.match(source, /\['news', 'Releases'\]/);
  assert.doesNotMatch(source, />News<\/button>/);
});
