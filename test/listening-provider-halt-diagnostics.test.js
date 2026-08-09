'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryLib = require('../scripts/listening-inventory');
const runner = require('../scripts/listening-maintenance-runner');

function inventory() {
  return inventoryLib.buildListeningInventory({
    bands: [{
      id: 'band-1',
      name: 'Synthetic Artist',
      musicbrainz: {
        mbid: '11111111-1111-4111-8111-111111111111',
        status: 'manual_confirmed',
        spotify: { id: 'SyntheticArtist1', status: 'manual_confirmed' },
      },
    }],
    events: [{
      bandId: 'band-1',
      artistCreditName: 'Synthetic Artist',
      recordingTitle: 'Synthetic Song',
      spotifyTrackId: 'SyntheticTrack1',
    }],
  });
}

test('explicit Spotify quota halt is diagnosed as provider-wide without poisoning the track', async () => {
  const snapshots = [];
  const result = await runner.runMaintenanceBatch({
    inventory: inventory(),
    providers: {
      spotify: {
        async exact_track() { return { kind: 'halt', reason: 'spotify_quota_exceeded' }; },
      },
    },
    usage: { async reserve() { return true; } },
    preflight: async () => true,
    async persist(snapshot) { snapshots.push(snapshot); return true; },
    haltOnItemError: false,
    deferOnProviderFailure: true,
    maxSteps: 1,
    now: '2026-08-09T18:30:00.000Z',
  });

  assert.deepEqual(result.diagnostics.providerDeferrals.spotify, {
    kind: 'provider_halt',
    reason: 'spotify_quota_exceeded',
  });
  assert.equal(result.diagnostics.outcomeReasonCounts.spotify['deferred:spotify_quota_exceeded'], 1);
  assert.equal(Object.prototype.hasOwnProperty.call(result.trackIdentities.records, 'spotify:SyntheticTrack1'), false);
  assert.deepEqual(snapshots[0].checkpoint.diagnostics, result.diagnostics);
});
