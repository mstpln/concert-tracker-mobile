'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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
  };
}

function syntheticBand(overrides = {}) {
  return {
    id: 'band-1',
    name: 'Synthetic Artist',
    musicbrainz: {
      mbid: MB_ARTIST,
      status: 'manual_confirmed',
      spotify: { id: 'SyntheticArtist1', status: 'manual_confirmed' },
    },
    ...overrides,
  };
}

function syntheticClient(reads, { readBands } = {}) {
  return {
    async readJson(path, fallback) {
      reads.push(path);
      if (path === 'bands.json') return readBands ? readBands() : [syntheticBand()];
      return fallback;
    },
  };
}

function syntheticContext(overrides = {}) {
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

function sourceFixture() {
  return {
    events: [{ bandId: 'band-1', artistCreditName: 'Synthetic Artist', recordingTitle: 'Synthetic Song', spotifyTrackId: 'SyntheticTrack1' }],
    counts: { spotifyArchiveEvents: 1, incrementalObjects: 0, incrementalEvents: 0, totalEvents: 1 },
  };
}

test('help and missing dual authorization stop before private reads or provider setup', async () => {
  let clientCreations = 0;
  let sourceReads = 0;
  let providerCreations = 0;
  const deps = {
    clientFactory() { clientCreations += 1; return syntheticClient([]); },
    async readAllSourceEvents() { sourceReads += 1; return { events: [], counts: {} }; },
    providerFactory() { providerCreations += 1; return {}; },
    log() {},
  };

  assert.deepEqual(await production.runProductionBackfill({ argv: ['--help'], env: {}, ...deps }), { help: true });
  await assert.rejects(() => production.runProductionBackfill({ argv: ['--write'], env: approvedEnv(), ...deps }), /--execute is required/);
  await assert.rejects(() => production.runProductionBackfill({ argv: ['--execute'], env: approvedEnv(), ...deps }), /--write is required/);

  const wrongProvider = approvedEnv();
  wrongProvider[production.BACKFILL_CONFIRM_ENV] = 'wrong';
  await assert.rejects(() => production.runProductionBackfill({ argv: ['--execute', '--write'], env: wrongProvider, ...deps }), /Refusing provider execution/);

  const wrongWrite = approvedEnv();
  wrongWrite[production.WRITE_CONFIRM_ENV] = 'wrong';
  await assert.rejects(() => production.runProductionBackfill({ argv: ['--execute', '--write'], env: wrongWrite, ...deps }), /Refusing production writes/);

  assert.equal(clientCreations, 0);
  assert.equal(sourceReads, 0);
  assert.equal(providerCreations, 0);
});

test('initial Build D rollout is hard-capped at five provider steps', () => {
  assert.equal(production.parseArgs(['--execute', '--write']).maxSteps, 1);
  assert.equal(production.parseArgs(['--execute', '--write', '--max-steps', '5']).maxSteps, 5);
  assert.throws(() => production.parseArgs(['--execute', '--write', '--max-steps', '6']), /integer from 1 to 5/);
  assert.throws(() => production.parseArgs(['--execute', '--write', '--max-steps', '0']), /integer from 1 to 5/);
  assert.throws(() => production.parseArgs(['--execute', '--write', '--max-steps', '2.5']), /integer from 1 to 5/);
  assert.throws(() => production.parseArgs(['--execute', '--write', '--provider', 'spotify']), /Unknown listening backfill option/);
});

test('authorized synthetic backfill passes bounded context to runner and logs aggregates only', async () => {
  const reads = [];
  const logs = [];
  let sourceReads = 0;
  let runnerCalls = 0;
  const secretArtist = 'Synthetic Artist';
  const secretTrack = 'Synthetic Song';
  const context = syntheticContext();

  const result = await production.runProductionBackfill({
    argv: ['--execute', '--write', '--max-steps', '3'],
    env: approvedEnv(),
    clientFactory() { return syntheticClient(reads); },
    async contextLoader() { return context; },
    async readAllSourceEvents({ endpoint, token }) {
      sourceReads += 1;
      assert.equal(endpoint, 'https://worker.test');
      assert.equal(token, 'maintenance-secret');
      return {
        events: [{ bandId: 'band-1', artistCreditName: secretArtist, recordingTitle: secretTrack, spotifyTrackId: 'SyntheticTrack1' }],
        counts: { spotifyArchiveEvents: 1, incrementalObjects: 0, incrementalEvents: 0, totalEvents: 1 },
      };
    },
    providerFactory() {
      return {
        spotify: { exact_track: async () => ({ kind: 'ok', data: {} }) },
        musicbrainz: { isrc_lookup: async () => ({ kind: 'no_match' }) },
        listenbrainz: { metadata_lookup: async () => ({ kind: 'no_match' }) },
      };
    },
    async maintenanceRunner(args) {
      runnerCalls += 1;
      assert.equal(args.maxSteps, 3);
      assert.equal(args.trackIdentities, context.trackIdentities);
      assert.equal(args.spotifyMetadata, context.spotifyMetadata);
      assert.notEqual(args.usage, context.usage);
      assert.equal(await args.preflight({ trackIdentities: context.trackIdentities, spotifyMetadata: context.spotifyMetadata }), true);
      assert.equal(await args.usage.reserve('spotify'), true);
      assert.equal(args.inventory.counts.needsSpotifyTracks, 1);
      return {
        summary: { attempted: 2, persisted: 2, halted: true, haltReason: 'batch_limit' },
        plan: { planned: 1, complete: 0, blocked: 0, retry_wait: 0, no_route: 0, spotify: 1, musicbrainz: 0, listenbrainz: 0 },
      };
    },
    log(value) { logs.push(String(value)); },
  });

  assert.equal(sourceReads, 1);
  assert.equal(runnerCalls, 1);
  assert.deepEqual(reads, ['bands.json', 'bands.json', 'bands.json']);
  assert.equal(result.mode, 'bounded-production-enrichment');
  assert.equal(result.maxSteps, 3);
  assert.equal(result.inventory.needsSpotifyTracks, 1);
  assert.equal(result.run.attempted, 2);
  assert.equal(result.run.persisted, 2);
  assert.equal(result.run.haltReason, 'batch_limit');

  const output = logs.join('\n');
  assert.equal(output.includes(secretArtist), false);
  assert.equal(output.includes(secretTrack), false);
  assert.equal(output.includes('maintenance-secret'), false);
  assert.equal(output.includes('spotify-client-secret'), false);
  assert.equal(output.includes('listenbrainz-secret'), false);
  assert.equal(output.includes('worker.test'), false);
});

test('band changes after inventory load stop before quota reservation or provider work', async () => {
  let bandReads = 0;
  let usageReservations = 0;
  let providerCalls = 0;
  let persists = 0;
  const context = syntheticContext({
    usage: { reserve: async () => { usageReservations += 1; return true; } },
    persist: async () => { persists += 1; return true; },
  });

  await assert.rejects(() => production.runProductionBackfill({
    argv: ['--execute', '--write'],
    env: approvedEnv(),
    clientFactory() {
      return syntheticClient([], {
        readBands() {
          bandReads += 1;
          return bandReads === 1 ? [syntheticBand()] : [syntheticBand({ name: 'Changed Artist' })];
        },
      });
    },
    async contextLoader() { return context; },
    async readAllSourceEvents() { return sourceFixture(); },
    providerFactory() {
      return { spotify: { exact_track: async () => { providerCalls += 1; return { kind: 'no_match' }; } } };
    },
    async maintenanceRunner(args) {
      await args.preflight({ trackIdentities: context.trackIdentities, spotifyMetadata: context.spotifyMetadata });
      return { summary: {}, plan: {} };
    },
    log() {},
  }), /bands changed after inventory load/);

  assert.equal(usageReservations, 0);
  assert.equal(providerCalls, 0);
  assert.equal(persists, 0);
});

test('band changes during quota reservation stop before provider request and derived persistence', async () => {
  let bandReads = 0;
  let providerCalls = 0;
  let persists = 0;
  const context = syntheticContext({ persist: async () => { persists += 1; return true; } });

  await assert.rejects(() => production.runProductionBackfill({
    argv: ['--execute', '--write'],
    env: approvedEnv(),
    clientFactory() {
      return syntheticClient([], {
        readBands() {
          bandReads += 1;
          return bandReads < 3 ? [syntheticBand()] : [syntheticBand({ musicbrainz: { mbid: MB_ARTIST, status: 'manual_confirmed', spotify: { id: 'ChangedSpotifyId', status: 'manual_confirmed' } } })];
        },
      });
    },
    async contextLoader() { return context; },
    async readAllSourceEvents() { return sourceFixture(); },
    providerFactory() {
      return { spotify: { exact_track: async () => { providerCalls += 1; return { kind: 'no_match' }; } } };
    },
    async maintenanceRunner(args) {
      assert.equal(await args.preflight({ trackIdentities: context.trackIdentities, spotifyMetadata: context.spotifyMetadata }), true);
      await args.usage.reserve('spotify');
      providerCalls += 1;
      return { summary: {}, plan: {} };
    },
    log() {},
  }), /bands changed after inventory load/);

  assert.equal(providerCalls, 0);
  assert.equal(persists, 0);
});

test('Spotify and ListenBrainz credentials are resolved lazily through provider callbacks', async () => {
  const env = approvedEnv();
  let spotifyTokenCalls = 0;
  let providerCallbacks;

  await production.runProductionBackfill({
    argv: ['--execute', '--write'],
    env,
    clientFactory() { return syntheticClient([]); },
    async contextLoader() { return syntheticContext(); },
    async readAllSourceEvents() { return sourceFixture(); },
    providerFactory(callbacks) { providerCallbacks = callbacks; return {}; },
    async spotifyTokenFactory({ clientId, clientSecret }) {
      spotifyTokenCalls += 1;
      assert.equal(clientId, 'spotify-client-id');
      assert.equal(clientSecret, 'spotify-client-secret');
      return 'temporary-access-token';
    },
    async maintenanceRunner() {
      assert.equal(spotifyTokenCalls, 0);
      assert.equal(await providerCallbacks.spotifyTokenProvider(), 'temporary-access-token');
      assert.equal(await providerCallbacks.spotifyTokenProvider(), 'temporary-access-token');
      assert.equal(spotifyTokenCalls, 1);
      assert.equal(await providerCallbacks.listenbrainzTokenProvider(), 'listenbrainz-secret');
      return { summary: { attempted: 0, persisted: 0, halted: false, haltReason: null }, plan: {} };
    },
    log() {},
  });
});
