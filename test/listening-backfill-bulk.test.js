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
  return {
    trackIdentities: { kind: 'livevault-track-identities', schemaVersion: 1, updatedAt: null, records: {} },
    spotifyMetadata: { kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} },
    checkpoint: null,
    usage: { reserve: async () => true },
    preflight: async () => true,
    persist: async () => true,
  };
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
