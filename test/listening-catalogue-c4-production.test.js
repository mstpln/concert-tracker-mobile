'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const production = require('../scripts/listening-catalogue-backfill-production');
const acquisition = require('../scripts/listening-catalogue-acquisition');
const resolver = require('../scripts/listening-catalogue-resolver');
const cataloguePersistence = require('../scripts/lib/listeningCataloguePersistence');

const ARTIST = '12345678-1234-4234-8234-123456789abc';
const RELEASE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECORDING = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function band() {
  return { id: 'band-1', name: 'Synthetic Artist', musicbrainz: { mbid: ARTIST, status: 'manual_confirmed' } };
}

function event(overrides = {}) {
  return {
    stableListenId: 'listen-1',
    bandId: 'band-1',
    artistCreditName: 'Synthetic Artist',
    recordingTitle: 'Synthetic Song',
    releaseTitle: 'Synthetic Release',
    spotifyTrackId: 'SyntheticTrack1',
    source: 'spotify_import',
    ...overrides,
  };
}

function planEnv() {
  return {
    CF_WORKER_ENDPOINT: 'https://synthetic.invalid',
    DATA_MAINTENANCE_TOKEN: 'synthetic-token',
    [production.PRIVATE_READ_CONFIRM_ENV]: production.PRIVATE_READ_CONFIRMATION,
  };
}

function emptyIdentities() {
  return { kind: 'livevault-track-identities', schemaVersion: 1, updatedAt: null, records: {} };
}

function emptyMetadata() {
  return { kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} };
}

