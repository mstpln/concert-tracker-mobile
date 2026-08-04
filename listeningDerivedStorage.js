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

  function validVersion(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  function normalizeIdentity(record = {}) {
    const sourceEventId = clean(record.sourceEventId || record.stableListenId);
    if (!sourceEventId) throw new Error('Derived identity records require sourceEventId.');
    return {
      ...clone(record),
      sourceEventId,
      identityVersion: validVersion(record.identityVersion, 1),
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
      dedupeVersion: validVersion(record.dedupeVersion, 1),
      status: clean(record.status) || 'unique',
      reviewedDecision: clone(record.reviewedDecision || null),
      reviewedAt: clean(record.reviewedAt),
      updatedAt: clean(record.updatedAt) || new Date().toISOString(),
    };
  }

  function protectedReviewedFields(existing) {
    if (!existing?.reviewedDecision) return [];
    const action = clean(existing.reviewedDecision.action);
    if (action === 'assign_band' || action === 'reject_band') return ['bandId'];
    if (action === 'merge' || action === 'keep_separate') return ['canonicalListenId', 'duplicateOf'];
    return [];
  }

  function mergeDerivedRecord(existing, incoming, options = {}) {
    if (!existing) return clone(incoming);
    const merged = { ...clone(existing), ...clone(incoming) };
    if (existing.reviewedDecision && !options.replaceReviewedDecision) {
      for (const field of protectedReviewedFields(existing)) merged[field] = clone(existing[field]);
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

  function upgradeSchema(db) {
    ensureStore(db, IDENTITY_STORE, 'identityVersion');
    ensureStore(db, CANONICAL_STORE, 'dedupeVersion');
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!root?.indexedDB) return reject(new Error('This browser does not support private local history storage.'));
      const request = root.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => upgradeSchema(request.result);
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

  function transactionDone(tx, message) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error(message));
      tx.onabort = () => reject(tx.error || new Error(message));
    });
  }

  async function putRecord(storeName, record, options = {}) {
    const normalized = storeName === IDENTITY_STORE ? normalizeIdentity(record) : normalizeCanonical(record);
    const db = await openDb();
    try {
      const existing = await requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).get(normalized.sourceEventId));
      const merged = mergeDerivedRecord(existing, normalized, options);
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(merged);
      await transactionDone(tx, 'Could not save derived listening data.');
      return clone(merged);
    } finally {
      db.close();
    }
  }

  async function putMany(storeName, records, options = {}) {
    const normalizer = storeName === IDENTITY_STORE ? normalizeIdentity : normalizeCanonical;
    const normalized = (records || []).map(normalizer);
    const db = await openDb();
    try {
      const existingRecords = await requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
      const existingById = new Map(existingRecords.map((record) => [record.sourceEventId, record]));
      const merged = normalized.map((record) => mergeDerivedRecord(existingById.get(record.sourceEventId), record, options));
      const tx = db.transaction(storeName, 'readwrite');
      for (const record of merged) tx.objectStore(storeName).put(record);
      await transactionDone(tx, 'Could not save derived listening batch.');
      return { written: merged.length };
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
    if (!Number.isInteger(version) || version <= 0) throw new Error('A positive numeric derived-data version is required.');
    const db = await openDb();
    let deleted = 0;
    try {
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
      await transactionDone(tx, 'Could not remove derived-data version.');
      return { deleted };
    } finally {
      db.close();
    }
  }

  async function storageSummary() {
    const db = await openDb();
    try {
      const tx = db.transaction([SOURCE_STORE, IDENTITY_STORE, CANONICAL_STORE], 'readonly');
      const [sourceEventCount, identityCount, canonicalCount] = await Promise.all([
        requestResult(tx.objectStore(SOURCE_STORE).count()),
        requestResult(tx.objectStore(IDENTITY_STORE).count()),
        requestResult(tx.objectStore(CANONICAL_STORE).count()),
      ]);
      return { sourceEventCount, identityCount, canonicalCount };
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
    protectedReviewedFields,
    mergeDerivedRecord,
    upgradeSchema,
    openDb,
    putIdentity: (record, options) => putRecord(IDENTITY_STORE, record, options),
    putCanonical: (record, options) => putRecord(CANONICAL_STORE, record, options),
    putIdentities: (records, options) => putMany(IDENTITY_STORE, records, options),
    putCanonicalBatch: (records, options) => putMany(CANONICAL_STORE, records, options),
    getIdentity: (sourceEventId) => getRecord(IDENTITY_STORE, sourceEventId),
    getCanonical: (sourceEventId) => getRecord(CANONICAL_STORE, sourceEventId),
    listIdentities: () => listRecords(IDENTITY_STORE),
    listCanonical: () => listRecords(CANONICAL_STORE),
    deleteIdentityVersion: (version) => deleteVersion(IDENTITY_STORE, 'identityVersion', version),
    deleteDedupeVersion: (version) => deleteVersion(CANONICAL_STORE, 'dedupeVersion', version),
    storageSummary,
  };
});
