'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bulk = require('../scripts/listening-backfill-bulk');
const production = require('../scripts/listening-backfill-production');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';

function approvedEnv() {
  return {
    CF_WORKER_ENDPOINT: 'https://worker.test/',
    DATA_MAINTENANCE_TOKEN: 'maintenance-secret',
    SPOTIFY_CLIENT_ID: 'spotify-client-id',
    SPOTIFY_CLIENT_SECRET: 'spotify-client-secret',
    LISTENBRAINZ_USER_TOKEN: 'listenbrainz-secret',
    [production.BACKFILL_CONFIRM_ENV]: production.BACKFILL_CONFIRMATION,
    [production.WRITE_CONFIRM_ENV]: production.WRITE_CONFIRMATION,
    [bulk.BULK_CONFIRM_ENV]: bulk.BULK_CONFIRMATION,
  };
}

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

function source() {
  return {
    events: [{ bandId: 'band-1', artistCreditName: 'Synthetic Artist', recordingTitle: 'Synthetic Song', spotifyTrackId: 'SyntheticTrack1' }],
    counts: { spotifyArchiveEvents: 1, incrementalObjects: 0, incrementalEvents: 0, totalEvents: 1 },
  };
}

function context() {
  const state = {
    trackIdentities: { kind: 'livevault-track-identities', schemaVersion: 1, updatedAt: null, records: {} },
    spotifyMetadata: { kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} },
    checkpoint: null,
    usage: { reserve: async () => true },
    preflight: async () => true,
    persist: async () => true,
  };
  state.persistTrackIdentitiesOnly = async (nextIdentities) => {
    state.trackIdentities = nextIdentities;
    return true;
  };
  return state;
}

function syntheticClient() {
  return {
    async readJson(path, fallback) {
      if (path === 'bands.json') return [band()];
      return fallback;
    },
  };
}

test('bulk backfill requires a third exact authorization before private reads', async () => {
  const env = approvedEnv();
  delete env[bulk.BULK_CONFIRM_ENV];
  let clientCreations = 0;
  let sourceReads = 0;
  await assert.rejects(() => bulk.runBulkBackfill({
    argv: ['--execute', '--write'],
    env,
    clientFactory() { clientCreations += 1; return {}; },
    async readAllSourceEvents() { sourceReads += 1; return source(); },
    log() {},
  }), /Refusing full backfill/);
  assert.equal(clientCreations, 0);
  assert.equal(sourceReads, 0);
});

test('bulk parser keeps a fixed total ceiling and rejects unknown options', () => {
  assert.equal(bulk.parseArgs(['--execute', '--write']).maxTotalSteps, bulk.MAX_TOTAL_STEPS);
  assert.equal(bulk.parseArgs(['--max-total-steps', '250']).maxTotalSteps, 250);
  assert.throws(() => bulk.parseArgs(['--max-total-steps', String(bulk.MAX_TOTAL_STEPS + 1)]), /max-total-steps/);
  assert.throws(() => bulk.parseArgs(['--provider', 'spotify']), /Unknown listening bulk-backfill option/);
});

test('legacy MusicBrainz transient errors revive only the failed provider state', () => {
  const document = {
    kind: 'livevault-track-identities',
    schemaVersion: 1,
    updatedAt: '2026-08-09T14:00:00.000Z',
    records: {
      transient: {
        workKey: 'spotify:SyntheticTrack1',
        status: 'error',
        futureField: { keep: true },
        providers: {
          spotify: { status: 'metadata', checkedAt: '2026-08-09T13:00:00.000Z' },
          musicbrainz: { status: 'error', reason: 'http_503', checkedAt: '2026-08-09T14:00:00.000Z' },
        },
      },
      terminal: {
        workKey: 'spotify:SyntheticTrack2',
        status: 'error',
        providers: { musicbrainz: { status: 'error', reason: 'http_500', checkedAt: '2026-08-09T14:00:00.000Z' } },
      },
    },
  };

  const recovered = bulk.reviveLegacyMusicbrainzTransientErrors(document, '2026-08-09T15:00:00.000Z');
  assert.notEqual(recovered, document);
  assert.equal(recovered.updatedAt, '2026-08-09T15:00:00.000Z');
  assert.equal(recovered.records.transient.status, 'retry');
  assert.equal(recovered.records.transient.updatedAt, '2026-08-09T15:00:00.000Z');
  assert.equal(recovered.records.transient.providers.musicbrainz.status, 'retry');
  assert.equal(recovered.records.transient.providers.musicbrainz.reason, 'http_503');
  assert.equal(recovered.records.transient.nextEligibleCheckAt, '2026-08-09T14:30:00.000Z');
  assert.deepEqual(recovered.records.transient.futureField, { keep: true });
  assert.equal(recovered.records.transient.providers.spotify.status, 'metadata');
  assert.equal(recovered.records.terminal.status, 'error');
  assert.equal(recovered.records.terminal.providers.musicbrainz.status, 'error');
  assert.equal(document.records.transient.status, 'error');
});

