'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../scripts/lib/config');
const listenbrainz = require('../listenbrainzSync.js');
const historyV2 = require('../listeningHistoryV2.js');
const { createResolver, evidenceSpotifyUrl } = require('../scripts/lib/nonPlaylistTrackLinks');
const diagnostics = require('../scripts/lib/spotifyDiagnosticsV135');

test('v135 retires structured release monitoring and lifecycle alerts at the scheduled workflow boundary', () => {
  // Historical/direct helpers keep their base configuration; the scheduled
  // preload owns the v135 retirement boundary so unrelated callers are not
  // silently changed by importing config alone.
  assert.equal(config.STRUCTURED_RESEARCH.structuredReleaseMonitoringEnabled, true);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'preloadStructuredRun.js'), 'utf8');
  assert.match(preload, /structuredReleaseMonitoringEnabled = false/);
  assert.match(preload, /releaseAlertPlan\.planLifecycleAlerts = \(\) => \(\{ alertsToCreate: \[\], alertsToEnrich: \[\], lifecycleUpdates: \[\], skipped: \[\] \}\)/);
  assert.match(preload, /installSpotifyDiagnosticsV135\(spotify, UsageTracker\)/);
  assert.doesNotMatch(preload, /installSpotifyReleaseAlertPlan/);
});

test('v135 shell removes release alert compatibility script and loads cleanup UI', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
  assert.doesNotMatch(index, /releaseAlertsV122\.js/);
  assert.match(index, /providerReleaseCleanupV135\.js/);
  assert.doesNotMatch(worker, /releaseAlertsV122\.js/);
  assert.match(worker, /providerReleaseCleanupV135\.js/);
});

test('v135 cleanup override preserves listening and removes Releases tabs', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'providerReleaseCleanupV135.js'), 'utf8');
  assert.match(source, /\['listening', 'Listening'\]/);
  assert.match(source, /\['data', 'Data'\]/);
  assert.doesNotMatch(source, /\['news', 'Releases'\]/);
  assert.match(source, /No new concerts found in the last 90 days/);
});

test('ListenBrainz normalization retains bounded provider-neutral relationship evidence', () => {
  const event = listenbrainz.normalizeListen({ listened_at: 1785751200, track_metadata: { artist_name: 'Synthetic Artist', track_name: 'Synthetic Track', additional_info: {
    release_group_mbid: '12345678-1234-4123-8123-123456789abc', caa_id: '12345',
    url_rels: ['https://open.spotify.com/track/ListenBrainz123', 'http://unsafe.example/track'],
  } } });
  assert.deepEqual(event.listenbrainzUrlRels, ['https://open.spotify.com/track/ListenBrainz123']);
  assert.equal(event.musicbrainzReleaseGroupId, '12345678-1234-4123-8123-123456789abc');
  assert.equal(event.listenbrainzCaaId, '12345');
  const sanitized = historyV2.sanitizeEvent(event);
  assert.deepEqual(sanitized.listenbrainzUrlRels, event.listenbrainzUrlRels);
  assert.equal(sanitized.musicbrainzReleaseGroupId, event.musicbrainzReleaseGroupId);
});

test('trusted local Spotify identity resolves without provider work', () => {
  const resolver = createResolver([{ bandId: 'band-1', recordingTitle: 'Synthetic Song', spotifyTrackId: 'TrustedTrack123' }]);
  assert.equal(resolver.resolve({ bandId: 'band-1', recordingTitle: 'Synthetic Song' }), 'https://open.spotify.com/track/TrustedTrack123');
});

test('validated ListenBrainz and MusicBrainz Spotify relations resolve exactly and ambiguous relations fail closed', () => {
  assert.equal(evidenceSpotifyUrl({ listenbrainzUrlRels: ['https://open.spotify.com/track/ListenBrainz123'] }), 'https://open.spotify.com/track/ListenBrainz123');
  assert.equal(evidenceSpotifyUrl({ musicbrainzUrlRels: ['https://open.spotify.com/track/MusicBrainz123'] }), 'https://open.spotify.com/track/MusicBrainz123');
  assert.equal(evidenceSpotifyUrl({ musicbrainzUrlRels: ['https://open.spotify.com/track/One123', 'https://open.spotify.com/track/Two456'] }), null);
});

test('shared resolver fails closed when trusted sources conflict', () => {
  const resolver = createResolver();
  assert.equal(resolver.add({ bandId: 'band-1', recordingTitle: 'Synthetic Song', spotifyTrackId: 'One123' }), true);
  assert.equal(resolver.add({ bandId: 'band-1', recordingTitle: 'Synthetic Song', spotifyTrackId: 'Two456' }), false);
  assert.equal(resolver.resolve({ bandId: 'band-1', recordingTitle: 'Synthetic Song' }), null);
  assert.equal(resolver.hasConflict({ bandId: 'band-1', recordingTitle: 'Synthetic Song' }), true);
});

test('Spotify diagnostics remain aggregate and sanitized', () => {
  const usage = { state: { spotify: { callsThisRun: 4 } } };
  diagnostics.recordOperation(usage, { lane: 'historical_non_playlist', endpoint: 'track_search', before: 2, result: { kind: 'ok', url: 'https://open.spotify.com/track/private-id' } });
  const value = usage.state.spotify.diagnostics;
  assert.equal(value.callsByLane.historical_non_playlist, 2);
  assert.equal(value.callsByEndpoint.token, 1);
  assert.equal(value.callsByEndpoint.track_search, 1);
  assert.equal(value.outcomes.successful, 1);
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /private-id|open\.spotify\.com/);
});

test('Spotify diagnostics reset at each scheduled UsageTracker load', async () => {
  const persisted = {
    spotify: {
      callsThisRun: 0,
      diagnostics: {
        callsByLane: { historical_non_playlist: 8 },
        callsByEndpoint: { token: 1, track_search: 7 },
        outcomes: { successful: 7 },
        circuitEvents: [{ lane: 'historical_non_playlist' }],
        circuitStart: { status: 'closed', reason: null },
        circuitFinish: { status: 'open', reason: 'old_run' },
      },
    },
  };
  class FakeUsageTracker {}
  FakeUsageTracker.load = async () => ({ state: persisted });
  diagnostics.installSpotifyDiagnosticsV135({}, FakeUsageTracker);

  const first = await FakeUsageTracker.load();
  assert.deepEqual(first.state.spotify.diagnostics.callsByEndpoint, {});
  assert.deepEqual(first.state.spotify.diagnostics.callsByLane, {});
  assert.deepEqual(first.state.spotify.diagnostics.outcomes, {});
  assert.deepEqual(first.state.spotify.diagnostics.circuitEvents, []);
  assert.deepEqual(first.state.spotify.diagnostics.circuitStart, null);

  first.state.spotify.callsThisRun = 2;
  diagnostics.recordOperation(first, { lane: 'historical_non_playlist', endpoint: 'track_search', before: 0, result: { kind: 'ok' } });
  assert.equal(first.state.spotify.diagnostics.callsByEndpoint.token, 1);
  assert.equal(first.state.spotify.diagnostics.callsByEndpoint.track_search, 1);

  persisted.spotify.callsThisRun = 0;
  const second = await FakeUsageTracker.load();
  assert.deepEqual(second.state.spotify.diagnostics.callsByEndpoint, {});
  assert.deepEqual(second.state.spotify.diagnostics.callsByLane, {});
  assert.deepEqual(second.state.spotify.diagnostics.outcomes, {});
});
