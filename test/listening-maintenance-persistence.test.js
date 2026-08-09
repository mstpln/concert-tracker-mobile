'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const persistence = require('../scripts/lib/listeningMaintenancePersistence');
const { freshState } = require('../scripts/lib/usageTracker');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function fakeClient(initial) {
  const values = new Map(Object.entries(clone(initial)));
  const writes = [];
  return {
    values,
    writes,
    async readJson(path, fallback) {
      return clone(values.has(path) ? values.get(path) : fallback);
    },
    async writeJsonStrict(path, value) {
      writes.push(path);
      values.set(path, clone(value));
      return value;
    },
  };
}

function initialDocs() {
  const usage = freshState();
  usage.futureField = { keep: true };
  usage.spotify.dayOfCounts = '2026-08-08';
  usage.spotify.callsToday = 7;
  usage.spotify.callsThisRun = 99;
  return {
    [persistence.TRACK_IDENTITIES_PATH]: persistence.defaultIdentities(),
    [persistence.SPOTIFY_METADATA_PATH]: persistence.defaultSpotifyMetadata(),
    [persistence.API_USAGE_PATH]: usage,
  };
}

test('maintenance context preserves shared usage totals while resetting only per-run counters', async () => {
  const client = fakeClient(initialDocs());
  const context = await persistence.loadListeningMaintenanceContext(client, { today: '2026-08-08' });
  assert.equal(context.usageTracker.state.spotify.callsToday, 7);
  assert.equal(context.usageTracker.state.spotify.callsThisRun, 0);
  assert.equal(context.usageTracker.state.musicbrainz.callsThisRun, 0);
  assert.deepEqual(context.usageTracker.state.futureField, { keep: true });
});

test('bulk maintenance widens only the maintenance invocation provider ceilings', async () => {
  const client = fakeClient(initialDocs());
  const context = await persistence.loadListeningMaintenanceContext(client, { today: '2026-08-08', bulk: true });
  assert.equal(context.usageTracker.state.spotify.callsToday, 7);
  assert.equal(context.usageTracker.state.spotify.dailyCap, persistence.BULK_SPOTIFY_CAP);
  assert.equal(context.usageTracker.state.spotify.perRunCap, persistence.BULK_SPOTIFY_CAP);
  assert.equal(context.usageTracker.state.musicbrainz.perRunCap, persistence.BULK_MUSICBRAINZ_CAP);
  assert.equal(context.usage.state.listenbrainzCallsThisRun, 0);
});

test('preflight rejects a concurrent usage change before provider quota can be reserved', async () => {
  const client = fakeClient(initialDocs());
  const context = await persistence.loadListeningMaintenanceContext(client, { today: '2026-08-08' });
  const changed = clone(client.values.get(persistence.API_USAGE_PATH));
  changed.spotify.callsToday += 1;
  client.values.set(persistence.API_USAGE_PATH, changed);

  await assert.rejects(() => context.preflight({
    trackIdentities: context.trackIdentities,
    spotifyMetadata: context.spotifyMetadata,
  }), /apiUsage changed after load/);
});

test('usage reservation is conditionally persisted before the provider can be authorized', async () => {
  const client = fakeClient(initialDocs());
  const context = await persistence.loadListeningMaintenanceContext(client, { today: '2026-08-08' });
  assert.equal(await context.usage.reserve('spotify'), true);
  assert.deepEqual(client.writes, [persistence.API_USAGE_PATH]);
  const savedUsage = client.values.get(persistence.API_USAGE_PATH);
  assert.equal(savedUsage.spotify.callsToday, 8);
  assert.equal(savedUsage.listeningMaintenance.spotifyCallsThisRun, 1);
});

test('usage block reason is exposed through the persisted maintenance context', async () => {
  const docs = initialDocs();
  docs[persistence.API_USAGE_PATH].spotify.callsToday = persistence.BULK_SPOTIFY_CAP;
  const client = fakeClient(docs);
  const context = await persistence.loadListeningMaintenanceContext(client, { today: '2026-08-08', bulk: true });

  assert.equal(await context.usage.reserve('spotify'), false);
  assert.equal(context.usage.blockReason('spotify'), 'daily_cap');
  assert.deepEqual(client.writes, []);
});

test('failed usage persistence prevents provider authorization', async () => {
  const client = fakeClient(initialDocs());
  client.writeJsonStrict = async (path) => {
    client.writes.push(path);
    throw new Error('synthetic usage conflict');
  };
  const context = await persistence.loadListeningMaintenanceContext(client, { today: '2026-08-08' });
  await assert.rejects(() => context.usage.reserve('spotify'), (error) => {
    assert.equal(error.code, 'USAGE_PERSIST_FAILED');
    return true;
  });
  assert.deepEqual(client.writes, [persistence.API_USAGE_PATH]);
});