function musicbrainzPagePayload({ title = 'Different Song' } = {}) {
  return {
    'release-count': 1,
    'release-offset': 0,
    releases: [{
      id: RELEASE,
      title: 'Synthetic Release',
      'release-group': { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
      media: [{ tracks: [{ recording: { id: RECORDING, title, 'artist-credit': [{ artist: { id: ARTIST } }] } }] }],
    }],
  };
}

function completeMissCache(now = Date.parse('2026-08-11T00:00:00Z')) {
  let cache = acquisition.startArtistRefresh(acquisition.emptyCatalogue(), ARTIST, now);
  const page = resolver.parseMusicBrainzCataloguePage({ artistMbid: ARTIST, payload: musicbrainzPagePayload(), expectedOffset: 0 });
  cache = acquisition.mergeScopePage(cache, 'release_artist', page, now);
  cache = acquisition.mergeScopePage(cache, 'release_track_artist', page, now);
  return cache;
}

function catalogueClient(initial) {
  let stored = JSON.parse(JSON.stringify(initial));
  return {
    async readJson(path, fallback) {
      if (path === cataloguePersistence.CATALOGUE_PATH) return JSON.parse(JSON.stringify(stored ?? fallback));
      return fallback;
    },
    async writeJsonStrict(path, value) {
      assert.equal(path, cataloguePersistence.CATALOGUE_PATH);
      stored = JSON.parse(JSON.stringify(value));
      return true;
    },
  };
}

function baseContext() {
  return {
    bands: [band()],
    spotifyMetadata: emptyMetadata(),
    trackIdentities: emptyIdentities(),
    source: {
      events: [event()],
      manifest: { kind: 'livevault-listening-vault', schemaVersion: 1, archive: { synthetic: true } },
      counts: { spotifyArchiveEvents: 1, incrementalObjects: 0, incrementalEvents: 0, totalEvents: 1 },
    },
  };
}

function safeGuards() {
  return {
    preflight: async () => true,
    assertBandsCurrent: async () => true,
    assertSourceCurrent: async () => true,
  };
}

test('C4 production CLI exposes exactly plan, proof and full modes', () => {
  assert.equal(production.parseArgs(['--plan-only']).mode, 'plan');
  assert.equal(production.parseArgs(['--proof']).mode, 'proof');
  assert.equal(production.parseArgs(['--full']).mode, 'full');
  assert.throws(() => production.parseArgs(['--plan-only', '--proof']), /exactly one C4 mode/);
});

test('plan-only requires private-read authorization and forbids write mode', () => {
  assert.throws(() => production.assertPlanAuthorization({ mode: 'plan', execute: false, write: false }, planEnv()), /--execute/);
  assert.throws(() => production.assertPlanAuthorization({ mode: 'plan', execute: true, write: true }, planEnv()), /refuses --write/);
  assert.equal(production.assertPlanAuthorization({ mode: 'plan', execute: true, write: false }, planEnv()), undefined);
});

test('proof and full require independent provider, write and mode-specific authorizations', () => {
  const env = {
    [production.PROVIDER_CONFIRM_ENV]: production.PROVIDER_CONFIRMATION,
    [production.WRITE_CONFIRM_ENV]: production.WRITE_CONFIRMATION,
    [production.PROOF_CONFIRM_ENV]: production.PROOF_CONFIRMATION,
    [production.FULL_CONFIRM_ENV]: production.FULL_CONFIRMATION,
  };
  assert.doesNotThrow(() => production.assertLiveAuthorization({ mode: 'proof', execute: true, write: true }, env));
  assert.doesNotThrow(() => production.assertLiveAuthorization({ mode: 'full', execute: true, write: true }, env));
  assert.throws(() => production.assertLiveAuthorization({ mode: 'full', execute: true, write: false }, env), /both --execute and --write/);
  assert.throws(() => production.assertLiveAuthorization({ mode: 'proof', execute: true, write: true }, { ...env, [production.PROOF_CONFIRM_ENV]: '' }), /Refusing C4 proof/);
});

test('plan-only performs private reads only and cannot call providers or writes', async () => {
  let writes = 0;
  let providerFactoryCalls = 0;
  const client = {
    async readJson(path, fallback) {
      if (path === 'bands.json') return [band()];
      if (path === 'listening/spotify-metadata.json') return fallback;
      if (path === 'listening/track-identities.json') return fallback;
      throw new Error(`unexpected read ${path}`);
    },
    async writeJsonStrict() { writes += 1; throw new Error('plan-only write attempted'); },
  };
  const logs = [];
  const result = await production.runProductionC4({
    argv: ['--plan-only', '--execute'],
    env: planEnv(),
    clientFactory: () => client,
    readAllSourceEvents: async () => ({
      events: [event()],
      manifest: { kind: 'livevault-listening-vault', schemaVersion: 1 },
      counts: { spotifyArchiveEvents: 1, incrementalObjects: 0, incrementalEvents: 0, totalEvents: 1 },
    }),
    musicbrainzProviderFactory: () => { providerFactoryCalls += 1; throw new Error('provider factory must not run'); },
    listenbrainzProviderFactory: () => { providerFactoryCalls += 1; throw new Error('provider factory must not run'); },
    log: (line) => logs.push(line),
  });
  assert.equal(result.mode, 'c4-plan-only');
  assert.equal(result.providerCalls, 0);
  assert.equal(result.productionWrites, 0);
  assert.equal(result.plan.spotifyCoreCallsPlanned, 0);
  assert.equal(writes, 0);
  assert.equal(providerFactoryCalls, 0);
  assert.equal(logs.length, 1);
});

test('proof call ceiling is fixed at two MusicBrainz page requests', () => {
  assert.equal(production.PROOF_MUSICBRAINZ_PAGE_CALLS, 2);
});

test('MusicBrainz UsageTracker denial is a global full-run stop with zero provider calls', async () => {
  let providerCalls = 0;
  const context = {
    usage: {
      reserve: async () => false,
      blockReason: () => 'daily_cap',
    },
    persistTrackIdentitiesOnly: async () => { throw new Error('identity write must not run'); },
  };
  const result = await production.runFull({
    client: catalogueClient(acquisition.emptyCatalogue()),
    context,
    base: baseContext(),
    guards: safeGuards(),
    musicbrainzProvider: { releaseBrowse: async () => { providerCalls += 1; return { kind: 'ok', data: musicbrainzPagePayload() }; } },
    listenbrainzProvider: { lookupBatch: async () => { throw new Error('ListenBrainz must not run'); } },
    now: () => Date.parse('2026-08-11T00:00:00Z'),
  });
  assert.equal(providerCalls, 0);
  assert.equal(result.haltReason, 'usage_blocked:musicbrainz:daily_cap');
  assert.deepEqual(result.deferredProviders, []);
});

test('ListenBrainz UsageTracker denial is a global full-run stop with zero ListenBrainz calls', async () => {
  let listenbrainzCalls = 0;
  const context = {
    usage: {
      reserve: async (provider) => provider !== 'listenbrainz',
      blockReason: (provider) => provider === 'listenbrainz' ? 'per_run_cap' : null,
    },
    persistTrackIdentitiesOnly: async () => { throw new Error('identity write must not run'); },
  };
  const result = await production.runFull({
    client: catalogueClient(completeMissCache()),
    context,
    base: baseContext(),
    guards: safeGuards(),
    musicbrainzProvider: { releaseBrowse: async () => { throw new Error('fresh catalogue must prevent MusicBrainz calls'); } },
    listenbrainzProvider: { lookupBatch: async () => { listenbrainzCalls += 1; return { kind: 'ok', data: [] }; } },
    now: () => Date.parse('2026-08-11T01:00:00Z'),
  });
  assert.equal(listenbrainzCalls, 0);
  assert.equal(result.haltReason, 'usage_blocked:listenbrainz:per_run_cap');
  assert.deepEqual(result.deferredProviders, []);
});
