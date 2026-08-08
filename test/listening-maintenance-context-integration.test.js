'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryLib = require('../scripts/listening-inventory');
const runner = require('../scripts/listening-maintenance-runner');
const persistence = require('../scripts/lib/listeningMaintenancePersistence');
const { freshState } = require('../scripts/lib/usageTracker');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';
const MB_RECORDING = '22222222-2222-4222-8222-222222222222';

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function fakeClient() {
  const values = new Map([
    [persistence.TRACK_IDENTITIES_PATH, persistence.defaultIdentities()],
    [persistence.SPOTIFY_METADATA_PATH, persistence.defaultSpotifyMetadata()],
    [persistence.API_USAGE_PATH, freshState()],
  ]);
  return {
    values,
    async readJson(path, fallback) { return clone(values.has(path) ? values.get(path) : fallback); },
    async writeJsonStrict(path, value) { values.set(path, clone(value)); return value; },
  };
}

function inventory() {
  return inventoryLib.buildListeningInventory({
    bands: [{ id: 'band-1', name: 'Synthetic Artist', musicbrainz: { mbid: MB_ARTIST, status: 'manual_confirmed', spotify: { id: 'SyntheticArtist1', status: 'manual_confirmed' } } }],
    events: [{ bandId: 'band-1', artistCreditName: 'Synthetic Artist', recordingTitle: 'Synthetic Song', spotifyTrackId: 'SyntheticTrack1' }],
  });
}

test('runner advances through maintenance context only after each durable synthetic step', async () => {
  const client = fakeClient();
  const context = await persistence.loadListeningMaintenanceContext(client, { today: '2026-08-08' });
  const result = await runner.runMaintenanceBatch({
    inventory: inventory(),
    trackIdentities: context.trackIdentities,
    spotifyMetadata: context.spotifyMetadata,
    checkpoint: context.checkpoint,
    usage: context.usage,
    preflight: context.preflight,
    persist: context.persist,
    maxSteps: 2,
    now: '2026-08-08T09:00:00.000Z',
    providers: {
      spotify: { exact_track: async () => ({ kind: 'ok', data: { id: 'SyntheticTrack1', artists: [{ id: 'SyntheticArtist1' }], external_ids: { isrc: 'USABC1234567' } } }) },
      musicbrainz: { isrc_lookup: async () => ({ kind: 'ok', data: { recordings: [{ id: MB_RECORDING, 'artist-credit': [{ artist: { id: MB_ARTIST } }] }] } }) },
    },
  });

  assert.equal(result.plan.complete, 1);
  assert.equal(result.summary.persisted, 2);
  const savedUsage = client.values.get(persistence.API_USAGE_PATH);
  assert.equal(savedUsage.listeningMaintenance.spotifyCallsThisRun, 1);
  assert.equal(savedUsage.listeningMaintenance.musicbrainzCallsThisRun, 1);
  assert.equal(savedUsage.listeningMaintenance.checkpoint.completedStepKeys.length, 2);
  assert.equal(client.values.get(persistence.SPOTIFY_METADATA_PATH).records.SyntheticTrack1.isrc, 'USABC1234567');
  assert.equal(client.values.get(persistence.TRACK_IDENTITIES_PATH).records['spotify:SyntheticTrack1'].musicbrainzRecordingId, MB_RECORDING);
});
