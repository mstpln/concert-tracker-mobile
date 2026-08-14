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

function documentState(value = 'visible') {
  const listeners = new Map();
  return {
    visibilityState: value,
    addEventListener(name, callback) { listeners.set(name, callback); },
    set visible(value) { this.visibilityState = value ? 'visible' : 'hidden'; },
    async fire(name) { return listeners.get(name)?.(); },
  };
}

function completedThrough(phase, overrides = {}) {
  let state = gau5.begin({ ...gau5.defaultState(), ...overrides });
  for (const name of gau5.PHASES) {
    if (gau5.PHASES.indexOf(name) > gau5.PHASES.indexOf(phase)) break;
    state = gau5.completePhase(state, name);
  }
  return { ...state, ...overrides };
}

test('GAU5 persists bounded migration progress after every chunk and resumes at the saved cursor', async () => {
  const localStorage = memoryStorage();
  const documentRef = documentState('visible');
  const migrationCheckpoints = {
    value: { status: 'pending', processedEvents: 0, afterSourceEventId: null },
    load() { return { ...this.value }; },
    save(value) { this.value = { ...value }; },
  };
  const cursors = [];
  const pages = [
    { processed: 500, hasMore: true, checkpoint: { status: 'pending', processedEvents: 500, afterSourceEventId: 'listen-0500', sourceEventCountAfter: 1200, integrityStatus: 'passed' } },
    { processed: 500, hasMore: true, checkpoint: { status: 'pending', processedEvents: 1000, afterSourceEventId: 'listen-1000', sourceEventCountAfter: 1200, integrityStatus: 'passed' } },
    { processed: 200, hasMore: false, checkpoint: { status: 'complete', processedEvents: 1200, afterSourceEventId: 'listen-1200', sourceEventCountAfter: 1200, integrityStatus: 'passed' } },
  ];
  const migration = {
    checkpointStore: () => migrationCheckpoints,
    async runChunk() {
      cursors.push(migrationCheckpoints.load().afterSourceEventId || null);
      const result = pages.shift();
      migrationCheckpoints.save(result.checkpoint);
      return result;
    },
  };
  let yields = 0;
  const first = await gau5.runMigrationChunks({ migration, localStorage, documentRef, migrationCheckpoints, setTimeoutImpl: (fn) => { yields += 1; fn(); } });
  assert.equal(first.state.status, 'running');
  assert.equal(first.state.phase, 'candidates');
  assert.equal(first.state.processedEvents, 1200);
  assert.equal(first.state.sourceEventCount, 1200);
  assert.equal(first.state.sourceIntegrity, 'passed');
  assert.deepEqual(first.state.completedPhases, ['migration']);
  assert.deepEqual(cursors, [null, 'listen-0500', 'listen-1000']);
  assert.equal(yields, 2);
  assert.equal(gau5.stateStore(localStorage).load().phaseCounts.migrationChunks, 3);
});

test('GAU5 pauses before another migration chunk when the document becomes hidden and preserves exact progress', async () => {
  const localStorage = memoryStorage();
  const documentRef = documentState('visible');
  const migrationCheckpoints = {
    value: { status: 'pending', processedEvents: 0, afterSourceEventId: null },
    load() { return { ...this.value }; },
    save(value) { this.value = { ...value }; },
  };
  let calls = 0;
  const migration = {
    checkpointStore: () => migrationCheckpoints,
    async runChunk() {
      calls += 1;
      const checkpoint = { status: 'pending', processedEvents: 500, afterSourceEventId: 'listen-0500', sourceEventCountAfter: 1000, integrityStatus: 'passed' };
      migrationCheckpoints.save(checkpoint);
      documentRef.visibilityState = 'hidden';
      return { processed: 500, hasMore: true, checkpoint };
    },
  };
  const result = await gau5.runMigrationChunks({ migration, localStorage, documentRef, migrationCheckpoints, setTimeoutImpl: (fn) => fn() });
  assert.equal(calls, 1);
  assert.equal(result.paused, true);
  assert.equal(result.state.status, 'paused');
  assert.equal(result.state.phaseCursor, 'listen-0500');
  assert.equal(result.state.processedEvents, 500);
  assert.equal(gau5.statusText(result.state), 'Paused - will resume');
});

test('GAU5 does not rerun a completed migration phase after process restart', async () => {
  const localStorage = memoryStorage();
  const store = gau5.stateStore(localStorage);
  store.save(gau5.completePhase(gau5.begin(gau5.defaultState()), 'migration', { processedEvents: 1000, sourceEventCount: 1000, sourceIntegrity: 'passed' }));
  let calls = 0;
  const migration = { async runChunk() { calls += 1; throw new Error('must not run'); } };
  const result = await gau5.runMigrationChunks({ migration, localStorage, documentRef: documentState('visible') });
  assert.equal(calls, 0);
  assert.equal(result.state.phase, 'candidates');
});

