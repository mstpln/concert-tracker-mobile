'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryLib = require('../scripts/listening-inventory');
const runner = require('../scripts/listening-maintenance-runner');

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

function inventory(trackIds = ['ATrack']) {
  return inventoryLib.buildListeningInventory({
    bands: [band()],
    events: trackIds.map((spotifyTrackId) => ({
      bandId: 'band-1',
      artistCreditName: 'Synthetic Artist',
      recordingTitle: `Song ${spotifyTrackId}`,
      spotifyTrackId,
    })),
  });
}

const usage = { async reserve() { return true; } };
const preflight = async () => true;

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
          return {
            kind: 'ok',
            data: {
              id: 'BTrack',
              artists: [{ id: 'SyntheticArtist1' }],
            },
          };
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

test('provider-level adapter failures stop without poisoning the current track', async () => {
  const persisted = [];
  const result = await runner.runMaintenanceBatch({
    inventory: inventory(),
    providers: {
      spotify: {
        async exact_track() {
          return { kind: 'error', reason: 'spotify_network_error' };
        },
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

test('adapter-declared invalid input is item scoped while provider failures remain provider scoped', () => {
  assert.equal(runner.providerErrorScope({ kind: 'error', reason: 'invalid_spotify_track_id' }), 'item');
  assert.equal(runner.providerErrorScope({ kind: 'error', reason: 'invalid_isrc' }), 'item');
  assert.equal(runner.providerErrorScope({ kind: 'error', reason: 'http_500' }), 'provider');
  assert.equal(runner.providerErrorScope({ kind: 'error', reason: 'spotify_token_unavailable' }), 'provider');
  assert.equal(runner.providerErrorScope({ kind: 'error', reason: 'provider_adapter_exception' }), 'provider');
});
