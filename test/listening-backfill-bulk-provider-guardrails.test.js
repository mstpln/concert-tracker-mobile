'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryLib = require('../scripts/listening-inventory');
const runner = require('../scripts/listening-maintenance-runner');
const { createListeningMaintenanceProviders } = require('../scripts/lib/listeningMaintenanceProviders');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';

function inventory() {
  return inventoryLib.buildListeningInventory({
    bands: [{
      id: 'band-1',
      name: 'Synthetic Artist',
      musicbrainz: {
        mbid: MB_ARTIST,
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

function quotaResponse() {
  return {
    status: 429,
    ok: false,
    headers: { get() { return null; } },
    async json() { return { error: { status: 429, reason: 'QUOTA_EXCEEDED', message: 'synthetic quota' } }; },
  };
}

test('Spotify structured quota exhaustion becomes a provider-wide halt', async () => {
  const providers = createListeningMaintenanceProviders({
    fetchImpl: async () => quotaResponse(),
    spotifyTokenProvider: async () => 'synthetic-token',
  });
  const result = await providers.spotify.exact_track({ spotifyTrackId: 'SyntheticTrack1' });
  assert.deepEqual(result, { kind: 'halt', reason: 'spotify_quota_exceeded' });
});

test('provider-wide halt persists only the checkpoint and leaves the track runnable', async () => {
  const writes = [];
  const usageCalls = [];
  const result = await runner.runMaintenanceBatch({
    inventory: inventory(),
    providers: {
      spotify: { exact_track: async () => ({ kind: 'halt', reason: 'spotify_quota_exceeded' }) },
    },
    usage: {
      async reserve(provider) { usageCalls.push(provider); return true; },
    },
    preflight: async () => true,
    persist: async (snapshot) => { writes.push(snapshot); return true; },
    maxSteps: 100,
    now: '2026-08-09T12:00:00.000Z',
  });

  assert.deepEqual(usageCalls, ['spotify']);
  assert.equal(result.summary.attempted, 1);
  assert.equal(result.summary.persisted, 0);
  assert.equal(result.summary.halted, true);
  assert.equal(result.summary.haltReason, 'spotify:spotify_quota_exceeded');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].checkpoint.haltReason, 'spotify:spotify_quota_exceeded');
  assert.deepEqual(writes[0].checkpoint.completedStepKeys, []);
  assert.deepEqual(writes[0].trackIdentities.records, {});
  assert.equal(result.plan.spotify, 1);
  assert.equal(result.plan.planned, 1);
});
