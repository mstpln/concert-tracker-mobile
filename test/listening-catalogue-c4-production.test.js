'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const production = require('../scripts/listening-catalogue-backfill-production');
const acquisition = require('../scripts/listening-catalogue-acquisition');
const resolver = require('../scripts/listening-catalogue-resolver');
const cataloguePersistence = require('../scripts/lib/listeningCataloguePersistence');

const ARTIST = '12345678-1234-4234-8234-123456789abc';
const RELEASE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECORDING = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RECORDING_TWO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

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

function liveEnv() {
  return {
    ...planEnv(),
    [production.PROVIDER_CONFIRM_ENV]: production.PROVIDER_CONFIRMATION,
    [production.WRITE_CONFIRM_ENV]: production.WRITE_CONFIRMATION,
    [production.PROOF_CONFIRM_ENV]: production.PROOF_CONFIRMATION,
    [production.FULL_CONFIRM_ENV]: production.FULL_CONFIRMATION,
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

test('proof and full require private-read plus independent provider, write and mode-specific authorizations', () => {
  const env = liveEnv();
  assert.doesNotThrow(() => production.assertLiveAuthorization({ mode: 'proof', execute: true, write: true }, env));
  assert.doesNotThrow(() => production.assertLiveAuthorization({ mode: 'full', execute: true, write: true }, env));
  assert.throws(() => production.assertLiveAuthorization({ mode: 'full', execute: true, write: false }, env), /both --execute and --write/);
  assert.throws(() => production.assertLiveAuthorization({ mode: 'proof', execute: true, write: true }, { ...env, [production.PROOF_CONFIRM_ENV]: '' }), /Refusing C4 proof/);
  assert.throws(() => production.assertLiveAuthorization({ mode: 'full', execute: true, write: true }, { ...env, [production.PRIVATE_READ_CONFIRM_ENV]: '' }), /Refusing C4 private reads/);
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

test('missing ListenBrainz configuration stops before usage reservation or provider call', async () => {
  let usageReservations = 0;
  let listenbrainzCalls = 0;
  const context = {
    usage: {
      reserve: async () => { usageReservations += 1; return true; },
      blockReason: () => null,
    },
    persistTrackIdentitiesOnly: async () => { throw new Error('identity write must not run'); },
  };
  await assert.rejects(() => production.runFull({
    client: catalogueClient(completeMissCache()),
    context,
    base: baseContext(),
    guards: safeGuards(),
    musicbrainzProvider: { releaseBrowse: async () => { throw new Error('MusicBrainz must not run'); } },
    listenbrainzProvider: { lookupBatch: async () => { listenbrainzCalls += 1; return { kind: 'ok', data: [] }; } },
    assertProviderConfiguration: async (provider) => {
      if (provider === 'listenbrainz') throw new Error('Missing required environment variable: LISTENBRAINZ_USER_TOKEN');
      return true;
    },
    now: () => Date.parse('2026-08-11T01:00:00Z'),
  }), /LISTENBRAINZ_USER_TOKEN/);
  assert.equal(usageReservations, 0);
  assert.equal(listenbrainzCalls, 0);
});

test('full run accounts one ListenBrainz provider operation per unresolved work item', async () => {
  let usageReservations = 0;
  let listenbrainzCalls = 0;
  let identityWrites = 0;
  const persisted = [];
  const context = {
    usage: {
      reserve: async (provider) => {
        if (provider === 'listenbrainz') usageReservations += 1;
        return true;
      },
      blockReason: () => null,
    },
    persistTrackIdentitiesOnly: async (next) => {
      identityWrites += 1;
      persisted.push(JSON.parse(JSON.stringify(next)));
      return true;
    },
  };
  const base = baseContext();
  base.source.events = [
    event({ stableListenId: 'listen-1', spotifyTrackId: 'SyntheticTrack1', recordingTitle: 'Missing Song One' }),
    event({ stableListenId: 'listen-2', spotifyTrackId: 'SyntheticTrack2', recordingTitle: 'Missing Song Two' }),
  ];
  base.source.counts.totalEvents = 2;
  base.source.counts.spotifyArchiveEvents = 2;

  const result = await production.runFull({
    client: catalogueClient(completeMissCache()),
    context,
    base,
    guards: safeGuards(),
    musicbrainzProvider: { releaseBrowse: async () => { throw new Error('fresh catalogue must prevent MusicBrainz calls'); } },
    listenbrainzProvider: {
      lookupBatch: async ({ items }) => {
        listenbrainzCalls += 1;
        assert.equal(items.length, 1);
        const recordingMbid = listenbrainzCalls === 1 ? RECORDING : RECORDING_TWO;
        return {
          kind: 'ok',
          data: [{
            artist_credit_name: items[0].artistName,
            recording_name: items[0].recordingName,
            recording_mbid: recordingMbid,
            artist_mbids: [ARTIST],
          }],
        };
      },
    },
    now: () => Date.parse('2026-08-11T01:00:00Z'),
  });

  assert.equal(result.providerOperations, 2);
  assert.equal(result.providerCalls.listenbrainz, 2);
  assert.equal(result.listenbrainz.resolved, 2);
  assert.equal(result.haltReason, null);
  assert.equal(listenbrainzCalls, 2);
  assert.equal(usageReservations, 2);
  assert.equal(identityWrites, 2);
  assert.equal(Object.keys(persisted.at(-1).records).length, 2);
});

test('transient MusicBrainz failure defers that provider once and preserves resumability', async () => {
  let providerCalls = 0;
  const context = {
    usage: { reserve: async () => true, blockReason: () => null },
    persistTrackIdentitiesOnly: async () => { throw new Error('identity write must not run'); },
  };
  const result = await production.runFull({
    client: catalogueClient(acquisition.emptyCatalogue()),
    context,
    base: baseContext(),
    guards: safeGuards(),
    musicbrainzProvider: {
      releaseBrowse: async () => {
        providerCalls += 1;
        return { kind: 'retry', reason: 'http_503', nextEligibleCheckAt: '2026-08-11T01:30:00.000Z' };
      },
    },
    listenbrainzProvider: { lookupBatch: async () => { throw new Error('ListenBrainz must not run'); } },
    now: () => Date.parse('2026-08-11T01:00:00Z'),
  });
  assert.equal(providerCalls, 1);
  assert.equal(result.haltReason, 'provider_deferred:musicbrainz');
  assert.deepEqual(result.deferredProviders, ['musicbrainz']);
  assert.deepEqual(result.providerDeferrals.musicbrainz, {
    reason: 'http_503',
    nextEligibleCheckAt: '2026-08-11T01:30:00.000Z',
  });
});

test('old Spotify-first historical command-line entrypoints are retired', () => {
  for (const script of ['../scripts/listening-backfill-production.js', '../scripts/listening-backfill-bulk.js']) {
    const result = spawnSync(process.execPath, [require.resolve(script)], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Spotify-first historical/);
    assert.match(result.stderr, /listening-catalogue-backfill-production\.js/);
  }
});