test('identity-only correction persistence is strict and does not touch usage or metadata', async () => {
  const client = fakeClient(initialDocs());
  const context = await persistence.loadListeningMaintenanceContext(client, { today: '2026-08-08', bulk: true });
  const nextIdentities = clone(context.trackIdentities);
  nextIdentities.updatedAt = '2026-08-09T14:10:00.000Z';
  nextIdentities.records['spotify:Track123'] = {
    workKey: 'spotify:Track123',
    status: 'retry',
    nextEligibleCheckAt: '2026-08-09T14:30:00.000Z',
    providers: { musicbrainz: { status: 'retry', reason: 'http_503', checkedAt: '2026-08-09T14:00:00.000Z' } },
  };

  assert.equal(await context.persistTrackIdentitiesOnly(nextIdentities), true);
  assert.deepEqual(client.writes, [persistence.TRACK_IDENTITIES_PATH]);
  assert.deepEqual(client.values.get(persistence.TRACK_IDENTITIES_PATH), nextIdentities);

  assert.equal(await context.preflight({
    trackIdentities: nextIdentities,
    spotifyMetadata: context.spotifyMetadata,
  }), true);
  assert.deepEqual(client.writes, [persistence.TRACK_IDENTITIES_PATH]);
});

test('identity-only correction persistence rejects stale remote identities before writing', async () => {
  const client = fakeClient(initialDocs());
  const context = await persistence.loadListeningMaintenanceContext(client, { today: '2026-08-08', bulk: true });
  const concurrent = clone(context.trackIdentities);
  concurrent.updatedAt = '2026-08-09T14:05:00.000Z';
  concurrent.records.concurrent = { workKey: 'text:concurrent', status: 'unresolved' };
  client.values.set(persistence.TRACK_IDENTITIES_PATH, concurrent);

  const nextIdentities = clone(context.trackIdentities);
  nextIdentities.updatedAt = '2026-08-09T14:10:00.000Z';
  await assert.rejects(() => context.persistTrackIdentitiesOnly(nextIdentities), /changed before correction persistence/);
  assert.deepEqual(client.writes, []);
});

test('persist attaches checkpoint before provider-owned derived documents', async () => {
  const client = fakeClient(initialDocs());
  const context = await persistence.loadListeningMaintenanceContext(client, { today: '2026-08-08' });
  assert.equal(await context.preflight({
    trackIdentities: context.trackIdentities,
    spotifyMetadata: context.spotifyMetadata,
  }), true);
  assert.equal(await context.usage.reserve('spotify'), true);

  const nextMetadata = clone(context.spotifyMetadata);
  nextMetadata.updatedAt = '2026-08-08T09:00:00.000Z';
  nextMetadata.records.Track123 = { spotifyTrackId: 'Track123', source: 'spotify_exact_track_id' };
  const nextIdentities = clone(context.trackIdentities);
  nextIdentities.updatedAt = '2026-08-08T09:00:00.000Z';
  nextIdentities.records['spotify:Track123'] = { workKey: 'spotify:Track123', localBandId: 'band-1', spotifyTrackId: 'Track123', providers: { spotify: { status: 'metadata' } } };
  const checkpoint = { kind: 'livevault-listening-maintenance-checkpoint', schemaVersion: 1, startedAt: '2026-08-08T09:00:00.000Z', updatedAt: '2026-08-08T09:00:00.000Z', completedStepKeys: ['spotify:exact_track:spotify:Track123'], haltReason: null };

  assert.equal(await context.persist({ trackIdentities: nextIdentities, spotifyMetadata: nextMetadata, checkpoint }), true);
  assert.deepEqual(client.writes, [
    persistence.API_USAGE_PATH,
    persistence.API_USAGE_PATH,
    persistence.SPOTIFY_METADATA_PATH,
    persistence.TRACK_IDENTITIES_PATH,
  ]);
  const savedUsage = client.values.get(persistence.API_USAGE_PATH);
  assert.equal(savedUsage.spotify.callsToday, 8);
  assert.equal(savedUsage.listeningMaintenance.spotifyCallsThisRun, 1);
  assert.deepEqual(savedUsage.listeningMaintenance.checkpoint, checkpoint);
});

test('unchanged Spotify metadata is not rewritten for MusicBrainz or ListenBrainz steps', async () => {
  const client = fakeClient(initialDocs());
  const context = await persistence.loadListeningMaintenanceContext(client, { today: '2026-08-08' });
  const nextIdentities = clone(context.trackIdentities);
  nextIdentities.updatedAt = '2026-08-08T09:00:00.000Z';
  nextIdentities.records['text:abc'] = { workKey: 'text:abc', localBandId: 'band-1', providers: { listenbrainz: { status: 'no_match' } } };
  await context.persist({ trackIdentities: nextIdentities, spotifyMetadata: context.spotifyMetadata, checkpoint: null });
  assert.deepEqual(client.writes, [persistence.API_USAGE_PATH, persistence.TRACK_IDENTITIES_PATH]);
});
