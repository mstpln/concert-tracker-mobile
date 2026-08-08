'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryLib = require('../scripts/listening-inventory');
const runner = require('../scripts/listening-maintenance-runner');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';

function inventory() {
  return inventoryLib.buildListeningInventory({
    bands: [{
      id: 'band-1',
      name: 'Example Band',
      musicbrainz: {
        mbid: MB_ARTIST,
        status: 'manual_confirmed',
        spotify: { id: 'SpotifyArtist123', status: 'manual_confirmed' },
      },
    }],
    events: [{
      bandId: 'band-1',
      artistCreditName: 'Example Band',
      recordingTitle: 'Exact Song',
      spotifyTrackId: 'SpotifyTrack123',
    }],
  });
}

function usage() {
  return { async reserve() { return true; } };
}

test('a persisted retry becomes eligible again when its explicit retry time is due', async () => {
  const inv = inventory();
  let firstCalls = 0;
  const first = await runner.runMaintenanceBatch({
    inventory: inv,
    providers: {
      spotify: {
        async exact_track() {
          firstCalls += 1;
          return { kind: 'retry', reason: 'http_429', nextEligibleCheckAt: '2026-08-08T10:00:00.000Z' };
        },
      },
    },
    usage: usage(),
    now: '2026-08-08T09:00:00.000Z',
    async persist() {},
  });
  assert.equal(firstCalls, 1);

  let secondCalls = 0;
  const second = await runner.runMaintenanceBatch({
    inventory: inv,
    trackIdentities: first.trackIdentities,
    spotifyMetadata: first.spotifyMetadata,
    checkpoint: first.checkpoint,
    providers: {
      spotify: {
        async exact_track() {
          secondCalls += 1;
          return {
            kind: 'ok',
            data: {
              id: 'SpotifyTrack123',
              artists: [{ id: 'SpotifyArtist123' }],
              external_ids: {},
            },
          };
        },
      },
    },
    usage: usage(),
    now: '2026-08-08T10:01:00.000Z',
    async persist() {},
  });

  assert.equal(secondCalls, 1);
  assert.equal(second.trackIdentities.records['spotify:SpotifyTrack123'].providers.spotify.status, 'metadata');
});
