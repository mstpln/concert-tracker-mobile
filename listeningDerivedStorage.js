'use strict';

(function attachListeningDerivedStorage(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrListeningDerivedStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const DB_NAME = 'bandmarkr-listening-derived-v1';
  const DB_VERSION = 2;
  const SOURCE_DB_NAME = 'livevault-listening-history-v1';
  const IDENTITY_STORE = 'listen-identities';
  const CANONICAL_STORE = 'listen-canonical';
  const IDENTITY_HISTORY_STORE = 'listen-identities-history';
  const CANONICAL_HISTORY_STORE = 'listen-canonical-history';
  const MAX_BATCH_SIZE = 500;
  const MAX_READ_LIMIT = 500;

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

  function boundedLimit(value, fallback = MAX_READ_LIMIT) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, MAX_READ_LIMIT);
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
      updatedAt: clean(record.updatedAt),
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
      updatedAt: clean(record.updatedAt),
    };
  }

  function protectedReviewedFields(existing) {
    if (!existing?.reviewedDecision) return [];
    const action = clean(existing.reviewedDecision.action);
    if (action === 'assign_band' || action === 'reject_band') return ['bandId'];
    if (action === 'merge' || action === 'keep_separate') return ['canonicalListenId', 'duplicateOf'];
    return ['bandId', 'canonicalListenId', 'duplicateOf'];
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

  function preserveCurrentReview(restored, current) {
    const result = clone(restored);
    if (!current?.reviewedDecision) return result;
    for (const field of protectedReviewedFields(current)) result[field] = clone(current[field]);
    result.reviewedDecision = clone(current.reviewedDecision);
    result.reviewedAt = current.reviewedAt || null;
    result.status = current.status === 'user_reviewed' ? 'user_reviewed' : result.status;
    return result;
  }

  function ensureCurrentStore(db, name, versionField) {
    if (db.objectStoreNames.contains(name)) return;
    const store = db.createObjectStore(name, { keyPath: 'sourceEventId' });
    store.createIndex(versionField, versionField, { unique: false });
    store.createIndex('status', 'status', { unique: false });
  }

  function ensureHistoryStore(db, name, versionField) {
    if (db.objectStoreNames.contains(name)) return;
    const store = db.createObjectStore(name, { keyPath: ['sourceEventId', versionField] });
    store.createIndex('sourceEventId', 'sourceEventId', { unique: false });
    store.createIndex(versionField, versionField, { unique: false });
  }

  function upgradeSchema(db) {
    ensureCurrentStore(db, IDENTITY_STORE, 'identityVersion');
    ensureCurrentStore(db, CANONICAL_STORE, 'dedupeVersion');
    ensureHistoryStore(db, IDENTITY_HISTORY_STORE, 'identityVersion');
    ensureHistoryStore(db, CANONICAL_HISTORY_STORE, 'dedupeVersion');
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

  function storeConfig(storeName) {
    if (storeName === IDENTITY_STORE) return { versionField: 'identityVersion', historyStore: IDENTITY_HISTORY_STORE };
    return { versionField: 'dedupeVersion', historyStore: CANONICAL_HISTORY_STORE };
  }

  function normalizeBatch(storeName, records) {
    if (!Array.isArray(records)) throw new Error('Derived listening batches must be arrays.');
    if (records.length > MAX_BATCH_SIZE) throw new Error(`Derived listening batches are limited to ${MAX_BATCH_SIZE} records.`);
    const normalizer = storeName === IDENTITY_STORE ? normalizeIdentity : normalizeCanonical;
    const normalized = records.map(normalizer);
    const keys = new Set();
    for (const record of normalized) {
      if (keys.has(record.sourceEventId)) throw new Error('Derived listening batches cannot repeat sourceEventId.');
      keys.add(record.sourceEventId);
    }
    return normalized;
  }

  function writeMergedWithSnapshot(currentStore, historyStore, versionField, existing, incoming, options) {
    if (existing && existing[versionField] !== incoming[versionField]) historyStore.put(clone(existing));
    const merged = mergeDerivedRecord(existing, incoming, options);
    currentStore.put(merged);
    return merged;
  }

  async function putRecord(storeName, record, options = {}) {
    const normalized = storeName === IDENTITY_STORE ? normalizeIdentity(record) : normalizeCanonical(record);
    const { versionField, historyStore } = storeConfig(storeName);
    const db = await openDb();
    let merged = null;
    try {
      const tx = db.transaction([storeName, historyStore], 'readwrite');
      const current = tx.objectStore(storeName);
      const history = tx.objectStore(historyStore);
      const request = current.get(normalized.sourceEventId);
      request.onsuccess = () => {
        merged = writeMergedWithSnapshot(current, history, versionField, request.result, normalized, options);
      };
      await transactionDone(tx, 'Could not save derived listening data.');
      return clone(merged);
    } finally {
      db.close();
    }
  }

  async function putMany(storeName, records, options = {}) {
    const normalized = normalizeBatch(storeName, records);
    if (!normalized.length) return { written: 0 };
    const { versionField, historyStore } = storeConfig(storeName);
    const db = await openDb();
    try {
      const tx = db.transaction([storeName, historyStore], 'readwrite');
      const current = tx.objectStore(storeName);
      const history = tx.objectStore(historyStore);
      for (const incoming of normalized) {
        const request = current.get(incoming.sourceEventId);
        request.onsuccess = () => writeMergedWithSnapshot(current, history, versionField, request.result, incoming, options);
      }
      await transactionDone(tx, 'Could not save derived listening batch.');
      return { written: normalized.length };
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

  async function listRecords(storeName, options = {}) {
    const limit = boundedLimit(options.limit);
    const afterSourceEventId = clean(options.afterSourceEventId);
    const db = await openDb();
    try {
      const store = db.transaction(storeName, 'readonly').objectStore(storeName);
      const range = afterSourceEventId ? root.IDBKeyRange.lowerBound(afterSourceEventId, true) : undefined;
      const records = await requestResult(store.getAll(range, limit));
      const items = records.map(clone).sort((a, b) => a.sourceEventId.localeCompare(b.sourceEventId));
      return {
        items,
        nextAfterSourceEventId: items.length === limit ? items.at(-1).sourceEventId : null,
      };
    } finally {
      db.close();
    }
  }

  function restorePriorSnapshot(historyIndex, currentRecord, version, currentStore, currentCursor, complete) {
    const historyRequest = historyIndex.openCursor(root.IDBKeyRange.only(currentRecord.sourceEventId), 'prev');
    historyRequest.onsuccess = () => {
      const historyCursor = historyRequest.result;
      if (!historyCursor) {
        if (currentRecord.reviewedDecision) {
          complete('retained');
          return;
        }
        currentCursor.delete();
        complete('removed');
        return;
      }
      const snapshot = historyCursor.value;
      const snapshotVersion = snapshot[historyIndex.objectStore.keyPath[1]];
      if (snapshotVersion >= version) {
        historyCursor.continue();
        return;
      }
      currentStore.put(preserveCurrentReview(snapshot, currentRecord));
      complete('restored');
    };
  }

  async function rollbackVersion(storeName, versionField, version, options = {}) {
    if (!Number.isInteger(version) || version <= 0) throw new Error('A positive numeric derived-data version is required.');
    const limit = boundedLimit(options.limit);
    const { historyStore } = storeConfig(storeName);
    const db = await openDb();
    let matched = 0;
    let processed = 0;
    let restored = 0;
    let removed = 0;
    let retainedReviewed = 0;
    try {
      const tx = db.transaction([storeName, historyStore], 'readwrite');
      const currentStore = tx.objectStore(storeName);
      const historyIndex = tx.objectStore(historyStore).index('sourceEventId');
      const range = root.IDBKeyRange.only(version);
      const countRequest = currentStore.index(versionField).count(range);
      countRequest.onsuccess = () => { matched = Number(countRequest.result) || 0; };
      const request = currentStore.index(versionField).openCursor(range);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || processed >= limit) return;
        processed += 1;
        restorePriorSnapshot(historyIndex, cursor.value, version, currentStore, cursor, (outcome) => {
          if (outcome === 'restored') restored += 1;
          else if (outcome === 'retained') retainedReviewed += 1;
          else removed += 1;
          cursor.continue();
        });
      };
      await transactionDone(tx, 'Could not roll back derived-data version.');
      return {
        processed,
        restored,
        removed,
        retainedReviewed,
        remaining: Math.max(0, matched - processed),
        hasMore: matched > processed,
      };
    } finally {
      db.close();
    }
  }

  async function storageSummary() {
    const db = await openDb();
    try {
      const tx = db.transaction([IDENTITY_STORE, CANONICAL_STORE], 'readonly');
      const [identityCount, canonicalCount] = await Promise.all([
        requestResult(tx.objectStore(IDENTITY_STORE).count()),
        requestResult(tx.objectStore(CANONICAL_STORE).count()),
      ]);
      return { identityCount, canonicalCount };
    } finally {
      db.close();
    }
  }

  return {
    DB_NAME,
    DB_VERSION,
    SOURCE_DB_NAME,
    IDENTITY_STORE,
    CANONICAL_STORE,
    IDENTITY_HISTORY_STORE,
    CANONICAL_HISTORY_STORE,
    MAX_BATCH_SIZE,
    MAX_READ_LIMIT,
    normalizeIdentity,
    normalizeCanonical,
    normalizeBatch,
    protectedReviewedFields,
    mergeDerivedRecord,
    preserveCurrentReview,
    upgradeSchema,
    openDb,
    putIdentity: (record, options) => putRecord(IDENTITY_STORE, record, options),
    putCanonical: (record, options) => putRecord(CANONICAL_STORE, record, options),
    putIdentities: (records, options) => putMany(IDENTITY_STORE, records, options),
    putCanonicalBatch: (records, options) => putMany(CANONICAL_STORE, records, options),
    getIdentity: (sourceEventId) => getRecord(IDENTITY_STORE, sourceEventId),
    getCanonical: (sourceEventId) => getRecord(CANONICAL_STORE, sourceEventId),
    listIdentities: (options) => listRecords(IDENTITY_STORE, options),
    listCanonical: (options) => listRecords(CANONICAL_STORE, options),
    deleteIdentityVersion: (version, options) => rollbackVersion(IDENTITY_STORE, 'identityVersion', version, options),
    deleteDedupeVersion: (version, options) => rollbackVersion(CANONICAL_STORE, 'dedupeVersion', version, options),
    storageSummary,
  };
});