test('legacy MusicBrainz transient recovery fails closed on incomplete or non-transient evidence', () => {
  for (const record of [
    { status: 'error', providers: { musicbrainz: { status: 'error', reason: 'musicbrainz_invalid_json', checkedAt: '2026-08-09T14:00:00.000Z' } } },
    { status: 'error', providers: { musicbrainz: { status: 'error', reason: 'http_503' } } },
    { status: 'error', providers: { musicbrainz: { status: 'needs_review', reason: 'http_503', checkedAt: '2026-08-09T14:00:00.000Z' } } },
    { status: 'needs_review', providers: { musicbrainz: { status: 'error', reason: 'http_503', checkedAt: '2026-08-09T14:00:00.000Z' } } },
  ]) {
    assert.equal(bulk.legacyMusicbrainzTransientRetryAt(record), null);
  }
  assert.throws(() => bulk.reviveLegacyMusicbrainzTransientErrors({ records: {} }, 'invalid'), /valid timestamp/);
});

test('bulk backfill durably persists revived legacy MusicBrainz retry state before maintenance', async () => {
  const state = context();
  state.trackIdentities.records['spotify:SyntheticTrack1'] = {
    workKey: 'spotify:SyntheticTrack1',
    localBandId: 'band-1',
    spotifyTrackId: 'SyntheticTrack1',
    isrc: 'USABC1234567',
    status: 'error',
    updatedAt: '2026-08-09T14:00:00.000Z',
    nextEligibleCheckAt: null,
    providers: {
      spotify: { status: 'metadata', reason: 'spotify_metadata_with_isrc', checkedAt: '2026-08-09T13:59:00.000Z' },
      musicbrainz: { status: 'error', reason: 'musicbrainz_network_error', checkedAt: '2026-08-09T14:00:00.000Z' },
    },
  };
  let correctionWrites = 0;
  state.persistTrackIdentitiesOnly = async (nextIdentities) => {
    correctionWrites += 1;
    state.trackIdentities = nextIdentities;
    return true;
  };
  let observed;
  await bulk.runBulkBackfill({
    argv: ['--execute', '--write', '--max-total-steps', '1'],
    env: approvedEnv(),
    clientFactory() { return syntheticClient(); },
    async contextLoader() { return state; },
    async readAllSourceEvents() { return source(); },
    providerFactory() { return {}; },
    async maintenanceRunner(args) {
      observed = args.trackIdentities.records['spotify:SyntheticTrack1'];
      return {
        summary: { attempted: 0, persisted: 0, halted: false, haltReason: null },
        checkpoint: args.checkpoint,
        trackIdentities: args.trackIdentities,
        spotifyMetadata: args.spotifyMetadata,
        plan: { planned: 0, complete: 0, blocked: 0, retry_wait: 1, no_route: 0, spotify: 0, musicbrainz: 0, listenbrainz: 0 },
      };
    },
    now: () => '2026-08-09T14:10:00.000Z',
    log() {},
  });
  assert.equal(correctionWrites, 1);
  assert.equal(observed.status, 'retry');
  assert.equal(observed.updatedAt, '2026-08-09T14:10:00.000Z');
  assert.equal(observed.providers.musicbrainz.status, 'retry');
  assert.equal(observed.nextEligibleCheckAt, '2026-08-09T14:30:00.000Z');
});

