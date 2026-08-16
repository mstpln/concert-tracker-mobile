'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../scripts/lib/config');
const { createResolver, evidenceSpotifyUrl } = require('../scripts/lib/nonPlaylistTrackLinks');
const diagnostics = require('../scripts/lib/spotifyDiagnosticsV135');

test('v135 retires structured release monitoring and lifecycle alerts at the scheduled workflow boundary', () => {
  assert.equal(config.STRUCTURED_RESEARCH.structuredReleaseMonitoringEnabled, false);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'preloadStructuredRun.js'), 'utf8');
  assert.match(preload, /structuredReleaseMonitoringEnabled = false/);
  assert.match(preload, /releaseAlertPlan\.planLifecycleAlerts = \(\) => \(\{ alertsToCreate: \[\], alertsToEnrich: \[\], lifecycleUpdates: \[\], skipped: \[\] \}\)/);
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
