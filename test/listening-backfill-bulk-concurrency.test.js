'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bulk = require('../scripts/listening-backfill-bulk');
const production = require('../scripts/listening-backfill-production');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';

function band(name = 'Synthetic Artist') {
  return {
    id: 'band-1',
    name,
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

function source() {
  return {
    events: [{ bandId: 'band-1', artistCreditName: 'Synthetic Artist', recordingTitle: 'Synthetic Song', spotifyTrackId: 'SyntheticTrack1' }],
    counts: { spotifyArchiveEvents: 1, incrementalObjects: 0, incrementalEvents: 0, totalEvents: 1 },
  };
}

test('bulk band change after provider execution stops before derived persistence', async () => {
  let currentBand = band();
  let persists = 0;
  const state = {
    trackIdentities: { kind: 'livevault-track-identities', schemaVersion: 1, updatedAt: null, records: {} },
    spotifyMetadata: { kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} },
    checkpoint: null,
    usage: { reserve: async () => true },
    preflight: async () => true,
    persist: async () => { persists += 1; return true; },
  };

  await assert.rejects(() => bulk.runBulkBackfill({
    argv: ['--execute', '--write', '--max-total-steps', '1'],
    env: approvedEnv(),
    clientFactory() {
      return {
        async readJson(path, fallback) {
          if (path === 'bands.json') return [currentBand];
          return fallback;
        },
      };
    },
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
      assert.equal(await args.usage.reserve('spotify'), true);
      currentBand = band('Changed Artist');
      await args.persist({
        trackIdentities: args.trackIdentities,
        spotifyMetadata: args.spotifyMetadata,
        checkpoint: args.checkpoint,
      });
      return { summary: {}, plan: {} };
    },
    log() {},
  }), /bands changed after inventory load/);

  assert.equal(persists, 0);
});