test('bulk backfill continues only across durable batch-limit chunks', async () => {
  const logs = [];
  const state = context();
  let contextOptions = null;
  let runnerCalls = 0;
  const result = await bulk.runBulkBackfill({
    argv: ['--execute', '--write', '--max-total-steps', '150'],
    env: approvedEnv(),
    clientFactory() { return syntheticClient(); },
    async contextLoader(_client, options) { contextOptions = options; return state; },
    async readAllSourceEvents() { return source(); },
    providerFactory() { return {}; },
    async maintenanceRunner(args) {
      runnerCalls += 1;
      assert.equal(await args.preflight({
        trackIdentities: args.trackIdentities,
        spotifyMetadata: args.spotifyMetadata,
        checkpoint: args.checkpoint,
        nextStep: { provider: 'spotify' },
      }), true);
      assert.equal(await args.usage.reserve('spotify'), true);
      if (runnerCalls === 1) {
        assert.equal(args.maxSteps, 100);
        return {
          summary: { attempted: 100, persisted: 100, halted: true, haltReason: 'batch_limit' },
          checkpoint: { kind: 'livevault-listening-maintenance-checkpoint', schemaVersion: 1, startedAt: '2026-08-09T10:00:00.000Z', updatedAt: '2026-08-09T10:00:00.000Z', completedStepKeys: [], haltReason: 'batch_limit' },
          trackIdentities: args.trackIdentities,
          spotifyMetadata: args.spotifyMetadata,
          plan: { planned: 1, complete: 0, blocked: 0, retry_wait: 0, no_route: 0, spotify: 1, musicbrainz: 0, listenbrainz: 0 },
        };
      }
      assert.equal(args.maxSteps, 50);
      return {
        summary: { attempted: 1, persisted: 1, halted: false, haltReason: null },
        checkpoint: args.checkpoint,
        trackIdentities: args.trackIdentities,
        spotifyMetadata: args.spotifyMetadata,
        plan: { planned: 0, complete: 1, blocked: 0, retry_wait: 0, no_route: 0, spotify: 0, musicbrainz: 0, listenbrainz: 0 },
      };
    },
    log(value) { logs.push(String(value)); },
    now: () => '2026-08-09T10:00:00.000Z',
  });

  assert.deepEqual(contextOptions, { bulk: true });
  assert.equal(runnerCalls, 2);
  assert.equal(result.run.attempted, 101);
  assert.equal(result.run.persisted, 101);
  assert.equal(result.run.halted, false);
  assert.equal(result.run.haltReason, null);
  assert.equal(logs.some((line) => line.includes('Synthetic Artist')), false);
  assert.equal(logs.some((line) => line.includes('maintenance-secret')), false);
});

test('bulk backfill does not continue after a provider or safety halt', async () => {
  const state = context();
  let runnerCalls = 0;
  const result = await bulk.runBulkBackfill({
    argv: ['--execute', '--write'],
    env: approvedEnv(),
    clientFactory() { return syntheticClient(); },
    async contextLoader() { return state; },
    async readAllSourceEvents() { return source(); },
    providerFactory() { return {}; },
    async maintenanceRunner(args) {
      runnerCalls += 1;
      return {
        summary: { attempted: 1, persisted: 0, halted: true, haltReason: 'spotify:spotify_quota_exceeded' },
        checkpoint: args.checkpoint,
        trackIdentities: args.trackIdentities,
        spotifyMetadata: args.spotifyMetadata,
        plan: { planned: 1, complete: 0, blocked: 0, retry_wait: 0, no_route: 0, spotify: 1, musicbrainz: 0, listenbrainz: 0 },
      };
    },
    log() {},
  });
  assert.equal(runnerCalls, 1);
  assert.equal(result.run.halted, true);
  assert.equal(result.run.haltReason, 'spotify:spotify_quota_exceeded');
});

