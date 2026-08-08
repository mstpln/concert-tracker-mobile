'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const production = require('../scripts/listening-maintenance-production');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';

function syntheticClient(calls) {
  return {
    async readJson(path, fallback) {
      calls.push(path);
      if (path === 'bands.json') return [{
        id: 'band-1',
        name: 'Synthetic Artist',
        musicbrainz: {
          mbid: MB_ARTIST,
          status: 'manual_confirmed',
          spotify: { id: 'SyntheticArtist1', status: 'manual_confirmed' },
        },
      }];
      if (path === 'listening/spotify-metadata.json') return {
        kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {},
      };
      if (path === 'listening/track-identities.json') return {
        kind: 'livevault-track-identities', schemaVersion: 1, updatedAt: null, records: {},
      };
      return fallback;
    },
  };
}

function approvedEnv() {
  return {
    CF_WORKER_ENDPOINT: 'https://worker.test/',
    DATA_MAINTENANCE_TOKEN: 'private-maintenance-token',
    [production.CONFIRM_ENV]: production.PRIVATE_READ_CONFIRMATION,
  };
}

test('help and missing authorization never create a client or read private source data', async () => {
  let clientCreations = 0;
  let sourceReads = 0;
  const deps = {
    clientFactory() { clientCreations += 1; return syntheticClient([]); },
    async readAllSourceEvents() { sourceReads += 1; return { events: [], counts: {} }; },
    log() {},
  };

  assert.deepEqual(await production.runProductionInventory({ argv: ['--help'], env: {}, ...deps }), { help: true });
  await assert.rejects(() => production.runProductionInventory({ argv: ['--inventory-only'], env: approvedEnv(), ...deps }), /add --execute/);
  const wrong = approvedEnv();
  wrong[production.CONFIRM_ENV] = 'wrong';
  await assert.rejects(() => production.runProductionInventory({ argv: ['--inventory-only', '--execute'], env: wrong, ...deps }), /authorization value/);
  assert.equal(clientCreations, 0);
  assert.equal(sourceReads, 0);
});

test('inventory entrypoint rejects provider/write style options rather than broadening scope', async () => {
  await assert.rejects(() => production.runProductionInventory({ argv: ['--execute', '--write'], env: approvedEnv(), log() {} }), /Unknown listening maintenance option: --write/);
  await assert.rejects(() => production.runProductionInventory({ argv: ['--execute'], env: approvedEnv(), log() {} }), /only --inventory-only is supported/);
});

test('authorized synthetic inventory emits aggregate counts only and performs zero provider calls or writes', async () => {
  const reads = [];
  const logs = [];
  let sourceReads = 0;
  const secretArtist = 'Synthetic Artist';
  const secretTrack = 'Synthetic Song';
  const result = await production.runProductionInventory({
    argv: ['--inventory-only', '--execute'],
    env: approvedEnv(),
    clientFactory() { return syntheticClient(reads); },
    async readAllSourceEvents({ endpoint, token }) {
      sourceReads += 1;
      assert.equal(endpoint, 'https://worker.test');
      assert.equal(token, 'private-maintenance-token');
      return {
        events: [{ bandId: 'band-1', artistCreditName: secretArtist, recordingTitle: secretTrack, spotifyTrackId: 'SyntheticTrack1' }],
        counts: { spotifyArchiveEvents: 1, incrementalObjects: 0, incrementalEvents: 0, totalEvents: 1 },
      };
    },
    log(value) { logs.push(String(value)); },
  });

  assert.equal(sourceReads, 1);
  assert.deepEqual(reads.sort(), ['bands.json', 'listening/spotify-metadata.json', 'listening/track-identities.json'].sort());
  assert.equal(result.mode, 'inventory-only');
  assert.equal(result.inventory.sourceEvents, 1);
  assert.equal(result.inventory.needsSpotifyTracks, 1);
  assert.equal(result.providerCalls, 0);
  assert.equal(result.productionWrites, 0);
  const output = logs.join('\n');
  assert.equal(output.includes(secretArtist), false);
  assert.equal(output.includes(secretTrack), false);
  assert.equal(output.includes('private-maintenance-token'), false);
  assert.equal(output.includes('worker.test'), false);
});
