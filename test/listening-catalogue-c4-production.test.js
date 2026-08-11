'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const production = require('../scripts/listening-catalogue-backfill-production');

const ARTIST = '12345678-1234-4234-8234-123456789abc';

function band() {
  return { id: 'band-1', name: 'Synthetic Artist', musicbrainz: { mbid: ARTIST, status: 'manual_confirmed' } };
}

function event() {
  return {
    stableListenId: 'listen-1',
    bandId: 'band-1',
    artistCreditName: 'Synthetic Artist',
    recordingTitle: 'Synthetic Song',
    releaseTitle: 'Synthetic Release',
    spotifyTrackId: 'SyntheticTrack1',
    source: 'spotify_import',
  };
}

function planEnv() {
  return {
    CF_WORKER_ENDPOINT: 'https://synthetic.invalid',
    DATA_MAINTENANCE_TOKEN: 'synthetic-token',
    [production.PRIVATE_READ_CONFIRM_ENV]: production.PRIVATE_READ_CONFIRMATION,
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
