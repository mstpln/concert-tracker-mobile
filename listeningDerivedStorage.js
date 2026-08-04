'use strict';

(function attachListeningDerivedStorage(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrListeningDerivedStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const DB_NAME = 'livevault-listening-history-v1';
  const DB_VERSION = 2;
  const SOURCE_STORE = 'listens';
  const META_STORE = 'meta';
  const IDENTITY_STORE = 'listen-identities';
  const CANONICAL_STORE = 'listen-canonical';

  function clean(value) {
    const text = String(value == null ? '' : value).trim();
    return text || null;
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function normalizeIdentity(record = {}) {
    const sourceEventId = clean(record.sourceEventId || record.stableListenId);
    if (!sourceEventId) throw new Error('Derived identity records require sourceEventId.');
    return {
      ...clone(record),
      sourceEventId,
      identityVersion: Number.isInteger(record.identityVersion) ? record.identityVersion : 1,
      status: clean(record.status) || 'unresolved',
      reviewedDecision: clone(record.reviewedDecision || null),
      reviewedAt: clean(record.reviewedAt),
      updatedAt: clean(record.updatedAt) || new Date().toISOString(),
    };
  }

  function normalizeCanonical(record = {}) {
    const sourceEventId = clean(record.sourceEventId || record.stableListenId);
    if (!sourceEventId) throw new Error('Canonical records require sourceEventId.');
    return {
      ...clone(record),
      sourceEventId,
      canonicalListenId: clean(record.canonicalListenId) || sourceEventId,
      duplicateOf: clean(record.duplicateOf),
      dedupeVersion: Number.isInteger(record.dedupeVersion) ? record.dedupeVersion : 1,
      status: clean(record.status) || 'unique',
      reviewedDecision: clone(record.reviewedDecision || null),
      reviewedAt: clean(record.reviewedAt),
      updatedAt: clean(record.updatedAt) || new Date().toISOString(),
    };
  }

  function mergeDerivedRecord(existing, incoming, options = {}) {
    if (!existing) return clone(incoming);
    const merged = { ...clone(existing), ...clone(incoming) };
    if (existing.reviewedDecision && !options.replaceReviewedDecision) {
      merged.reviewedDecision = clone(existing.reviewedDecision);
      merged.reviewedAt = existing.reviewedAt || null;
      merged.status = existing.status === 'user_reviewed' ? 'user_reviewed' : merged.status;
    }
    return merged;
  }

  function ensureStore(db, name, versionField) {
    if (db.objectStoreNames.contains(name)) return;
    const store = db.createObjectStore(name, { keyPath: 'sourceEventId' });
    store.createIndex(versionField, versionField, { unique: false });
    store.createIndex('status', 'status', { unique: false });
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!root?.indexedDB) return reject(new Error('This browser does not support private local history storage.'));
      const request = root.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        ensureStore(db, IDENTITY_STORE, 'identityVersion');
        ensureStore(db, CANONICAL_STORE, 'dedupeVersion');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open derived listening storage.'));
      request.onblocked = () => reject(new Error('Close other Bandmarkr tabs and retry the storage upgrade.'));
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Derived listening storage failed.'));
    });
  }

  async function putRecord(storeName, record, options = {}) {
    const normalized = storeName === IDENTITY_STORE ? normalizeIdentity(record) : normalizeCanonical(record);
    const db = await openDb();
    try {
      const existing = await requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).get(normalized.sourceEventId));
      const merged = mergeDerivedRecord(existing, normalized, options);
      await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(merged);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not save derived listening data.'));
        tx.onabort = () => reject(tx.error || new Error('Derived listening write was cancelled.'));
      });
      return clone(merged);
    } finally {
      db.close();
    }
  }

  async function getRecord(storeName, sourceEventId) {
    const key = clean(sourceEventId);
    if (!key) return null;
    const db = await openDb();
    try {
      return clone(await requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).get(key)) || null);
    } finally {
      db.close();
    }
  }

  async function listRecords(storeName) {
    const db = await openDb();
    try {
      const records = await requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
      return records.map(clone).sort((a, b) => a.sourceEventId.localeCompare(b.sourceEventId));
    } finally {
      db.close();
    }
  }

  async function deleteVersion(storeName, versionField, version) {
    if (!Number.isInteger(version)) throw new Error('A numeric derived-data version is required.');
    const db = await openDb();
    let deleted = 0;
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const index = tx.objectStore(storeName).index(versionField);
        const request = index.openCursor(root.IDBKeyRange.only(version));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          cursor.delete();
          deleted += 1;
          cursor.continue();
        };
        request.onerror = () => reject(request.error || new Error('Could not remove derived-data version.'));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not remove derived-data version.'));
        tx.onabort = () => reject(tx.error || new Error('Derived-data rollback was cancelled.'));
      });
      return { deleted };
    } finally {
      db.close();
    }
  }

  return {
    DB_NAME,
    DB_VERSION,
    SOURCE_STORE,
    META_STORE,
    IDENTITY_STORE,
    CANONICAL_STORE,
    normalizeIdentity,
    normalizeCanonical,
    mergeDerivedRecord,
    openDb,
    putIdentity: (record, options) => putRecord(IDENTITY_STORE, record, options),
    putCanonical: (record, options) => putRecord(CANONICAL_STORE, record, options),
    getIdentity: (sourceEventId) => getRecord(IDENTITY_STORE, sourceEventId),
    getCanonical: (sourceEventId) => getRecord(CANONICAL_STORE, sourceEventId),
    listIdentities: () => listRecords(IDENTITY_STORE),
    listCanonical: () => listRecords(CANONICAL_STORE),
    deleteIdentityVersion: (version) => deleteVersion(IDENTITY_STORE, 'identityVersion', version),
    deleteDedupeVersion: (version) => deleteVersion(CANONICAL_STORE, 'dedupeVersion', version),
  };
});
