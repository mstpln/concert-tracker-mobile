'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryLib = require('../scripts/listening-inventory');
const runner = require('../scripts/listening-maintenance-runner');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';
const MB_RECORDING = '22222222-2222-4222-8222-222222222222';

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

function usageGate(allowed = true) {
  const calls = [];
  return {
    calls,
    async reserve(provider) {
      calls.push(provider);
      return allowed;
    },
  };
}

function providers() {
  return {
    spotify: {
      async exact_track(input) {
        assert.equal(input.spotifyTrackId, 'SpotifyTrack123');
        return {
          kind: 'ok',
          data: {
            id: 'SpotifyTrack123',
            artists: [{ id: 'SpotifyArtist123' }],
            album: { id: 'SpotifyAlbum123', images: [{ url: 'https://example.test/art.jpg' }] },
            external_ids: { isrc: 'USABC1234567' },
          },
        };
      },
    },
    musicbrainz: {
      async isrc_lookup(input) {
        assert.equal(input.isrc, 'USABC1234567');
        assert.equal(input.trustedMusicbrainzArtistMbid, MB_ARTIST);
        return {
          kind: 'ok',
          data: {
            recordings: [{
              id: MB_RECORDING,
              'artist-credit': [{ artist: { id: MB_ARTIST } }],
            }],
          },
        };
      },
    },
    listenbrainz: {
      async metadata_lookup() {
        throw new Error('ListenBrainz should not be reached');
      },
    },
  };
}

const preflight = async () => {};

test('executes one planned provider step at a time and persists before continuing', async () => {
  const persisted = [];
  const usage = usageGate();
  let preflightCalls = 0;
  const result = await runner.runMaintenanceBatch({
    inventory: inventory(),
    providers: providers(),
    usage,
    maxSteps: 2,
    now: '2026-08-08T09:00:00.000Z',
    async preflight(snapshot) {
      preflightCalls += 1;
      assert.equal(snapshot.plan.planned, 1);
    },
    async persist(snapshot) { persisted.push(snapshot); },
  });

  assert.equal(preflightCalls, 1);
  assert.deepEqual(usage.calls, ['spotify', 'musicbrainz']);
  assert.equal(persisted.length, 2);
  assert.equal(persisted[0].lastStep.provider, 'spotify');
  assert.equal(persisted[0].spotifyMetadata.records.SpotifyTrack123.isrc, 'USABC1234567');
  assert.equal(persisted[1].lastStep.provider, 'musicbrainz');
  assert.equal(result.trackIdentities.records['spotify:SpotifyTrack123'].musicbrainzRecordingId, MB_RECORDING);
  assert.equal(result.plan.complete, 1);
});

test('persistence preflight fails before usage reservation or provider execution', async () => {
  let providerCalls = 0;
  const usage = usageGate();
  await assert.rejects(() => runner.runMaintenanceBatch({
    inventory: inventory(),
    providers: { spotify: { exact_track: async () => { providerCalls += 1; return { kind: 'error' }; } } },
    usage,
    async preflight() { throw new Error('stale persistence precondition'); },
    async persist() {},
  }), /stale persistence precondition/);
  assert.equal(usage.calls.length, 0);
  assert.equal(providerCalls, 0);
});

test('usage gate stops before provider execution or persistence', async () => {
  let providerCalls = 0;
  let writes = 0;
  const result = await runner.runMaintenanceBatch({
    inventory: inventory(),
    providers: {
      spotify: { exact_track: async () => { providerCalls += 1; return { kind: 'error' }; } },
    },
    usage: usageGate(false),
    preflight,
    async persist() { writes += 1; },
  });

  assert.equal(providerCalls, 0);
  assert.equal(writes, 0);
  assert.equal(result.summary.halted, true);
  assert.equal(result.summary.haltReason, 'usage_blocked:spotify');
});

test('retry outcome is persisted once and halts without hidden retry', async () => {
  let calls = 0;
  const writes = [];
  const result = await runner.runMaintenanceBatch({
    inventory: inventory(),
    providers: {
      spotify: {
        async exact_track() {
          calls += 1;
          return { kind: 'retry', reason: 'http_429', nextEligibleCheckAt: '2026-08-08T10:00:00.000Z' };
        },
      },
    },
    usage: usageGate(),
    preflight,
    now: '2026-08-08T09:00:00.000Z',
    async persist(snapshot) { writes.push(snapshot); },
  });

  assert.equal(calls, 1);
  assert.equal(writes.length, 1);
  assert.equal(result.summary.haltReason, 'spotify:retry');
  assert.equal(result.trackIdentities.records['spotify:SpotifyTrack123'].status, 'retry');
  assert.equal(result.trackIdentities.records['spotify:SpotifyTrack123'].nextEligibleCheckAt, '2026-08-08T10:00:00.000Z');
});

test('persistence failure stops the batch before another provider call', async () => {
  let spotifyCalls = 0;
  let musicbrainzCalls = 0;
  await assert.rejects(() => runner.runMaintenanceBatch({
    inventory: inventory(),
    providers: {
      ...providers(),
      spotify: {
        async exact_track(input) {
          spotifyCalls += 1;
          return providers().spotify.exact_track(input);
        },
      },
      musicbrainz: {
        async isrc_lookup(input) {
          musicbrainzCalls += 1;
          return providers().musicbrainz.isrc_lookup(input);
        },
      },
    },
    usage: usageGate(),
    preflight,
    async persist() { throw new Error('synthetic write conflict'); },
  }), /synthetic write conflict/);
  assert.equal(spotifyCalls, 1);
  assert.equal(musicbrainzCalls, 0);
});

test('hard batch cap and checkpoint validation fail closed', async () => {
  assert.throws(() => runner.boundedMaxSteps(101), /maxSteps/);
  assert.throws(() => runner.checkpointState({ kind: runner.CHECKPOINT_KIND, schemaVersion: 1, completedStepKeys: [7] }), /Invalid listening maintenance checkpoint/);
  assert.throws(() => runner.checkpointState({
    kind: runner.CHECKPOINT_KIND,
    schemaVersion: 1,
    startedAt: 'bad-date',
    updatedAt: '2026-08-08T09:00:00.000Z',
    completedStepKeys: [],
    haltReason: null,
  }), /Invalid listening maintenance checkpoint/);
});