test('safety halt reason wins when the final attempted step also reaches the bulk ceiling', async () => {
  const state = context();
  const result = await bulk.runBulkBackfill({
    argv: ['--execute', '--write', '--max-total-steps', '1'],
    env: approvedEnv(),
    clientFactory() { return syntheticClient(); },
    async contextLoader() { return state; },
    async readAllSourceEvents() { return source(); },
    providerFactory() { return {}; },
    async maintenanceRunner(args) {
      return {
        summary: { attempted: 1, persisted: 0, halted: true, haltReason: 'spotify:spotify_quota_exceeded' },
        checkpoint: args.checkpoint,
        trackIdentities: args.trackIdentities,
        spotifyMetadata: args.spotifyMetadata,
        plan: { planned: 1, complete: 0, blocked: 0, retry_wait: 0, no_route: 0, spotify: 1, musicbrainz: 0, listenbrainz: 0 },
      };
    },
    log() {},
  });
  assert.equal(result.run.halted, true);
  assert.equal(result.run.haltReason, 'spotify:spotify_quota_exceeded');
});

test('bulk post-reservation preflight denial stops before provider execution', async () => {
  let preflights = 0;
  let providerCalls = 0;
  const state = context();
  state.preflight = async () => {
    preflights += 1;
    return preflights === 1;
  };
  await assert.rejects(() => bulk.runBulkBackfill({
    argv: ['--execute', '--write', '--max-total-steps', '1'],
    env: approvedEnv(),
    clientFactory() { return syntheticClient(); },
    async contextLoader() { return state; },
    async readAllSourceEvents() { return source(); },
    providerFactory() { return {}; },
    async maintenanceRunner(args) {
      const snapshot = {
        trackIdentities: args.trackIdentities,
        spotifyMetadata: args.spotifyMetadata,
        checkpoint: args.checkpoint,
        nextStep: { provider: 'spotify' },
      };
      assert.equal(await args.preflight(snapshot), true);
      await args.usage.reserve('spotify');
      providerCalls += 1;
      return { summary: {}, plan: {} };
    },
    log() {},
  }), /post-reservation preflight was not approved/);
  assert.equal(providerCalls, 0);
});

test('finishing exactly at the bulk step ceiling is not reported as halted when no work remains', async () => {
  const state = context();
  const result = await bulk.runBulkBackfill({
    argv: ['--execute', '--write', '--max-total-steps', '1'],
    env: approvedEnv(),
    clientFactory() { return syntheticClient(); },
    async contextLoader() { return state; },
    async readAllSourceEvents() { return source(); },
    providerFactory() { return {}; },
    async maintenanceRunner(args) {
      return {
        summary: { attempted: 1, persisted: 1, halted: false, haltReason: null },
        checkpoint: args.checkpoint,
        trackIdentities: args.trackIdentities,
        spotifyMetadata: args.spotifyMetadata,
        plan: { planned: 0, complete: 1, blocked: 0, retry_wait: 0, no_route: 0, spotify: 0, musicbrainz: 0, listenbrainz: 0 },
      };
    },
    log() {},
  });
  assert.equal(result.run.halted, false);
  assert.equal(result.run.haltReason, null);
});

test('long bulk runs refresh the cached Spotify client token before it becomes stale', async () => {
  const state = context();
  let current = 1000;
  let tokenCalls = 0;
  let callbacks;
  const result = await bulk.runBulkBackfill({
    argv: ['--execute', '--write', '--max-total-steps', '1'],
    env: approvedEnv(),
    clientFactory() { return syntheticClient(); },
    async contextLoader() { return state; },
    async readAllSourceEvents() { return source(); },
    providerFactory(value) { callbacks = value; return {}; },
    async spotifyTokenFactory() { tokenCalls += 1; return `token-${tokenCalls}`; },
    clock: () => current,
    async maintenanceRunner(args) {
      assert.equal(await callbacks.spotifyTokenProvider(), 'token-1');
      current += bulk.SPOTIFY_TOKEN_REUSE_MS - 1;
      assert.equal(await callbacks.spotifyTokenProvider(), 'token-1');
      current += 2;
      assert.equal(await callbacks.spotifyTokenProvider(), 'token-2');
      return {
        summary: { attempted: 0, persisted: 0, halted: false, haltReason: null },
        checkpoint: args.checkpoint,
        trackIdentities: args.trackIdentities,
        spotifyMetadata: args.spotifyMetadata,
        plan: { planned: 0, complete: 1, blocked: 0, retry_wait: 0, no_route: 0, spotify: 0, musicbrainz: 0, listenbrainz: 0 },
      };
    },
    log() {},
  });
  assert.equal(tokenCalls, 2);
  assert.equal(result.run.halted, false);
});
