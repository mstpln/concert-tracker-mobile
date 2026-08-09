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

test('usage denial persists its safe diagnostic checkpoint before the batch stops', async () => {
  const snapshots = [];
  const result = await runner.runMaintenanceBatch({
    inventory: inventory(),
    providers: {
      spotify: {
        async exact_track() {
          throw new Error('provider must not be called after usage denial');
        },
      },
    },
    usage: {
      async reserve() { return false; },
      blockReason() { return 'daily_cap'; },
    },
    preflight: async () => true,
    async persist(snapshot) { snapshots.push(snapshot); return true; },
    maxSteps: 1,
    now: '2026-08-09T19:00:00.000Z',
  });

  assert.equal(result.summary.attempted, 0);
  assert.equal(result.summary.persisted, 0);
  assert.equal(result.summary.halted, true);
  assert.equal(result.summary.haltReason, 'usage_blocked:spotify');
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].lastOutcome.status, 'usage_blocked');
  assert.equal(snapshots[0].lastOutcome.reason, 'daily_cap');
  assert.equal(snapshots[0].checkpoint.diagnostics.usageBlocks.spotify, 'daily_cap');
  assert.equal(snapshots[0].checkpoint.diagnostics.outcomeReasonCounts.spotify['usage_blocked:daily_cap'], 1);
  assert.deepEqual(result.diagnostics, snapshots[0].checkpoint.diagnostics);
  assert.equal(Object.prototype.hasOwnProperty.call(result.trackIdentities.records, 'spotify:SyntheticTrack1'), false);
});
