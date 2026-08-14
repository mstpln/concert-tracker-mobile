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

  const persisted = gau5.stateStore(localStorage).load();
  assert.equal(persisted.processedEvents, 1200);
  assert.equal(persisted.phaseCounts.migrationChunks, 3);
});

test('GAU5 pauses before another chunk when the document becomes hidden and preserves exact progress', async () => {
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
  assert.equal(result.state.phase, 'migration');
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
  assert.deepEqual(result.state.completedPhases, ['migration']);
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

  store.save(gau5.completePhase(gau5.completePhase(gau5.completePhase(gau5.begin(gau5.defaultState()), 'migration'), 'candidates'), 'persistence'));
  await documentRef.fire('visibilitychange');
  await Promise.resolve();
  assert.equal(resumes, 1);
});

test('GAU5 state normalization preserves unknown future fields', () => {
  const state = gau5.normalizeState({
    ...gau5.defaultState(),
    status: 'paused',
    futureCheckpointField: { keep: true },
    phaseCounts: { migrationChunks: 2, futureCount: 9 },
  });
  assert.deepEqual(state.futureCheckpointField, { keep: true });
  assert.equal(state.phaseCounts.futureCount, 9);
});
