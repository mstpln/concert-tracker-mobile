'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const activation = require('../listeningCanonicalActivation.js');

function memoryStore(initial = null) {
  let value = initial;
  return {
    load() { return value ? structuredClone(value) : activation.defaultState(); },
    save(next) { value = structuredClone(next); return structuredClone(next); },
    clear() { value = null; },
  };
}

test('canonicalization excludes only records explicitly marked as duplicates', () => {
  const source = [
    { stableListenId: 'a', recordingTitle: 'Track', localBandId: null },
    { stableListenId: 'b', recordingTitle: 'Track', localBandId: null },
    { stableListenId: 'c', recordingTitle: 'Other', localBandId: 'old-band' },
  ];
  const canonical = [
    { sourceEventId: 'a', canonicalListenId: 'a', duplicateOf: null },
    { sourceEventId: 'b', canonicalListenId: 'a', duplicateOf: 'a' },
    { sourceEventId: 'c', canonicalListenId: 'c', duplicateOf: null },
  ];
  const identities = [
    { sourceEventId: 'a', localBandId: 'band-a' },
    { sourceEventId: 'b', localBandId: 'band-a' },
    { sourceEventId: 'c', localBandId: 'band-c' },
  ];
  const result = activation.canonicalizeEvents(source, canonical, identities);
  assert.equal(result.duplicateCount, 1);
  assert.deepEqual(result.events.map((event) => event.stableListenId), ['a', 'c']);
  assert.equal(result.events[0].localBandId, 'band-a');
  assert.equal(result.events[1].localBandId, 'band-c');
});

test('canonicalization fails closed when a source record has no canonical record', () => {
  assert.throws(() => activation.canonicalizeEvents(
    [{ stableListenId: 'a' }, { stableListenId: 'b' }],
    [{ sourceEventId: 'a', canonicalListenId: 'a', duplicateOf: null }],
    [],
  ), /incomplete/);
});

test('canonicalization rejects missing representatives and duplicate chains', () => {
  assert.throws(() => activation.canonicalizeEvents(
    [{ stableListenId: 'a' }, { stableListenId: 'b' }],
    [
      { sourceEventId: 'a', canonicalListenId: 'a', duplicateOf: 'missing' },
      { sourceEventId: 'b', canonicalListenId: 'b', duplicateOf: null },
    ],
    [],
  ), /inconsistent/);
  assert.throws(() => activation.canonicalizeEvents(
    [{ stableListenId: 'a' }, { stableListenId: 'b' }, { stableListenId: 'c' }],
    [
      { sourceEventId: 'a', canonicalListenId: 'a', duplicateOf: null },
      { sourceEventId: 'b', canonicalListenId: 'a', duplicateOf: 'a' },
      { sourceEventId: 'c', canonicalListenId: 'b', duplicateOf: 'b' },
    ],
    [],
  ), /inconsistent/);
});

test('canonicalization rejects a non-duplicate record that points elsewhere', () => {
  assert.throws(() => activation.canonicalizeEvents(
    [{ stableListenId: 'a' }, { stableListenId: 'b' }],
    [
      { sourceEventId: 'a', canonicalListenId: 'a', duplicateOf: null },
      { sourceEventId: 'b', canonicalListenId: 'a', duplicateOf: null },
    ],
    [],
  ), /inconsistent/);
});

test('activation refuses to switch totals when source history changed after preparation', async () => {
  const stateStore = memoryStore({
    ...activation.defaultState(),
    status: 'ready',
    sourceEventCount: 2,
    canonicalRecordCount: 2,
  });
  await assert.rejects(
    activation.activate({ events: [{ stableListenId: 'a' }], stateStore, storage: {} }),
    /changed/,
  );
  assert.equal(stateStore.load().status, 'ready');
});

test('activation reads every bounded page before switching totals', async () => {
  const stateStore = memoryStore({
    ...activation.defaultState(),
    status: 'ready',
    sourceEventCount: 2,
    canonicalRecordCount: 2,
  });
  const canonicalPages = [
    { items: [{ sourceEventId: 'a', canonicalListenId: 'a', duplicateOf: null }], nextAfterSourceEventId: 'a' },
    { items: [{ sourceEventId: 'b', canonicalListenId: 'a', duplicateOf: 'a' }], nextAfterSourceEventId: null },
  ];
  const identityPages = [
    { items: [{ sourceEventId: 'a', localBandId: 'band-a' }], nextAfterSourceEventId: 'a' },
    { items: [{ sourceEventId: 'b', localBandId: 'band-a' }], nextAfterSourceEventId: null },
  ];
  const storage = {
    async listCanonical() { return canonicalPages.shift(); },
    async listIdentities() { return identityPages.shift(); },
  };
  const result = await activation.activate({
    events: [{ stableListenId: 'a' }, { stableListenId: 'b' }],
    stateStore,
    storage,
  });
  assert.equal(result.events.length, 1);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.state.status, 'active');
});

test('deactivation restores original events without deleting prepared data', async () => {
  const stateStore = memoryStore({
    ...activation.defaultState(),
    status: 'active',
    sourceEventCount: 2,
    canonicalRecordCount: 2,
    duplicateCount: 1,
    activatedAt: '2026-01-01T00:00:00.000Z',
  });
  const events = [{ stableListenId: 'a' }, { stableListenId: 'b' }];
  const result = await activation.deactivate({ events, stateStore });
  assert.deepEqual(result.events, events);
  assert.equal(result.state.status, 'ready');
  assert.equal(result.state.activatedAt, null);
  assert.equal(result.state.duplicateCount, 1);
});

test('deactivation marks preparation stale when source history changed', async () => {
  const stateStore = memoryStore({
    ...activation.defaultState(),
    status: 'active',
    sourceEventCount: 2,
    canonicalRecordCount: 2,
  });
  const result = await activation.deactivate({ events: [{ stableListenId: 'a' }], stateStore });
  assert.equal(result.state.status, 'stale');
  assert.match(result.state.error, /changed/);
});

test('inactive state never switches visible listening data', async () => {
  const stateStore = memoryStore();
  const result = await activation.applyToApp({ stateStore });
  assert.deepEqual(result, { applied: false, reason: 'app_unavailable' });
});
