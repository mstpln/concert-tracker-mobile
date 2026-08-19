'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function storageWith(value) {
  const values = new Map([['livevault-listenbrainz-v1', JSON.stringify(value)]]);
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test('ListenBrainz reporting stores only minimal aggregate sync counts in the browser-owned connection record', async () => {
  const saved = {
    token:'browser-private-token',
    userName:'synthetic-user',
    lastSyncAt:'2026-08-19T06:00:00.000Z',
    futureField:{ keep:true },
  };
  const storage = storageWith(saved);
  const prior = {
    api:globalThis.LiveVaultListenBrainz,
    storage:globalThis.localStorage,
  };
  const fake = {
    SETTINGS_KEY:'livevault-listenbrainz-v1',
    AUTO_SYNC_INTERVAL_MS:21600000,
    connection(store = storage) {
      const parsed = JSON.parse(store.getItem(this.SETTINGS_KEY));
      return { token:parsed.token, userName:parsed.userName, lastSyncAt:parsed.lastSyncAt };
    },
    async syncNow() {
      const parsed = JSON.parse(storage.getItem(this.SETTINGS_KEY));
      storage.setItem(this.SETTINGS_KEY, JSON.stringify({ token:parsed.token, userName:parsed.userName, lastSyncAt:'2026-08-19T07:00:00.000Z' }));
      return { added:2, skipped:3, eventCount:500 };
    },
    async autoSyncIfDue() { return true; },
    observeForegroundSync() { return true; },
  };
  globalThis.LiveVaultListenBrainz = fake;
  globalThis.localStorage = storage;
  const modulePath = require.resolve('../listenbrainzReportingV145.js');
  delete require.cache[modulePath];
  require(modulePath);
  try {
    const result = await fake.syncNow();
    assert.deepEqual(result, { added:2, skipped:3, eventCount:500 });
    const persisted = JSON.parse(storage.getItem(fake.SETTINGS_KEY));
    assert.deepEqual(persisted.lastSyncResult, { processed:5, added:2, skipped:3 });
    assert.deepEqual(persisted.futureField, { keep:true });
    assert.equal(persisted.lastSyncAt, '2026-08-19T07:00:00.000Z');
    assert.equal('eventCount' in persisted.lastSyncResult, false);
    assert.equal('listens' in persisted.lastSyncResult, false);
    assert.equal('events' in persisted.lastSyncResult, false);
    assert.doesNotMatch(JSON.stringify(persisted.lastSyncResult), /browser-private-token|synthetic-user/i);
    assert.deepEqual(fake.connection().lastSyncResult, { processed:5, added:2, skipped:3 });
  } finally {
    if (prior.api === undefined) delete globalThis.LiveVaultListenBrainz; else globalThis.LiveVaultListenBrainz = prior.api;
    if (prior.storage === undefined) delete globalThis.localStorage; else globalThis.localStorage = prior.storage;
    delete require.cache[modulePath];
  }
});

test('ListenBrainz aggregate normalization rejects malformed counts rather than inventing work', () => {
  const storage = storageWith({ token:'t', userName:'u' });
  const prior = { api:globalThis.LiveVaultListenBrainz, storage:globalThis.localStorage };
  const fake = {
    SETTINGS_KEY:'livevault-listenbrainz-v1', AUTO_SYNC_INTERVAL_MS:21600000,
    connection(){ return { token:'t', userName:'u', lastSyncAt:null }; },
    async syncNow(){ return { added:0, skipped:0 }; },
    async autoSyncIfDue(){ return false; },
    observeForegroundSync(){ return true; },
  };
  globalThis.LiveVaultListenBrainz = fake;
  globalThis.localStorage = storage;
  const modulePath = require.resolve('../listenbrainzReportingV145.js');
  delete require.cache[modulePath];
  require(modulePath);
  try {
    assert.deepEqual(fake.normalizeSyncResult({ added:0, skipped:0 }), { processed:0, added:0, skipped:0 });
    assert.equal(fake.normalizeSyncResult({ added:'not-a-number', skipped:2 }), null);
  } finally {
    if (prior.api === undefined) delete globalThis.LiveVaultListenBrainz; else globalThis.LiveVaultListenBrainz = prior.api;
    if (prior.storage === undefined) delete globalThis.localStorage; else globalThis.localStorage = prior.storage;
    delete require.cache[modulePath];
  }
});
