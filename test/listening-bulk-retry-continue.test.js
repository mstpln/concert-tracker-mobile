'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryLib = require('../scripts/listening-inventory');
const runner = require('../scripts/listening-maintenance-runner');
const bulk = require('../scripts/listening-backfill-bulk');
const production = require('../scripts/listening-backfill-production');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';
const MB_RECORDING = '22222222-2222-4222-8222-222222222222';

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

test('non-halting retry mode defers the retrying provider and continues other providers', async () => {
  const inventory = inventoryLib.buildListeningInventory({
    bands: [band()],
    events: [
      { bandId: 'band-1', artistCreditName: 'Synthetic Artist', recordingTitle: 'A', spotifyTrackId: 'ATrack' },
      { bandId: 'band-1', artistCreditName: 'Synthetic Artist', recordingTitle: 'B', spotifyTrackId: 'BTrack' },
      { bandId: 'band-1', artistCreditName: 'Synthetic Artist', recordingTitle: 'Z', spotifyTrackId: 'ZTrack' },
    ],
    spotifyMetadata: {
      kind: 'livevault-spotify-listening-metadata',
      schemaVersion: 1,
      updatedAt: '2026-08-09T15:00:00.000Z',
      records: {
        ZTrack: {
          spotifyTrackId: 'ZTrack',
          spotifyArtistIds: ['SyntheticArtist1'],
          isrc: 'USABC1234567',
        },
      },
    },
  });
  let spotifyCalls = 0;
  let musicbrainzCalls = 0;
  const persisted = [];
  const result = await runner.runMaintenanceBatch({
    inventory,
    providers: {
      spotify: {
        async exact_track() {
          spotifyCalls += 1;
          return { kind: 'retry', reason: 'http_429', nextEligibleCheckAt: '2026-08-09T16:00:00.000Z' };
        },
      },
      musicbrainz: {
        async isrc_lookup() {
          musicbrainzCalls += 1;
          return {
            kind: 'ok',
            data: { recordings: [{ id: MB_RECORDING, 'artist-credit': [{ artist: { id: MB_ARTIST } }] }] },
          };
        },
      },
    },
    usage: { async reserve() { return true; } },
    preflight: async () => true,
    async persist(snapshot) { persisted.push(snapshot); return true; },
    haltOnRetry: false,
    maxSteps: 10,
    now: '2026-08-09T15:00:00.000Z',
  });

  assert.equal(spotifyCalls, 1);
  assert.equal(musicbrainzCalls, 1);
  assert.equal(persisted.length, 2);
  assert.deepEqual(result.deferredProviders, ['spotify']);
  assert.equal(result.summary.halted, false);
  assert.equal(result.summary.haltReason, null);
  assert.equal(result.plan.spotify, 1);
  assert.equal(result.plan.retry_wait, 1);
  assert.equal(result.plan.complete, 1);
});

test('bulk mode carries provider deferral across chunks and stops only when deferred work is all that remains', async () => {
  const state = {
    trackIdentities: { kind: 'livevault-track-identities', schemaVersion: 1, updatedAt: null, records: {} },
    spotifyMetadata: { kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} },
    checkpoint: null,
    usage: { reserve: async () => true },
    preflight: async () => true,
    persist: async () => true,
    persistTrackIdentitiesOnly: async () => true,
  };
  let calls = 0;
  const result = await bulk.runBulkBackfill({
    argv: ['--execute', '--write', '--max-total-steps', '200'],
    env: approvedEnv(),
    clientFactory() {
      return { async readJson(path, fallback) { return path === 'bands.json' ? [band()] : fallback; } };
    },
    async contextLoader() { return state; },
    async readAllSourceEvents() {
      return {
        events: [{ bandId: 'band-1', artistCreditName: 'Synthetic Artist', recordingTitle: 'Synthetic Song', spotifyTrackId: 'SyntheticTrack1' }],
        counts: { spotifyArchiveEvents: 1, incrementalObjects: 0, incrementalEvents: 0, totalEvents: 1 },
      };
    },
    providerFactory() { return {}; },
    async maintenanceRunner(args) {
      calls += 1;
      assert.equal(args.haltOnRetry, false);
      if (calls === 1) {
        assert.deepEqual(args.deferredProviders, []);
        return {
          summary: { attempted: 100, persisted: 100, halted: true, haltReason: 'batch_limit' },
          checkpoint: args.checkpoint,
          trackIdentities: args.trackIdentities,
          spotifyMetadata: args.spotifyMetadata,
          deferredProviders: ['musicbrainz'],
          plan: { planned: 1, complete: 0, blocked: 0, retry_wait: 1, no_route: 0, spotify: 0, musicbrainz: 1, listenbrainz: 0 },
        };
      }
      assert.deepEqual(args.deferredProviders, ['musicbrainz']);
      return {
        summary: { attempted: 0, persisted: 0, halted: false, haltReason: null },
        checkpoint: args.checkpoint,
        trackIdentities: args.trackIdentities,
        spotifyMetadata: args.spotifyMetadata,
        deferredProviders: ['musicbrainz'],
        plan: { planned: 1, complete: 0, blocked: 0, retry_wait: 1, no_route: 0, spotify: 0, musicbrainz: 1, listenbrainz: 0 },
      };
    },
    log() {},
  });

  assert.equal(calls, 2);
  assert.equal(result.run.halted, true);
  assert.equal(result.run.haltReason, 'provider_retry_wait:musicbrainz');
  assert.deepEqual(result.run.deferredProviders, ['musicbrainz']);
});
