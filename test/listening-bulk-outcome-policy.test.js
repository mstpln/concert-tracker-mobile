'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryLib = require('../scripts/listening-inventory');
const runner = require('../scripts/listening-maintenance-runner');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';
const MB_RECORDING = '22222222-2222-4222-8222-222222222222';

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

function mixedInventory() {
  const spotifyMetadata = {
    kind: 'livevault-spotify-listening-metadata',
    schemaVersion: 1,
    updatedAt: '2026-08-09T16:00:00.000Z',
    records: {
      ZTrack: {
        spotifyTrackId: 'ZTrack',
        spotifyArtistIds: ['SyntheticArtist1'],
        isrc: 'USABC1234567',
      },
    },
  };
  return { spotifyMetadata, inventory: inventory(['ATrack', 'ZTrack'], spotifyMetadata) };
}

function successfulMusicbrainzProvider(counter) {
  return {
    async isrc_lookup() {
      counter.count += 1;
      return {
        kind: 'ok',
        data: { recordings: [{ id: MB_RECORDING, 'artist-credit': [{ artist: { id: MB_ARTIST } }] }] },
      };
    },
  };
}

test('bulk item policy quarantines malformed track data and continues unrelated work', async () => {
  const persisted = [];
  let calls = 0;
  const result = await runner.runMaintenanceBatch({
    inventory: inventory(['ATrack', 'BTrack']),
    providers: {
      spotify: {
        async exact_track({ spotifyTrackId }) {
          calls += 1;
          if (spotifyTrackId === 'ATrack') {
            return {
              kind: 'ok',
              data: {
                id: 'ATrack',
                artists: [{ id: 'SyntheticArtist1' }],
                external_ids: { isrc: 'NOT-A-VALID-ISRC' },
              },
            };
          }
          return { kind: 'ok', data: { id: 'BTrack', artists: [{ id: 'SyntheticArtist1' }] } };
        },
      },
    },
    usage,
    preflight,
    async persist(snapshot) { persisted.push(snapshot); return true; },
    haltOnItemError: false,
    maxSteps: 2,
    now: '2026-08-09T16:20:00.000Z',
  });

  assert.equal(calls, 2);
  assert.equal(persisted.length, 2);
  assert.equal(result.trackIdentities.records['spotify:ATrack'].status, 'error');
  assert.equal(result.trackIdentities.records['spotify:ATrack'].providers.spotify.reason, 'malformed_spotify_isrc');
  assert.equal(result.trackIdentities.records['spotify:BTrack'].providers.spotify.status, 'metadata');
  assert.equal(result.summary.persisted, 2);
  assert.notEqual(result.summary.haltReason, 'spotify:error');
  assert.equal(result.itemErrorReasonCounts.spotify.malformed_spotify_isrc, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(result.checkpoint, 'itemErrorReasonCounts'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.checkpoint, 'itemErrorCounts'), false);
});

test('focused maintenance still stops on an item-level malformed provider payload', async () => {
  const result = await runner.runMaintenanceBatch({
    inventory: inventory(),
    providers: {
      spotify: {
        async exact_track() {
          return {
            kind: 'ok',
            data: {
              id: 'ATrack',
              artists: [{ id: 'SyntheticArtist1' }],
              external_ids: { isrc: 'NOT-A-VALID-ISRC' },
            },
          };
        },
      },
    },
    usage,
    preflight,
    async persist() { return true; },
    now: '2026-08-09T16:20:00.000Z',
  });

  assert.equal(result.summary.halted, true);
  assert.equal(result.summary.haltReason, 'spotify:error');
  assert.equal(result.trackIdentities.records['spotify:ATrack'].providers.spotify.reason, 'malformed_spotify_isrc');
});

test('focused provider failure stops without poisoning the current track', async () => {
  const persisted = [];
  const result = await runner.runMaintenanceBatch({
    inventory: inventory(),
    providers: {
      spotify: {
        async exact_track() { return { kind: 'error', reason: 'spotify_network_error' }; },
      },
    },
    usage,
    preflight,
    async persist(snapshot) { persisted.push(snapshot); return true; },
    haltOnItemError: false,
    now: '2026-08-09T16:20:00.000Z',
  });

  assert.equal(result.summary.halted, true);
  assert.equal(result.summary.haltReason, 'spotify:provider_error:spotify_network_error');
  assert.equal(result.summary.persisted, 0);
  assert.equal(persisted.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(result.trackIdentities.records, 'spotify:ATrack'), false);
  assert.equal(result.plan.spotify, 1);
});

