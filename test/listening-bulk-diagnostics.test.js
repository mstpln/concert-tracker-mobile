'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryLib = require('../scripts/listening-inventory');
const runner = require('../scripts/listening-maintenance-runner');
const bulk = require('../scripts/listening-backfill-bulk');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';

function band() {
  return {
    id: 'band-1',
    name: 'Synthetic Artist',
    musicbrainz: {
      mbid: MB_ARTIST,
      status: 'manual_confirmed',
      spotify: { id: 'SyntheticArtist1', status: 'manual_confirmed' },
    },
  };
}

function inventory(trackIds = ['ATrack'], spotifyMetadata = null) {
  return inventoryLib.buildListeningInventory({
    bands: [band()],
    events: trackIds.map((spotifyTrackId) => ({
      bandId: 'band-1',
      artistCreditName: 'Synthetic Artist',
      recordingTitle: `Song ${spotifyTrackId}`,
      spotifyTrackId,
    })),
    spotifyMetadata,
  });
}

const usage = { async reserve() { return true; } };
const preflight = async () => true;

test('provider-scoped Spotify failures retain a safe diagnostic reason without mutating the track', async () => {
  const snapshots = [];
  const result = await runner.runMaintenanceBatch({
    inventory: inventory(),
    providers: {
      spotify: {
        async exact_track() { return { kind: 'error', reason: 'spotify_network_error' }; },
      },
    },
    usage,
    preflight,
    async persist(snapshot) { snapshots.push(snapshot); return true; },
    haltOnItemError: false,
    deferOnProviderFailure: true,
    maxSteps: 1,
    now: '2026-08-09T18:30:00.000Z',
  });

  assert.equal(result.summary.attempted, 1);
  assert.equal(result.summary.persisted, 0);
  assert.deepEqual(result.deferredProviders, ['spotify']);
  assert.deepEqual(result.diagnostics.providerDeferrals.spotify, {
    kind: 'provider_error',
    reason: 'spotify_network_error',
  });
  assert.equal(result.diagnostics.outcomeReasonCounts.spotify['deferred:spotify_network_error'], 1);
  assert.deepEqual(snapshots[0].checkpoint.diagnostics, result.diagnostics);
  assert.equal(Object.prototype.hasOwnProperty.call(result.trackIdentities.records, 'spotify:ATrack'), false);
  assert.equal(JSON.stringify(result.diagnostics).includes('ATrack'), false);
});

test('MusicBrainz retry diagnostics survive as aggregate-safe checkpoint state', async () => {
  const spotifyMetadata = {
    kind: 'livevault-spotify-listening-metadata',
    schemaVersion: 1,
    updatedAt: '2026-08-09T18:00:00.000Z',
    records: {
      ZTrack: {
        spotifyTrackId: 'ZTrack',
        spotifyArtistIds: ['SyntheticArtist1'],
        isrc: 'USABC1234567',
      },
    },
  };
  const result = await runner.runMaintenanceBatch({
    inventory: inventory(['ZTrack'], spotifyMetadata),
    spotifyMetadata,
    providers: {
      musicbrainz: {
        async isrc_lookup() {
          return { kind: 'retry', reason: 'http_503', nextEligibleCheckAt: '2026-08-09T19:00:00.000Z' };
        },
      },
    },
    usage,
    preflight,
    async persist() { return true; },
    haltOnRetry: false,
    haltOnItemError: false,
    deferOnProviderFailure: true,
    maxSteps: 1,
    now: '2026-08-09T18:30:00.000Z',
  });

  assert.deepEqual(result.diagnostics.providerDeferrals.musicbrainz, { kind: 'retry', reason: 'http_503' });
  assert.equal(result.diagnostics.outcomeReasonCounts.musicbrainz['retry:http_503'], 1);
  assert.deepEqual(result.checkpoint.diagnostics, result.diagnostics);
  assert.equal(result.trackIdentities.records['spotify:ZTrack'].providers.musicbrainz.reason, 'http_503');
});

test('repeated malformed-item circuit breaker reports why the provider was deferred', async () => {
  const result = await runner.runMaintenanceBatch({
    inventory: inventory(['ATrack', 'BTrack', 'CTrack', 'DTrack']),
    providers: {
      spotify: {
        async exact_track({ spotifyTrackId }) {
          return {
            kind: 'ok',
            data: {
              id: spotifyTrackId,
              artists: [{ id: 'SyntheticArtist1' }],
              external_ids: { isrc: 'INVALID' },
            },
          };
        },
      },
    },
    usage,
    preflight,
    async persist() { return true; },
    haltOnItemError: false,
    deferOnProviderFailure: true,
    maxSteps: 10,
    now: '2026-08-09T18:30:00.000Z',
  });

  assert.deepEqual(result.diagnostics.providerDeferrals.spotify, {
    kind: 'circuit_breaker',
    reason: 'malformed_spotify_isrc',
  });
  assert.equal(result.diagnostics.outcomeReasonCounts.spotify['error:malformed_spotify_isrc'], 3);
  assert.equal(result.itemErrorReasonCounts.spotify.malformed_spotify_isrc, 3);
});

test('bulk progress summary exposes only safe aggregate diagnostics', () => {
  const diagnostics = {
    outcomeReasonCounts: {
      spotify: { 'metadata:spotify_metadata_with_isrc': 12 },
      musicbrainz: { 'retry:http_503': 1 },
    },
    providerDeferrals: {
      musicbrainz: { kind: 'retry', reason: 'http_503' },
      spotify: { kind: 'provider_error', reason: 'http_429' },
    },
  };
  const summary = bulk.safeProgressSummary({
    chunk: 5,
    attempted: 473,
    persisted: 472,
    result: {
      summary: { haltReason: 'provider_deferred:musicbrainz,spotify' },
      deferredProviders: ['musicbrainz', 'spotify'],
      diagnostics,
      plan: { planned: 11913 },
    },
  });

  assert.deepEqual(summary.diagnostics, diagnostics);
  assert.equal(JSON.stringify(summary).includes('trackKey'), false);
  assert.equal(JSON.stringify(summary).includes('ATrack'), false);
});
