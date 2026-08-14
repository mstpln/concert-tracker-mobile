'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const gau5 = require('../listeningPreparationV121');
const integration = require('../gau5PreparationIntegrationV121');

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

function activationApi(storage) {
  const key = 'bandmarkr-listening-canonical-activation-v1';
  return {
    stateStore() {
      return {
        load() {
          try { return JSON.parse(storage.getItem(key) || '{"status":"inactive"}'); }
          catch (_) { return { status: 'inactive' }; }
        },
        save(value) {
          storage.setItem(key, JSON.stringify(value));
          return value;
        },
      };
    },
  };
}

function fakeCard() {
  const nodes = {
    status: { textContent: '' },
    prepare: { hidden: false, disabled: false, textContent: '' },
    activate: { hidden: false },
    deactivate: { hidden: false },
  };
  return {
    nodes,
    querySelector(selector) {
      if (selector === '[data-canonical-activation-status]') return nodes.status;
      if (selector === '[data-canonical-prepare]') return nodes.prepare;
      if (selector === '[data-canonical-activate]') return nodes.activate;
      if (selector === '[data-canonical-deactivate]') return nodes.deactivate;
      return null;
    },
  };
}

test('GAU5 integration keeps a best-effort screen wake lock for foreground preparation and releases it afterward', async () => {
  const originalNavigator = globalThis.navigator;
  const originalDocument = globalThis.document;
  let released = 0;
  const lock = {
    released: false,
    addEventListener() {},
    async release() { this.released = true; released += 1; },
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { wakeLock: { async request(type) { assert.equal(type, 'screen'); return lock; } } } });
  globalThis.document = { visibilityState: 'visible' };
  try {
    assert.equal(await integration.requestPreparationWakeLock(), lock);
    assert.equal(await integration.requestPreparationWakeLock(), lock);
    await integration.releasePreparationWakeLock();
    assert.equal(released, 1);
  } finally {
    if (originalNavigator === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator });
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('GAU5 integration renders a stopped preparation truthfully with its durable error reason', () => {
  const originalStorage = globalThis.localStorage;
  const originalGau5 = globalThis.BandmarkrListeningPreparationV121;
  const originalActivation = globalThis.BandmarkrListeningCanonicalActivation;
  const storage = memoryStorage();
  globalThis.localStorage = storage;
  globalThis.BandmarkrListeningPreparationV121 = gau5;
  globalThis.BandmarkrListeningCanonicalActivation = activationApi(storage);
  try {
    const failed = gau5.fail({ ...gau5.defaultState(), phase: 'candidates', stagedEventCount: 500 }, new Error('Candidate lookback window exceeds safe bounded capacity.'));
    gau5.stateStore(storage).save(failed);
    globalThis.BandmarkrListeningCanonicalActivation.stateStore().save({ status: 'error' });
    const card = fakeCard();

    assert.equal(integration.render(card), true);
    assert.match(card.nodes.status.textContent, /^Preparation stopped safely:/);
    assert.match(card.nodes.status.textContent, /lookback window exceeds safe bounded capacity/i);
    assert.equal(card.nodes.prepare.textContent, 'Resume preparation');
    assert.equal(card.nodes.prepare.hidden, false);
    assert.equal(card.nodes.activate.hidden, true);
    assert.equal(card.nodes.deactivate.hidden, true);
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
    if (originalGau5 === undefined) delete globalThis.BandmarkrListeningPreparationV121;
    else globalThis.BandmarkrListeningPreparationV121 = originalGau5;
    if (originalActivation === undefined) delete globalThis.BandmarkrListeningCanonicalActivation;
    else globalThis.BandmarkrListeningCanonicalActivation = originalActivation;
  }
});
