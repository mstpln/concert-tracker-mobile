'use strict';

(function attachListeningDerivedMigration(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrListeningDerivedMigration = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const SOURCE_DB_NAME = 'livevault-listening-history-v1';
  const SOURCE_STORE = 'listens';
  const CHECKPOINT_KEY = 'bandmarkr-listening-derived-migration-v1';
  const MIGRATION_VERSION = 1;
  const MAX_CHUNK_SIZE = 500;

  function clean(value) {
    const text = String(value == null ? '' : value).trim();
    return text || null;
  }

  function normalizeText(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('en');
  }

  function boundedChunkSize(value) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return MAX_CHUNK_SIZE;
    return Math.min(parsed, MAX_CHUNK_SIZE);
  }

  function defaultCheckpoint() {
    return {
      migrationVersion: MIGRATION_VERSION,
      status: 'pending',
      afterSourceEventId: null,
      processedEvents: 0,
      sourceEventCountBefore: null,
      sourceEventCountAfter: null,
      integrityStatus: 'not_checked',
    };
  }

  function checkpointStore(storage = root?.localStorage) {
    return {
      load() {
        try {
          const parsed = JSON.parse(storage?.getItem?.(CHECKPOINT_KEY) || 'null');
          return parsed?.migrationVersion === MIGRATION_VERSION ? { ...defaultCheckpoint(), ...parsed } : defaultCheckpoint();
        } catch (_) { return defaultCheckpoint(); }
      },
      save(value) { storage?.setItem?.(CHECKPOINT_KEY, JSON.stringify(value)); },
      clear() { storage?.removeItem?.(CHECKPOINT_KEY); },
    };
  }

  function requestResult(request, message) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(message));
    });
  }

  function openSourceDb(indexedDB = root?.indexedDB) {
    return new Promise((resolve, reject) => {
      if (!indexedDB) return reject(new Error('This browser does not support private local history storage.'));
      const request = indexedDB.open(SOURCE_DB_NAME, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open source listening history.'));
      request.onupgradeneeded = () => request.transaction?.abort?.();
    });
  }

  async function sourceCount(options = {}) {
    const db = await (options.openSourceDb || openSourceDb)();
    try {
      return Number(await requestResult(db.transaction(SOURCE_STORE, 'readonly').objectStore(SOURCE_STORE).count(), 'Could not count source listening history.')) || 0;
    } finally { db.close(); }
  }

  async function readSourcePage(afterSourceEventId, limit, options = {}) {
    const db = await (options.openSourceDb || openSourceDb)();
    try {
      const store = db.transaction(SOURCE_STORE, 'readonly').objectStore(SOURCE_STORE);
      const range = afterSourceEventId ? root.IDBKeyRange.lowerBound(afterSourceEventId, true) : undefined;
      const items = await requestResult(store.getAll(range, boundedChunkSize(limit)), 'Could not read source listening history.');
      return items.sort((a, b) => String(a.stableListenId).localeCompare(String(b.stableListenId)));
    } finally { db.close(); }
  }

  function bandLookup(bands = []) {
    const byName = new Map();
    const ambiguous = new Set();
    for (const band of bands || []) {
      const bandId = clean(band?.id);
      const name = normalizeText(band?.name);
      if (!bandId || !name || ambiguous.has(name)) continue;
      const existing = byName.get(name);
      if (existing && existing !== bandId) {
        byName.delete(name);
        ambiguous.add(name);
      } else if (!existing) {
        byName.set(name, bandId);
      }
    }
    return byName;
  }

  function deriveRecords(events, bands = [], contracts = root?.BandmarkrListeningIdentityContracts) {
    if (!contracts?.identityEnvelope || !contracts?.canonicalEnvelope) throw new Error('Listening identity contracts are unavailable.');
    const byName = bandLookup(bands);
    const identities = [];
    const canonical = [];
    for (const event of events) {
      const sourceEventId = clean(event?.stableListenId);
      if (!sourceEventId) throw new Error('Source listening event is missing stableListenId.');
      const localBandId = clean(event.bandId || event.localBandId) || byName.get(normalizeText(event.artistCreditName)) || null;
      identities.push({
        ...contracts.identityEnvelope({ ...event, sourceEventId, localBandId }),
        sourceEventId,
        status: localBandId ? 'resolved' : 'unresolved',
      });
      canonical.push({
        ...contracts.canonicalEnvelope({ ...event, sourceEventId, canonicalListenId: sourceEventId, dedupeStatus: 'unique' }),
        sourceEventId,
      });
    }
    return { identities, canonical };
  }

  async function runChunk(options = {}) {
    const storage = options.derivedStorage || root?.BandmarkrListeningDerivedStorage;
    if (!storage?.putIdentities || !storage?.putCanonicalBatch) throw new Error('Derived listening storage is unavailable.');
    const checkpoints = options.checkpoints || checkpointStore(options.localStorage);
    const checkpoint = checkpoints.load();
    const chunkSize = boundedChunkSize(options.chunkSize);
    const before = await (options.sourceCount || sourceCount)(options);
    const events = await (options.readSourcePage || readSourcePage)(checkpoint.afterSourceEventId, chunkSize, options);
    if (!events.length) {
      const after = await (options.sourceCount || sourceCount)(options);
      if (before !== after) throw new Error('Source listening history changed during migration.');
      const complete = { ...checkpoint, status: 'complete', sourceEventCountBefore: before, sourceEventCountAfter: after, integrityStatus: 'passed' };
      checkpoints.save(complete);
      return { processed: 0, hasMore: false, checkpoint: complete };
    }
    const derived = deriveRecords(events, options.bands, options.contracts);
    await storage.putIdentities(derived.identities);
    await storage.putCanonicalBatch(derived.canonical);
    const after = await (options.sourceCount || sourceCount)(options);
    if (before !== after) throw new Error('Source listening history changed during migration.');
    const processedEvents = checkpoint.processedEvents + events.length;
    const hasMore = processedEvents < after;
    const next = {
      ...checkpoint,
      status: hasMore ? 'pending' : 'complete',
      afterSourceEventId: clean(events.at(-1)?.stableListenId),
      processedEvents,
      sourceEventCountBefore: before,
      sourceEventCountAfter: after,
      integrityStatus: 'passed',
    };
    checkpoints.save(next);
    return { processed: events.length, hasMore, checkpoint: next };
  }

  async function runToCompletion(options = {}) {
    let totalProcessed = 0;
    let result;
    do {
      result = await runChunk(options);
      totalProcessed += result.processed;
    } while (result.hasMore);
    return { totalProcessed, checkpoint: result.checkpoint };
  }

  return {
    SOURCE_DB_NAME,
    SOURCE_STORE,
    CHECKPOINT_KEY,
    MIGRATION_VERSION,
    MAX_CHUNK_SIZE,
    boundedChunkSize,
    defaultCheckpoint,
    checkpointStore,
    openSourceDb,
    sourceCount,
    readSourcePage,
    bandLookup,
    deriveRecords,
    runChunk,
    runToCompletion,
  };
});