test('bulk provider failure defers that provider, preserves its track, and continues other providers', async () => {
  const mixed = mixedInventory();
  let spotifyCalls = 0;
  const musicbrainzCalls = { count: 0 };
  const persisted = [];
  const result = await runner.runMaintenanceBatch({
    inventory: mixed.inventory,
    spotifyMetadata: mixed.spotifyMetadata,
    providers: {
      spotify: {
        async exact_track() {
          spotifyCalls += 1;
          return { kind: 'error', reason: 'spotify_network_error' };
        },
      },
      musicbrainz: successfulMusicbrainzProvider(musicbrainzCalls),
    },
    usage,
    preflight,
    async persist(snapshot) { persisted.push(snapshot); return true; },
    haltOnItemError: false,
    deferOnProviderFailure: true,
    maxSteps: 10,
    now: '2026-08-09T16:20:00.000Z',
  });

  assert.equal(spotifyCalls, 1);
  assert.equal(musicbrainzCalls.count, 1);
  assert.equal(persisted.length, 2);
  assert.equal(persisted[0].lastOutcome.status, 'deferred');
  assert.equal(Object.prototype.hasOwnProperty.call(result.trackIdentities.records, 'spotify:ATrack'), false);
  assert.equal(result.trackIdentities.records['spotify:ZTrack'].musicbrainzRecordingId, MB_RECORDING);
  assert.deepEqual(result.deferredProviders, ['spotify']);
  assert.equal(result.summary.halted, true);
  assert.equal(result.summary.haltReason, 'provider_deferred:spotify');
  assert.equal(result.summary.persisted, 1);
  assert.equal(result.plan.spotify, 1);
  assert.equal(result.plan.complete, 1);
});

test('bulk explicit provider-wide halt also defers only that provider and leaves the current track retryable', async () => {
  const mixed = mixedInventory();
  let spotifyCalls = 0;
  const musicbrainzCalls = { count: 0 };
  const persisted = [];
  const result = await runner.runMaintenanceBatch({
    inventory: mixed.inventory,
    spotifyMetadata: mixed.spotifyMetadata,
    providers: {
      spotify: {
        async exact_track() {
          spotifyCalls += 1;
          return { kind: 'halt', reason: 'spotify_quota_exceeded' };
        },
      },
      musicbrainz: successfulMusicbrainzProvider(musicbrainzCalls),
    },
    usage,
    preflight,
    async persist(snapshot) { persisted.push(snapshot); return true; },
    haltOnItemError: false,
    deferOnProviderFailure: true,
    maxSteps: 10,
    now: '2026-08-09T16:20:00.000Z',
  });

  assert.equal(spotifyCalls, 1);
  assert.equal(musicbrainzCalls.count, 1);
  assert.equal(persisted[0].lastOutcome.status, 'deferred');
  assert.equal(persisted[0].lastOutcome.reason, 'spotify:spotify_quota_exceeded');
  assert.equal(Object.prototype.hasOwnProperty.call(result.trackIdentities.records, 'spotify:ATrack'), false);
  assert.equal(result.trackIdentities.records['spotify:ZTrack'].musicbrainzRecordingId, MB_RECORDING);
  assert.deepEqual(result.deferredProviders, ['spotify']);
  assert.equal(result.summary.haltReason, 'provider_deferred:spotify');
  assert.equal(result.plan.spotify, 1);
});

