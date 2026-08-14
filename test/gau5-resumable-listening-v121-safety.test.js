'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const gau5 = require('../listeningPreparationV121');

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

function visibleDocument() {
  return { visibilityState: 'visible' };
}

function completedMigration(overrides = {}) {
  return gau5.completePhase(gau5.begin(gau5.defaultState()), 'migration', {
    processedEvents: 1,
    sourceEventCount: 1,
    sourceIntegrity: 'passed',
    ...overrides,
  });
}

test('GAU5 staging replay checkpoints the durable unique store count instead of double-counting a replayed page', async () => {
  const localStorage = memoryStorage();
  const store = gau5.stateStore(localStorage);
  store.save(completedMigration());

  const event = {
    stableListenId: 'listen-1',
    listenedAt: '2026-01-01T00:00:00.000Z',
    source: 'spotify_import',
    artistCreditName: 'QA Artist',
    recordingTitle: 'QA Track',
  };
  const migration = {
    async readSourcePage(afterSourceEventId) {
      return afterSourceEventId ? [] : [event];
    },
  };
  let durableCount = 1; // Simulates a crash after the IndexedDB put but before the localStorage checkpoint.
  const preparationStorage = {
    async putEvents() { durableCount = 1; return { written: 1 }; },
    async count() { return durableCount; },
  };

  const result = await gau5.stageCandidateEvents({
    migration,
    preparationStorage,
    store,
    localStorage,
    documentRef: visibleDocument(),
    setTimeoutImpl: (fn) => fn(),
  });

  assert.equal(result.paused, false);
  assert.equal(result.state.stagedEventCount, 1);
  assert.equal(result.state.phaseCounts.stagingComplete, 1);
  assert.equal(result.state.candidateStageCursor, 'listen-1');
});

test('GAU5 candidate planning fails closed instead of growing an unbounded in-memory plan', async () => {
  let page = 0;
  const preparationStorage = {
    async readCandidates() {
      page += 1;
      return {
        items: Array.from({ length: 500 }, (_, index) => ({ pairKey: `candidate-${page}-${index}` })),
        nextAfterPairKey: `page-${page}`,
      };
    },
  };
  const rollout = {
    assignOneToOne: () => ({ automatic: [], review: [], rejectedByConflict: [] }),
    canonicalUpdates: () => [],
    reviewCandidateUpdates: () => [],
  };

  await assert.rejects(
    () => gau5.loadCandidatePlan({ preparationStorage, rollout, documentRef: visibleDocument(), setTimeoutImpl: (fn) => fn() }),
    /exceeds safe bounded capacity/i,
  );
  assert.equal(page, Math.floor(gau5.MAX_CANDIDATE_PLAN / 500) + 1);
});

test('GAU5 candidate scanning propagates an oversized lookback failure without advancing its durable scan cursor', async () => {
  const localStorage = memoryStorage();
  const store = gau5.stateStore(localStorage);
  store.save(completedMigration({ phaseCounts: { stagingComplete: 1 }, stagedEventCount: 1 }));
  const first = {
    sourceEventId: 'listen-1',
    stableListenId: 'listen-1',
    sortKey: '0000000000001000|listen-1',
    listenedAtMs: 1000,
    listenedAt: new Date(1000).toISOString(),
    source: 'spotify_import',
  };
  const preparationStorage = {
    async readEvents() { return { items: [first], nextAfterSortKey: null }; },
    async readLookback() { throw new Error('Candidate lookback window exceeds safe bounded capacity.'); },
    async count() { return 0; },
  };
  const contracts = { TIMESTAMP_TOLERANCE_MS: 1000, matchingEvidence: () => ({ outcome: 'unique' }) };

  await assert.rejects(
    () => gau5.scanCandidateChunks({ preparationStorage, store, localStorage, contracts, documentRef: visibleDocument() }),
    /lookback window exceeds safe bounded capacity/i,
  );
  assert.equal(store.load().candidateScanCursor, null);
  assert.equal(store.load().phase, 'candidates');
});