test('GAU5 candidate scan catches duplicate evidence across a chunk boundary', async () => {
  const localStorage = memoryStorage();
  const store = gau5.stateStore(localStorage);
  store.save(completedThrough('migration', { sourceEventCount: 2, processedEvents: 2, sourceIntegrity: 'passed', phaseCounts: { stagingComplete: 1 }, stagedEventCount: 2 }));
  const first = { sourceEventId: 'a', stableListenId: 'a', sortKey: '0000000000001000|a', listenedAtMs: 1000, listenedAt: new Date(1000).toISOString(), source: 'spotify_import', artistCreditName: 'Artist', recordingTitle: 'Song' };
  const second = { sourceEventId: 'b', stableListenId: 'b', sortKey: '0000000000001500|b', listenedAtMs: 1500, listenedAt: new Date(1500).toISOString(), source: 'listenbrainz', artistCreditName: 'Artist', recordingTitle: 'Song' };
  let reads = 0;
  const saved = [];
  const prep = {
    async readEvents(after) {
      reads += 1;
      if (!after) return { items: [first], nextAfterSortKey: first.sortKey };
      if (after === first.sortKey) return { items: [second], nextAfterSortKey: second.sortKey };
      return { items: [], nextAfterSortKey: null };
    },
    async readLookback(before) { return before === second.sortKey ? [first] : []; },
    async putCandidates(items) { saved.push(...items); return { written: items.length }; },
    async count(name) { return name === gau5.CANDIDATE_STORE ? saved.length : 2; },
  };
  const contracts = {
    TIMESTAMP_TOLERANCE_MS: 1000,
    matchingEvidence(left, right) {
      return left.recordingTitle === right.recordingTitle
        ? { tier: 5, outcome: 'ambiguous', method: 'normalized_signature', automatic: false }
        : { tier: null, outcome: 'unique', method: null, automatic: false };
    },
  };
  const result = await gau5.scanCandidateChunks({ localStorage, store, preparationStorage: prep, contracts, documentRef: documentState('visible'), chunkSize: 1, setTimeoutImpl: (fn) => fn() });
  assert.equal(result.state.phase, 'persistence');
  assert.equal(result.state.candidateCount, 1);
  assert.equal(saved[0].pairKey, 'a|b');
  assert.ok(reads >= 3);
});

test('GAU5 persistence resumes after a completed canonical batch without rewriting earlier batch progress', async () => {
  const localStorage = memoryStorage();
  const store = gau5.stateStore(localStorage);
  store.save(completedThrough('candidates', { sourceEventCount: 600, processedEvents: 600, sourceIntegrity: 'passed', candidateCount: 1 }));
  const candidate = { pairKey: 'a|b', leftSourceEventId: 'a', rightSourceEventId: 'b', left: { stableListenId: 'a' }, right: { stableListenId: 'b' }, evidence: { tier: 2, automatic: true }, representativeId: 'a' };
  const prep = {
    async readCandidates(after) { return after ? { items: [], nextAfterPairKey: null } : { items: [candidate], nextAfterPairKey: null }; },
  };
  const canonical = Array.from({ length: 600 }, (_, index) => ({ sourceEventId: `listen-${String(index).padStart(4, '0')}`, canonicalListenId: `listen-${String(index).padStart(4, '0')}` }));
  const groups = Array.from({ length: 3 }, (_, index) => ({ reviewId: `group-${index}`, sourceEventIds: ['a', 'b'], candidatePairs: [{ leftSourceEventId: 'a', rightSourceEventId: 'b' }] }));
  const rollout = {
    reviewStorage: null,
    assignOneToOne: () => ({ automatic: [candidate], review: [], rejectedByConflict: [] }),
    canonicalUpdates: () => canonical,
    reviewCandidateUpdates: () => groups,
  };
  const documentRef = documentState('visible');
  const canonicalBatchSizes = [];
  const reviewBatchSizes = [];
  const storage = {
    async putCanonicalBatch(batch) {
      canonicalBatchSizes.push(batch.length);
      if (canonicalBatchSizes.length === 1) documentRef.visibilityState = 'hidden';
    },
  };
  const reviews = { async putGroups(batch) { reviewBatchSizes.push(batch.length); } };
  const first = await gau5.runPersistencePhase({ localStorage, store, preparationStorage: prep, rollout, storage, reviewStorage: reviews, documentRef, chunkSize: 500, setTimeoutImpl: (fn) => fn() });
  assert.equal(first.paused, true);
  assert.equal(first.state.canonicalPersistedCount, 500);
  assert.deepEqual(canonicalBatchSizes, [500]);

  documentRef.visibilityState = 'visible';
  const second = await gau5.runPersistencePhase({ localStorage, store, preparationStorage: prep, rollout, storage, reviewStorage: reviews, documentRef, chunkSize: 500, setTimeoutImpl: (fn) => fn() });
  assert.equal(second.paused, false);
  assert.equal(second.state.phase, 'verification');
  assert.deepEqual(canonicalBatchSizes, [500, 100]);
  assert.deepEqual(reviewBatchSizes, [3]);
});

