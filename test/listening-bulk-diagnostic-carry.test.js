'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bulk = require('../scripts/listening-backfill-bulk');
const production = require('../scripts/listening-backfill-production');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';

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

function context(usage = { reserve: async () => true }) {
  return {
    trackIdentities: { kind: 'livevault-track-identities', schemaVersion: 1, updatedAt: null, records: {} },
    spotifyMetadata: { kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} },
    checkpoint: null,
    usage,
    preflight: async () => true,
    persist: async () => true,
    persistTrackIdentitiesOnly: async () => true,
  };
}

function commonOptions() {
  return {
    env: approvedEnv(),
    clientFactory() {
      return { async readJson(path, fallback) { return path === 'bands.json' ? [band()] : fallback; } };
    },
    async readAllSourceEvents() {
      return {
        events: [{ bandId: 'band-1', artistCreditName: 'Synthetic Artist', recordingTitle: 'Synthetic Song', spotifyTrackId: 'SyntheticTrack1' }],
        counts: { spotifyArchiveEvents: 1, incrementalObjects: 0, incrementalEvents: 0, totalEvents: 1 },
      };
    },
    providerFactory() { return {}; },
    log() {},
  };
}

test('bulk diagnostics carry across internal chunks but are fresh for a new command', async () => {
  const seen = [];
  let call = 0;
  const firstRun = await bulk.runBulkBackfill({
    ...commonOptions(),
    argv: ['--execute', '--write', '--max-total-steps', '200'],
    async contextLoader() { return context(); },
    async maintenanceRunner(args) {
      call += 1;
      seen.push(JSON.parse(JSON.stringify(args.diagnostics)));
      if (call === 1) {
        return {
          summary: { attempted: 100, persisted: 100, halted: true, haltReason: 'batch_limit' },
          checkpoint: args.checkpoint,
          trackIdentities: args.trackIdentities,
          spotifyMetadata: args.spotifyMetadata,
          deferredProviders: ['musicbrainz'],
          itemErrorReasonCounts: {},
          diagnostics: {
            outcomeReasonCounts: { musicbrainz: { 'retry:http_503': 1 } },
            providerDeferrals: { musicbrainz: { kind: 'retry', reason: 'http_503' } },
            usageBlocks: {},
          },
          plan: { planned: 1, complete: 0, blocked: 0, retry_wait: 1, no_route: 0, spotify: 1, musicbrainz: 0, listenbrainz: 0 },
        };
      }
      assert.deepEqual(args.diagnostics, {
        outcomeReasonCounts: { musicbrainz: { 'retry:http_503': 1 } },
        providerDeferrals: { musicbrainz: { kind: 'retry', reason: 'http_503' } },
        usageBlocks: {},
      });
      return {
        summary: { attempted: 1, persisted: 1, halted: true, haltReason: 'provider_deferred:musicbrainz' },
        checkpoint: args.checkpoint,
        trackIdentities: args.trackIdentities,
        spotifyMetadata: args.spotifyMetadata,
        deferredProviders: ['musicbrainz'],
        itemErrorReasonCounts: {},
        diagnostics: args.diagnostics,
        plan: { planned: 1, complete: 1, blocked: 0, retry_wait: 1, no_route: 0, spotify: 0, musicbrainz: 1, listenbrainz: 0 },
      };
    },
  });

  assert.deepEqual(seen[0], {});
  assert.equal(firstRun.run.diagnostics.providerDeferrals.musicbrainz.reason, 'http_503');

  const freshSeen = [];
  await bulk.runBulkBackfill({
    ...commonOptions(),
    argv: ['--execute', '--write', '--max-total-steps', '1'],
    async contextLoader() { return context(); },
    async maintenanceRunner(args) {
      freshSeen.push(JSON.parse(JSON.stringify(args.diagnostics)));
      return {
        summary: { attempted: 1, persisted: 1, halted: true, haltReason: 'bulk_limit' },
        checkpoint: args.checkpoint,
        trackIdentities: args.trackIdentities,
        spotifyMetadata: args.spotifyMetadata,
        deferredProviders: [],
        itemErrorReasonCounts: {},
        diagnostics: {
          outcomeReasonCounts: { spotify: { 'metadata:spotify_metadata_with_isrc': 1 } },
          providerDeferrals: {},
          usageBlocks: {},
        },
        plan: { planned: 1, complete: 0, blocked: 0, retry_wait: 0, no_route: 0, spotify: 1, musicbrainz: 0, listenbrainz: 0 },
      };
    },
  });
  assert.deepEqual(freshSeen, [{}]);
});

test('bulk guarded usage forwards the exact safe block reason', async () => {
  let providerCalled = false;
  const usage = {
    async reserve() { return false; },
    blockReason(provider) { return provider === 'spotify' ? 'daily_cap' : null; },
  };
  const result = await bulk.runBulkBackfill({
    ...commonOptions(),
    argv: ['--execute', '--write', '--max-total-steps', '1'],
    async contextLoader() { return context(usage); },
    providerFactory() {
      return { spotify: { async exact_track() { providerCalled = true; return { kind: 'ok', data: {} }; } } };
    },
    // Use the real maintenance runner through the default.
  });

  assert.equal(providerCalled, false);
  assert.equal(result.run.haltReason, 'usage_blocked:spotify');
  assert.equal(result.run.diagnostics.usageBlocks.spotify, 'daily_cap');
  assert.equal(result.run.diagnostics.outcomeReasonCounts.spotify['usage_blocked:daily_cap'], 1);
});