test('bulk repeated-item-error circuit breaker defers a provider after three identical quarantines', async () => {
  let spotifyCalls = 0;
  const result = await runner.runMaintenanceBatch({
    inventory: inventory(['ATrack', 'BTrack', 'CTrack', 'DTrack']),
    providers: {
      spotify: {
        async exact_track({ spotifyTrackId }) {
          spotifyCalls += 1;
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
    now: '2026-08-09T16:20:00.000Z',
  });

  assert.equal(spotifyCalls, 3);
  assert.equal(result.summary.persisted, 3);
  assert.equal(result.itemErrorReasonCounts.spotify.malformed_spotify_isrc, 3);
  assert.deepEqual(result.deferredProviders, ['spotify']);
  assert.equal(result.summary.haltReason, 'provider_deferred:spotify');
  assert.equal(result.plan.spotify, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(result.trackIdentities.records, 'spotify:DTrack'), false);
});

test('different item-validation reasons do not trip the repeated-reason circuit breaker', async () => {
  let spotifyCalls = 0;
  const result = await runner.runMaintenanceBatch({
    inventory: inventory(['ATrack', 'BTrack', 'CTrack', 'DTrack']),
    providers: {
      spotify: {
        async exact_track({ spotifyTrackId }) {
          spotifyCalls += 1;
          if (spotifyTrackId === 'ATrack') {
            return { kind: 'ok', data: { id: spotifyTrackId, artists: [{ id: 'SyntheticArtist1' }], external_ids: { isrc: 'INVALID' } } };
          }
          if (spotifyTrackId === 'BTrack') {
            return { kind: 'ok', data: { id: spotifyTrackId, artists: [{ id: 'SyntheticArtist1' }], album: { id: 'bad-id!' } } };
          }
          if (spotifyTrackId === 'CTrack') {
            return { kind: 'ok', data: { id: spotifyTrackId, artists: [{ id: 'SyntheticArtist1' }], album: { images: [{ url: 'http://invalid.test/art.jpg' }] } } };
          }
          return { kind: 'ok', data: { id: spotifyTrackId, artists: [{ id: 'SyntheticArtist1' }] } };
        },
      },
    },
    usage,
    preflight,
    async persist() { return true; },
    haltOnItemError: false,
    deferOnProviderFailure: true,
    maxSteps: 4,
    now: '2026-08-09T16:20:00.000Z',
  });

  assert.equal(spotifyCalls, 4);
  assert.deepEqual(result.deferredProviders, []);
  assert.equal(result.itemErrorReasonCounts.spotify.malformed_spotify_isrc, 1);
  assert.equal(result.itemErrorReasonCounts.spotify.malformed_spotify_album_id, 1);
  assert.equal(result.itemErrorReasonCounts.spotify.malformed_spotify_artwork_url, 1);
  assert.equal(result.trackIdentities.records['spotify:DTrack'].providers.spotify.status, 'metadata');
});

test('repeated item-error counts carry only when explicitly passed to a later internal chunk', async () => {
  const allInventory = inventory(['ATrack', 'BTrack', 'CTrack', 'DTrack']);
  const provider = {
    spotify: {
      async exact_track({ spotifyTrackId }) {
        return {
          kind: 'ok',
          data: { id: spotifyTrackId, artists: [{ id: 'SyntheticArtist1' }], external_ids: { isrc: 'INVALID' } },
        };
      },
    },
  };
  const first = await runner.runMaintenanceBatch({
    inventory: allInventory,
    providers: provider,
    usage,
    preflight,
    async persist() { return true; },
    haltOnItemError: false,
    deferOnProviderFailure: true,
    maxSteps: 2,
    now: '2026-08-09T16:20:00.000Z',
  });
  assert.equal(first.itemErrorReasonCounts.spotify.malformed_spotify_isrc, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(first.checkpoint, 'itemErrorReasonCounts'), false);

  let secondCalls = 0;
  const second = await runner.runMaintenanceBatch({
    inventory: allInventory,
    trackIdentities: first.trackIdentities,
    spotifyMetadata: first.spotifyMetadata,
    checkpoint: first.checkpoint,
    itemErrorReasonCounts: first.itemErrorReasonCounts,
    providers: {
      spotify: {
        async exact_track({ spotifyTrackId }) {
          secondCalls += 1;
          return {
            kind: 'ok',
            data: { id: spotifyTrackId, artists: [{ id: 'SyntheticArtist1' }], external_ids: { isrc: 'INVALID' } },
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
    now: '2026-08-09T16:21:00.000Z',
  });

  assert.equal(secondCalls, 1);
  assert.equal(second.itemErrorReasonCounts.spotify.malformed_spotify_isrc, 3);
  assert.deepEqual(second.deferredProviders, ['spotify']);
  assert.equal(second.summary.haltReason, 'provider_deferred:spotify');
  assert.equal(second.plan.spotify, 1);
});

test('provider deferral at the batch boundary does not overrun maxSteps and leaves unrelated work for the next chunk', async () => {
  const spotifyMetadata = {
    kind: 'livevault-spotify-listening-metadata',
    schemaVersion: 1,
    updatedAt: '2026-08-09T16:00:00.000Z',
    records: {
      ATrack: {
        spotifyTrackId: 'ATrack',
        spotifyArtistIds: ['SyntheticArtist1'],
        isrc: 'USABC1234567',
      },
    },
  };
  let musicbrainzCalls = 0;
  let spotifyCalls = 0;
  const result = await runner.runMaintenanceBatch({
    inventory: inventory(['ATrack', 'ZTrack'], spotifyMetadata),
    spotifyMetadata,
    providers: {
      musicbrainz: {
        async isrc_lookup() {
          musicbrainzCalls += 1;
          return { kind: 'error', reason: 'http_500' };
        },
      },
      spotify: {
        async exact_track() {
          spotifyCalls += 1;
          return { kind: 'ok', data: { id: 'ZTrack', artists: [{ id: 'SyntheticArtist1' }] } };
        },
      },
    },
    usage,
    preflight,
    async persist() { return true; },
    haltOnItemError: false,
    deferOnProviderFailure: true,
    maxSteps: 1,
    now: '2026-08-09T16:20:00.000Z',
  });

  assert.equal(musicbrainzCalls, 1);
  assert.equal(spotifyCalls, 0);
  assert.equal(result.summary.attempted, 1);
  assert.equal(result.summary.persisted, 0);
  assert.equal(result.summary.halted, true);
  assert.equal(result.summary.haltReason, 'batch_limit');
  assert.deepEqual(result.deferredProviders, ['musicbrainz']);
  assert.equal(result.plan.musicbrainz, 1);
  assert.equal(result.plan.spotify, 1);
});

test('MusicBrainz non-transient adapter failures are provider-scoped and do not poison the current track in bulk mode', async () => {
  const spotifyMetadata = {
    kind: 'livevault-spotify-listening-metadata',
    schemaVersion: 1,
    updatedAt: '2026-08-09T16:00:00.000Z',
    records: {
      ZTrack: {
        spotifyTrackId: 'ZTrack',
        spotifyArtistIds: ['SyntheticArtist1'],
        isrc: 'USABC1234567',
      },
    },
  };
  for (const reason of ['http_500', 'musicbrainz_invalid_json']) {
    const persisted = [];
    const result = await runner.runMaintenanceBatch({
      inventory: inventory(['ZTrack'], spotifyMetadata),
      spotifyMetadata,
      providers: {
        musicbrainz: {
          async isrc_lookup() { return { kind: 'error', reason }; },
        },
      },
      usage,
      preflight,
      async persist(snapshot) { persisted.push(snapshot); return true; },
      haltOnItemError: false,
      deferOnProviderFailure: true,
      maxSteps: 1,
      now: '2026-08-09T16:20:00.000Z',
    });

    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].lastOutcome.status, 'deferred');
    assert.equal(persisted[0].lastOutcome.reason, `musicbrainz:provider_error:${reason}`);
    assert.equal(Object.prototype.hasOwnProperty.call(result.trackIdentities.records, 'spotify:ZTrack'), false);
    assert.deepEqual(result.deferredProviders, ['musicbrainz']);
    assert.equal(result.summary.attempted, 1);
    assert.equal(result.summary.persisted, 0);
    assert.equal(result.summary.haltReason, 'provider_deferred:musicbrainz');
  }
});

test('adapter-declared invalid input is item scoped while provider failures remain provider scoped', () => {
  assert.equal(runner.providerErrorScope({ kind: 'error', reason: 'invalid_spotify_track_id' }), 'item');
  assert.equal(runner.providerErrorScope({ kind: 'error', reason: 'invalid_isrc' }), 'item');
  assert.equal(runner.providerErrorScope({ kind: 'error', reason: 'http_500' }), 'provider');
  assert.equal(runner.providerErrorScope({ kind: 'error', reason: 'spotify_token_unavailable' }), 'provider');
  assert.equal(runner.providerErrorScope({ kind: 'error', reason: 'provider_adapter_exception' }), 'provider');
});