test('GAU5 verification checkpoints canonical pages and finishes without loading the whole archive', async () => {
  const localStorage = memoryStorage();
  const store = gau5.stateStore(localStorage);
  store.save(completedThrough('persistence', { sourceEventCount: 700, processedEvents: 700, sourceIntegrity: 'passed' }));
  const records = Array.from({ length: 700 }, (_, index) => ({ sourceEventId: `listen-${String(index).padStart(4, '0')}`, canonicalListenId: `listen-${String(index).padStart(4, '0')}`, duplicateOf: null }));
  const storage = {
    async listCanonical({ afterSourceEventId, limit }) {
      const start = afterSourceEventId ? records.findIndex((record) => record.sourceEventId === afterSourceEventId) + 1 : 0;
      const items = records.slice(start, start + limit);
      return { items, nextAfterSourceEventId: start + items.length < records.length ? items.at(-1).sourceEventId : null };
    },
    async getCanonical(id) { return records.find((record) => record.sourceEventId === id) || null; },
    async storageSummary() { return { identityCount: 700, canonicalCount: 700 }; },
  };
  const migration = { async sourceCount() { return 700; } };
  const result = await gau5.runVerificationPhase({ localStorage, store, storage, migration, documentRef: documentState('visible'), chunkSize: 500, setTimeoutImpl: (fn) => fn() });
  assert.equal(result.state.status, 'complete');
  assert.equal(result.state.verifiedCanonicalCount, 700);
  assert.equal(result.state.verifiedIdentityCount, 700);
  assert.equal(result.state.verifiedDuplicateCount, 0);
  assert.match(gau5.progressText(result.state), /complete/i);
});

test('GAU5 verification fails closed if source count changes before readiness', async () => {
  const localStorage = memoryStorage();
  const store = gau5.stateStore(localStorage);
  store.save(completedThrough('persistence', { sourceEventCount: 2, processedEvents: 2, sourceIntegrity: 'passed' }));
  const records = [{ sourceEventId: 'a', canonicalListenId: 'a' }, { sourceEventId: 'b', canonicalListenId: 'b' }];
  const storage = {
    async listCanonical({ afterSourceEventId }) { return afterSourceEventId ? { items: [], nextAfterSourceEventId: null } : { items: records, nextAfterSourceEventId: null }; },
    async getCanonical() { return null; },
    async storageSummary() { return { identityCount: 2, canonicalCount: 2 }; },
  };
  const migration = { async sourceCount() { return 3; } };
  await assert.rejects(() => gau5.runVerificationPhase({ localStorage, store, storage, migration, documentRef: documentState('visible') }), /history changed/i);
});

test('GAU5 rejects a checkpoint that claims more processed events than the source contains', () => {
  assert.throws(() => gau5.checkpoint(gau5.defaultState(), { processedEvents: 1001, sourceEventCount: 1000 }), /exceeds the source event count/);
});

test('GAU5 visibility resume runs only for persisted paused/running work', async () => {
  const localStorage = memoryStorage();
  const store = gau5.stateStore(localStorage);
  const documentRef = documentState('hidden');
  let resumes = 0;
  assert.equal(gau5.installAutoResume({ documentRef, store, resume: async () => { resumes += 1; } }), true);
  store.save(gau5.pause(gau5.begin(gau5.defaultState())));
  documentRef.visibilityState = 'visible';
  await documentRef.fire('visibilitychange');
  await Promise.resolve();
  assert.equal(resumes, 1);
  store.save(completedThrough('verification'));
  await documentRef.fire('visibilitychange');
  await Promise.resolve();
  assert.equal(resumes, 1);
});

test('GAU5 state normalization preserves unknown future fields', () => {
  const state = gau5.normalizeState({ ...gau5.defaultState(), status: 'paused', futureCheckpointField: { keep: true }, phaseCounts: { migrationChunks: 2, futureCount: 9 } });
  assert.deepEqual(state.futureCheckpointField, { keep: true });
  assert.equal(state.phaseCounts.futureCount, 9);
});
