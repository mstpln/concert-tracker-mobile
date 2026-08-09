'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryLib = require('../scripts/listening-inventory');
const runner = require('../scripts/listening-maintenance-runner');
const bulk = require('../scripts/listening-backfill-bulk');
const production = require('../scripts/listening-backfill-production');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';

function twoTrackInventory() {
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
    events: [
      { bandId: 'band-1', artistCreditName: 'Synthetic Artist', recordingTitle: 'Song One', spotifyTrackId: 'SyntheticTrack1' },
      { bandId: 'band-1', artistCreditName: 'Synthetic Artist', recordingTitle: 'Song Two', spotifyTrackId: 'SyntheticTrack2' },
    ],
  });
}

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
    events: [{ bandId: 'band-1', artistCreditName: 'Synthetic Artist', recordingTitle: 'Song One', spotifyTrackId: 'SyntheticTrack1' }],
    counts: { spotifyArchiveEvents: 1, incrementalObjects: 0, incrementalEvents: 0, totalEvents: 1 },
  };
}

test('focused maintenance still halts on needs_review by default', async () => {
  const writes = [];
  const result = await runner.runMaintenanceBatch({
    inventory: twoTrackInventory(),
    providers: {
      spotify: { exact_track: async () => ({ kind: 'needs_review', reason: 'synthetic_ambiguous' }) },
    },
    usage: { reserve: async () => true },
    preflight: async () => true,
    persist: async (snapshot) => { writes.push(snapshot); return true; },
    maxSteps: 2,
    now: '2026-08-09T14:00:00.000Z',
  });

  assert.equal(result.summary.attempted, 1);
  assert.equal(result.summary.persisted, 1);
  assert.equal(result.summary.halted, true);
  assert.equal(result.summary.haltReason, 'spotify:needs_review');
  assert.equal(writes.length, 1);
});

test('bulk policy persists and quarantines needs_review then continues unrelated work', async () => {
  const calls = [];
  const writes = [];
  const result = await runner.runMaintenanceBatch({
    inventory: twoTrackInventory(),
    providers: {
      spotify: {
        async exact_track({ spotifyTrackId }) {
          calls.push(spotifyTrackId);
          if (spotifyTrackId === 'SyntheticTrack1') return { kind: 'needs_review', reason: 'synthetic_ambiguous' };
          return { kind: 'no_match', reason: 'synthetic_missing' };
        },
      },
    },
    usage: { reserve: async () => true },
    preflight: async () => true,
    persist: async (snapshot) => { writes.push(snapshot); return true; },
    maxSteps: 2,
    haltOnNeedsReview: false,
    now: '2026-08-09T14:00:00.000Z',
  });

  assert.deepEqual(calls, ['SyntheticTrack1', 'SyntheticTrack2']);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].lastOutcome.status, 'needs_review');
  assert.equal(writes[0].checkpoint.haltReason, null);
  assert.equal(result.trackIdentities.records['spotify:SyntheticTrack1'].status, 'needs_review');
  assert.equal(result.summary.attempted, 2);
  assert.equal(result.summary.persisted, 2);
  assert.equal(result.summary.halted, true);
  assert.equal(result.summary.haltReason, 'batch_limit');
  assert.equal(result.plan.planned, 1);
  assert.equal(result.plan.no_route, 1);
  assert.equal(result.plan.listenbrainz, 1);
});

test('bulk review policy does not weaken retry halts', async () => {
  const result = await runner.runMaintenanceBatch({
    inventory: twoTrackInventory(),
    providers: {
      spotify: {
        exact_track: async () => ({
          kind: 'retry',
          reason: 'http_429',
          nextEligibleCheckAt: '2026-08-09T14:10:00.000Z',
        }),
      },
    },
    usage: { reserve: async () => true },
    preflight: async () => true,
    persist: async () => true,
    maxSteps: 2,
    haltOnNeedsReview: false,
    now: '2026-08-09T14:00:00.000Z',
  });

  assert.equal(result.summary.attempted, 1);
  assert.equal(result.summary.persisted, 1);
  assert.equal(result.summary.halted, true);
  assert.equal(result.summary.haltReason, 'spotify:retry');
  assert.equal(result.plan.retry_wait, 1);
});

test('bulk entrypoint explicitly opts into review quarantine policy', async () => {
  const context = {
    trackIdentities: { kind: 'livevault-track-identities', schemaVersion: 1, updatedAt: null, records: {} },
    spotifyMetadata: { kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} },
    checkpoint: null,
    usage: { reserve: async () => true },
    preflight: async () => true,
    persist: async () => true,
  };
  let observedPolicy = null;
  await bulk.runBulkBackfill({
    argv: ['--execute', '--write', '--max-total-steps', '1'],
    env: approvedEnv(),
    clientFactory() {
      return {
        async readJson(path, fallback) {
          if (path === 'bands.json') return [band()];
          return fallback;
        },
      };
    },
    async contextLoader() { return context; },
    async readAllSourceEvents() { return source(); },
    providerFactory() { return {}; },
    async maintenanceRunner(args) {
      observedPolicy = args.haltOnNeedsReview;
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
  assert.equal(observedPolicy, false);
});
