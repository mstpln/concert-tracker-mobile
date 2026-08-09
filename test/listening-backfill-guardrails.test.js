'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const production = require('../scripts/listening-backfill-production');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';

function env() {
  return {
    CF_WORKER_ENDPOINT: 'https://worker.test',
    DATA_MAINTENANCE_TOKEN: 'maintenance-secret',
    SPOTIFY_CLIENT_ID: 'spotify-client-id',
    SPOTIFY_CLIENT_SECRET: 'spotify-client-secret',
    LISTENBRAINZ_USER_TOKEN: 'listenbrainz-secret',
    [production.BACKFILL_CONFIRM_ENV]: production.BACKFILL_CONFIRMATION,
    [production.WRITE_CONFIRM_ENV]: production.WRITE_CONFIRMATION,
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

function client() {
  return {
    async readJson(path, fallback) {
      if (path === 'bands.json') return [band()];
      return fallback;
    },
  };
}

function source() {
  return {
    events: [{ bandId: 'band-1', artistCreditName: 'Synthetic Artist', recordingTitle: 'Synthetic Song', spotifyTrackId: 'SyntheticTrack1' }],
    counts: { totalEvents: 1 },
  };
}

function context(overrides = {}) {
  return {
    trackIdentities: { kind: 'livevault-track-identities', schemaVersion: 1, updatedAt: null, records: {} },
    spotifyMetadata: { kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} },
    checkpoint: null,
    usage: { reserve: async () => true },
    preflight: async () => true,
    persist: async () => true,
    ...overrides,
  };
}

test('missing Spotify configuration stops before quota reservation or provider execution', async () => {
  const runEnv = env();
  delete runEnv.SPOTIFY_CLIENT_SECRET;
  let reservations = 0;
  let providerCalls = 0;
  let persists = 0;
  const ctx = context({
    usage: { reserve: async () => { reservations += 1; return true; } },
    persist: async () => { persists += 1; return true; },
  });

  await assert.rejects(() => production.runProductionBackfill({
    argv: ['--execute', '--write'],
    env: runEnv,
    clientFactory: client,
    async contextLoader() { return ctx; },
    async readAllSourceEvents() { return source(); },
    providerFactory() {
      return { spotify: { exact_track: async () => { providerCalls += 1; return { kind: 'no_match' }; } } };
    },
    async maintenanceRunner(args) {
      await args.preflight({
        nextStep: { provider: 'spotify' },
        trackIdentities: ctx.trackIdentities,
        spotifyMetadata: ctx.spotifyMetadata,
      });
      return { summary: {}, plan: {} };
    },
    log() {},
  }), /SPOTIFY_CLIENT_SECRET/);

  assert.equal(reservations, 0);
  assert.equal(providerCalls, 0);
  assert.equal(persists, 0);
});

test('derived-state change after quota persistence stops before provider execution', async () => {
  let preflights = 0;
  let reservations = 0;
  let providerCalls = 0;
  let persists = 0;
  const ctx = context({
    usage: { reserve: async () => { reservations += 1; return true; } },
    preflight: async () => {
      preflights += 1;
      if (preflights === 2) throw new Error('Listening maintenance Spotify metadata changed after load.');
      return true;
    },
    persist: async () => { persists += 1; return true; },
  });

  await assert.rejects(() => production.runProductionBackfill({
    argv: ['--execute', '--write'],
    env: env(),
    clientFactory: client,
    async contextLoader() { return ctx; },
    async readAllSourceEvents() { return source(); },
    providerFactory() {
      return { spotify: { exact_track: async () => { providerCalls += 1; return { kind: 'no_match' }; } } };
    },
    async maintenanceRunner(args) {
      const snapshot = {
        nextStep: { provider: 'spotify' },
        trackIdentities: ctx.trackIdentities,
        spotifyMetadata: ctx.spotifyMetadata,
      };
      assert.equal(await args.preflight(snapshot), true);
      await args.usage.reserve('spotify');
      providerCalls += 1;
      return { summary: {}, plan: {} };
    },
    log() {},
  }), /Spotify metadata changed after load/);

  assert.equal(reservations, 1);
  assert.equal(providerCalls, 0);
  assert.equal(persists, 0);
});
