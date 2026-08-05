'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadModule(storage) {
  delete require.cache[require.resolve('../listeningPreparationRecovery')];
  global.localStorage = storage;
  global.BandmarkrListeningCanonicalActivation = {
    stateStore: () => ({
      load: () => JSON.parse(storage.getItem('bandmarkr-listening-canonical-activation-v1')),
      save: (value) => {
        storage.setItem('bandmarkr-listening-canonical-activation-v1', JSON.stringify(value));
        return value;
      },
    }),
  };
  return require('../listeningPreparationRecovery');
}

function cleanupGlobals() {
  delete global.localStorage;
  delete global.BandmarkrListeningCanonicalActivation;
}

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, String(value)),
  };
}

test('recovers an abandoned preparing state without clearing checkpoints', (t) => {
  t.after(cleanupGlobals);
  const storage = memoryStorage({
    'bandmarkr-listening-canonical-activation-v1': JSON.stringify({ stateVersion: 1, status: 'preparing', sourceEventCount: 0 }),
    'bandmarkr-listening-derived-migration-v1': JSON.stringify({ migrationVersion: 1, status: 'pending', processedEvents: 1500, sourceEventCountAfter: 5000 }),
  });
  const api = loadModule(storage);
  const result = api.recoverInterruptedPreparation(storage);
  assert.equal(result.recovered, true);
  assert.equal(result.state.status, 'error');
  assert.match(result.state.error, /interrupted/i);
  assert.equal(JSON.parse(storage.getItem(api.MIGRATION_CHECKPOINT_KEY)).processedEvents, 1500);
});

test('reports bounded migration progress and duplicate-check stage', (t) => {
  t.after(cleanupGlobals);
  const storage = memoryStorage({
    'bandmarkr-listening-derived-migration-v1': JSON.stringify({ status: 'pending', processedEvents: 1500, sourceEventCountAfter: 5000 }),
  });
  const api = loadModule(storage);
  assert.match(api.progressText(storage), /1,500 of 5,000/);
  storage.setItem(api.MIGRATION_CHECKPOINT_KEY, JSON.stringify({ status: 'complete', processedEvents: 5000, sourceEventCountAfter: 5000 }));
  assert.match(api.progressText(storage), /possible duplicates/i);
});

test('marks visible preparation interrupted after checkpoint progress stalls', (t) => {
  t.after(cleanupGlobals);
  const storage = memoryStorage({
    'bandmarkr-listening-canonical-activation-v1': JSON.stringify({ stateVersion: 1, status: 'preparing' }),
    'bandmarkr-listening-derived-migration-v1': JSON.stringify({ status: 'pending', processedEvents: 1500, sourceEventCountAfter: 5000 }),
  });
  const api = loadModule(storage);
  assert.equal(api.checkForStalledPreparation(storage, 1000).recovered, false);
  const result = api.checkForStalledPreparation(storage, 1000 + api.STALL_TIMEOUT_MS);
  assert.equal(result.recovered, true);
  assert.equal(result.state.status, 'error');
  assert.equal(JSON.parse(storage.getItem(api.MIGRATION_CHECKPOINT_KEY)).processedEvents, 1500);
});

test('checkpoint advancement resets the stall window', (t) => {
  t.after(cleanupGlobals);
  const storage = memoryStorage({
    'bandmarkr-listening-canonical-activation-v1': JSON.stringify({ stateVersion: 1, status: 'preparing' }),
    'bandmarkr-listening-derived-migration-v1': JSON.stringify({ status: 'pending', processedEvents: 1500, sourceEventCountAfter: 5000 }),
  });
  const api = loadModule(storage);
  api.checkForStalledPreparation(storage, 1000);
  storage.setItem(api.MIGRATION_CHECKPOINT_KEY, JSON.stringify({ status: 'pending', processedEvents: 2000, sourceEventCountAfter: 5000 }));
  assert.equal(api.checkForStalledPreparation(storage, 1000 + api.STALL_TIMEOUT_MS).recovered, false);
  assert.equal(api.checkForStalledPreparation(storage, 1000 + (api.STALL_TIMEOUT_MS * 2)).recovered, true);
});
