'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const contracts = require('../listeningIdentityContracts.js');
const migration = require('../listeningDerivedMigration.js');

function memoryCheckpoints(initial) {
  let value = initial || migration.defaultCheckpoint();
  return { load: () => ({ ...value }), save: (next) => { value = { ...next }; }, clear: () => { value = migration.defaultCheckpoint(); } };
}

function storageRecorder() {
  const identities = [];
  const canonical = [];
  return {
    identities,
    canonical,
    async putIdentities(records) { identities.push(...records); return { written: records.length }; },
    async putCanonicalBatch(records) { canonical.push(...records); return { written: records.length }; },
  };
}

test('derives identity and unique canonical baselines without changing source events', () => {
  const source = [{
    stableListenId: 'spotify:1',
    source: 'spotify_import',
    artistCreditName: 'Synthetic Artist',
    recordingTitle: 'Synthetic Track',
    spotifyTrackId: 'track-1',
  }];
  const original = structuredClone(source);
  const result = migration.deriveRecords(source, [{ id: 'band-1', name: 'Synthetic Artist' }], contracts);
  assert.deepEqual(source, original);
  assert.equal(result.identities[0].sourceEventId, 'spotify:1');
  assert.equal(result.identities[0].bandId, 'band-1');
  assert.equal(result.identities[0].status, 'resolved');
  assert.equal(result.canonical[0].canonicalListenId, 'spotify:1');
  assert.equal(result.canonical[0].status, 'unique');
});

test('runs in bounded resumable chunks and advances checkpoint only after both writes', async () => {
  const events = Array.from({ length: 3 }, (_, index) => ({
    stableListenId: `event-${index + 1}`,
    source: 'listenbrainz',
    artistCreditName: 'Synthetic Artist',
    recordingTitle: `Track ${index + 1}`,
  }));
  const checkpoints = memoryCheckpoints();
  const storage = storageRecorder();
  const readSourcePage = async (after, limit) => {
    const start = after ? events.findIndex((event) => event.stableListenId === after) + 1 : 0;
    return events.slice(start, start + limit);
  };
  const options = {
    contracts,
    checkpoints,
    derivedStorage: storage,
    bands: [{ id: 'band-1', name: 'Synthetic Artist' }],
    chunkSize: 2,
    sourceCount: async () => events.length,
    readSourcePage,
  };
  const first = await migration.runChunk(options);
  assert.equal(first.processed, 2);
  assert.equal(first.hasMore, true);
  assert.equal(first.checkpoint.afterSourceEventId, 'event-2');
  const second = await migration.runChunk(options);
  assert.equal(second.processed, 1);
  assert.equal(second.hasMore, false);
  assert.equal(second.checkpoint.status, 'complete');
  assert.equal(storage.identities.length, 3);
  assert.equal(storage.canonical.length, 3);
});

test('fails closed when source count changes and does not advance checkpoint', async () => {
  const checkpoints = memoryCheckpoints();
  const storage = storageRecorder();
  let countCall = 0;
  await assert.rejects(() => migration.runChunk({
    contracts,
    checkpoints,
    derivedStorage: storage,
    bands: [],
    chunkSize: 1,
    sourceCount: async () => (++countCall === 1 ? 1 : 2),
    readSourcePage: async () => [{ stableListenId: 'event-1', source: 'listenbrainz', artistCreditName: 'A', recordingTitle: 'T' }],
  }), /changed during migration/);
  assert.equal(checkpoints.load().processedEvents, 0);
});

test('caps migration chunks at the derived storage batch limit', () => {
  assert.equal(migration.boundedChunkSize(1000), 500);
  assert.equal(migration.boundedChunkSize(0), 500);
  assert.equal(migration.boundedChunkSize(25), 25);
});
