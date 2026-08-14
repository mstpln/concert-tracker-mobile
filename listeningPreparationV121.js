'use strict';

(function attachListeningPreparationV121(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrListeningPreparationV121 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const STATE_KEY = 'bandmarkr-listening-preparation-v121';
  const STATE_VERSION = 1;
  const PHASES = Object.freeze(['migration', 'candidates', 'persistence', 'verification']);
  const DEFAULT_CHUNK_SIZE = 500;
  const YIELD_DELAY_MS = 0;
  const PREP_DB_NAME = 'bandmarkr-listening-preparation-v121';
  const PREP_DB_VERSION = 1;
  const STAGED_EVENT_STORE = 'staged-events';
  const CANDIDATE_STORE = 'duplicate-candidates';
  const MAX_PREP_BATCH = 500;

  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const clean = (value) => String(value == null ? '' : value).trim() || null;
  const nonNegativeInteger = (value, fallback = 0) => Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
  const eventId = (event) => clean(event?.stableListenId || event?.sourceEventId);
  const eventTime = (event) => {
    const parsed = Date.parse(event?.listenedAt || '');
    return Number.isFinite(parsed) ? parsed : null;
  };

  function defaultState() {
    return {
      stateVersion: STATE_VERSION,
      status: 'idle',
      phase: 'migration',
      phaseCursor: null,
      processedEvents: 0,
      sourceEventCount: null,
      sourceIntegrity: null,
      completedPhases: [],
      phaseCounts: {},
      candidateStageCursor: null,
      candidateScanCursor: null,
      stagedEventCount: 0,
      candidateCount: 0,
      comparedPairCount: 0,
      startedAt: null,
      updatedAt: null,
      pausedAt: null,
      completedAt: null,
      error: null,
    };
  }

  function normalizeState(value) {
    const source = value?.stateVersion === STATE_VERSION ? value : {};
    const phase = PHASES.includes(source.phase) ? source.phase : 'migration';
    const completedPhases = [...new Set((source.completedPhases || []).filter((item) => PHASES.includes(item)))];
    return {
      ...defaultState(),
      ...clone(source),
      stateVersion: STATE_VERSION,
      status: ['idle', 'running', 'paused', 'complete', 'error'].includes(source.status) ? source.status : 'idle',
      phase,
      phaseCursor: clean(source.phaseCursor),
      processedEvents: nonNegativeInteger(source.processedEvents),
      sourceEventCount: source.sourceEventCount == null ? null : nonNegativeInteger(source.sourceEventCount),
      completedPhases,
      phaseCounts: source.phaseCounts && typeof source.phaseCounts === 'object' && !Array.isArray(source.phaseCounts) ? clone(source.phaseCounts) : {},
      candidateStageCursor: clean(source.candidateStageCursor),
      candidateScanCursor: clean(source.candidateScanCursor),
      stagedEventCount: nonNegativeInteger(source.stagedEventCount),
      candidateCount: nonNegativeInteger(source.candidateCount),
      comparedPairCount: nonNegativeInteger(source.comparedPairCount),
    };
  }

  function stateStore(storage = root?.localStorage) {
    return {
      load() {
        try { return normalizeState(JSON.parse(storage?.getItem?.(STATE_KEY) || 'null')); }
        catch (_) { return defaultState(); }
      },
      save(value) {
        const next = normalizeState({ ...value, updatedAt: new Date().toISOString() });
        storage?.setItem?.(STATE_KEY, JSON.stringify(next));
        return next;
      },
      clear() { storage?.removeItem?.(STATE_KEY); },
    };
  }

  function phaseIndex(phase) { return PHASES.indexOf(phase); }
  function phaseComplete(state, phase) { return normalizeState(state).completedPhases.includes(phase); }

  function begin(state, now = new Date().toISOString()) {
    const current = normalizeState(state);
    if (current.status === 'complete') return current;
    return normalizeState({ ...current, status: 'running', startedAt: current.startedAt || now, pausedAt: null, error: null });
  }

  function checkpoint(state, update = {}, now = new Date().toISOString()) {
    const current = normalizeState(state);
    const next = normalizeState({ ...current, ...clone(update), status: 'running', pausedAt: null, error: null, updatedAt: now });
    if (next.sourceEventCount != null && next.processedEvents > next.sourceEventCount) throw new Error('Preparation checkpoint exceeds the source event count.');
    if (next.sourceEventCount != null && next.stagedEventCount > next.sourceEventCount) throw new Error('Preparation staging exceeds the source event count.');
    return next;
  }

  function completePhase(state, phase, update = {}, now = new Date().toISOString()) {
    const current = normalizeState(state);
    if (!PHASES.includes(phase)) throw new Error('Unknown listening preparation phase.');
    const completedPhases = [...new Set([...current.completedPhases, phase])];
    const index = phaseIndex(phase);
    const nextPhase = PHASES[index + 1] || phase;
    const complete = index === PHASES.length - 1;
    return normalizeState({
      ...current,
      ...clone(update),
      completedPhases,
      phase: nextPhase,
      phaseCursor: complete ? null : clean(update.phaseCursor),
      status: complete ? 'complete' : 'running',
      completedAt: complete ? now : null,
      pausedAt: null,
      error: null,
      updatedAt: now,
    });
  }

  function pause(state, now = new Date().toISOString()) {
    const current = normalizeState(state);
    if (current.status === 'complete') return current;
    return normalizeState({ ...current, status: 'paused', pausedAt: now, error: null, updatedAt: now });
  }

  function fail(state, error, now = new Date().toISOString()) {
    const current = normalizeState(state);
    return normalizeState({ ...current, status: 'error', pausedAt: null, error: clean(error?.message || error) || 'Listening preparation stopped safely.', updatedAt: now });
  }

  function shouldPauseForVisibility(documentRef = root?.document) { return documentRef?.visibilityState === 'hidden'; }
  function resumable(state) { const current = normalizeState(state); return current.status === 'paused' || current.status === 'running'; }

  function statusText(state) {
    const current = normalizeState(state);
    if (current.status === 'complete') return 'Complete';
    if (current.status === 'paused') return 'Paused - will resume';
    if (current.status === 'error') return `Stopped safely${current.error ? `: ${current.error}` : ''}`;
    if (current.status === 'running') return 'Preparing';
    return 'Not prepared';
  }

  async function yieldToBrowser(options = {}) {
    const setTimeoutImpl = options.setTimeoutImpl || root?.setTimeout || setTimeout;
    await new Promise((resolve) => setTimeoutImpl(resolve, Number.isFinite(options.delayMs) ? Math.max(0, options.delayMs) : YIELD_DELAY_MS));
  }

  function requestResult(request, message) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(message));
    });
  }

  function transactionDone(tx, message) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error(message));
      tx.onabort = () => reject(tx.error || new Error(message));
    });
  }

  function stagedSortKey(event) {
    const id = eventId(event);
    const at = eventTime(event);
    if (!id || at == null) return null;
    return `${String(at).padStart(16, '0')}|${id}`;
  }

  function normalizeStagedEvent(event) {
    const sourceEventId = eventId(event);
    const listenedAtMs = eventTime(event);
    const sortKey = stagedSortKey(event);
    if (!sourceEventId || listenedAtMs == null || !sortKey) return null;
    return { ...clone(event), sourceEventId, stableListenId: sourceEventId, listenedAtMs, sortKey };
  }

  function normalizeCandidate(candidate) {
    const leftSourceEventId = eventId(candidate?.left) || clean(candidate?.leftSourceEventId);
    const rightSourceEventId = eventId(candidate?.right) || clean(candidate?.rightSourceEventId);
    if (!leftSourceEventId || !rightSourceEventId || leftSourceEventId === rightSourceEventId) return null;
    const pairKey = [leftSourceEventId, rightSourceEventId].sort().join('|');
    return {
      pairKey,
      leftSourceEventId,
      rightSourceEventId,
      left: clone(candidate.left || null),
      right: clone(candidate.right || null),
      evidence: clone(candidate.evidence || null),
      representativeId: clean(candidate.representativeId) || [leftSourceEventId, rightSourceEventId].sort()[0],
    };
  }

  function openPreparationDb(indexedDB = root?.indexedDB) {
    return new Promise((resolve, reject) => {
      if (!indexedDB) return reject(new Error('This browser does not support resumable listening preparation storage.'));
      const request = indexedDB.open(PREP_DB_NAME, PREP_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STAGED_EVENT_STORE)) db.createObjectStore(STAGED_EVENT_STORE, { keyPath: 'sortKey' });
        if (!db.objectStoreNames.contains(CANDIDATE_STORE)) db.createObjectStore(CANDIDATE_STORE, { keyPath: 'pairKey' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open resumable listening preparation storage.'));
      request.onblocked = () => reject(new Error('Close other Bandmarkr tabs and retry listening preparation.'));
    });
  }

  function preparationStorage(indexedDB = root?.indexedDB) {
    return {
      async clear() {
        const db = await openPreparationDb(indexedDB);
        try {
          const tx = db.transaction([STAGED_EVENT_STORE, CANDIDATE_STORE], 'readwrite');
          tx.objectStore(STAGED_EVENT_STORE).clear();
          tx.objectStore(CANDIDATE_STORE).clear();
          await transactionDone(tx, 'Could not reset resumable listening preparation storage.');
        } finally { db.close(); }
      },
      async putEvents(events = []) {
        if (!Array.isArray(events) || events.length > MAX_PREP_BATCH) throw new Error(`Preparation event batches are limited to ${MAX_PREP_BATCH} records.`);
        const normalized = events.map(normalizeStagedEvent).filter(Boolean);
        const db = await openPreparationDb(indexedDB);
        try {
          const tx = db.transaction(STAGED_EVENT_STORE, 'readwrite');
          const store = tx.objectStore(STAGED_EVENT_STORE);
          for (const event of normalized) store.put(event);
          await transactionDone(tx, 'Could not stage listening events.');
          return { written: normalized.length };
        } finally { db.close(); }
      },
      async readEvents(afterSortKey = null, limit = DEFAULT_CHUNK_SIZE) {
        const bounded = Math.min(MAX_PREP_BATCH, Math.max(1, nonNegativeInteger(limit, DEFAULT_CHUNK_SIZE) || DEFAULT_CHUNK_SIZE));
        const db = await openPreparationDb(indexedDB);
        try {
          const store = db.transaction(STAGED_EVENT_STORE, 'readonly').objectStore(STAGED_EVENT_STORE);
          const range = clean(afterSortKey) ? root.IDBKeyRange.lowerBound(clean(afterSortKey), true) : undefined;
          const items = (await requestResult(store.getAll(range, bounded), 'Could not read staged listening events.')).map(clone);
          return { items, nextAfterSortKey: items.length === bounded ? items.at(-1)?.sortKey || null : null };
        } finally { db.close(); }
      },
      async readLookback(beforeSortKey, earliestMs, limit = MAX_PREP_BATCH) {
        const key = clean(beforeSortKey);
        if (!key) return [];
        const bounded = Math.min(MAX_PREP_BATCH, Math.max(1, nonNegativeInteger(limit, MAX_PREP_BATCH) || MAX_PREP_BATCH));
        const db = await openPreparationDb(indexedDB);
        try {
          const store = db.transaction(STAGED_EVENT_STORE, 'readonly').objectStore(STAGED_EVENT_STORE);
          const range = root.IDBKeyRange.upperBound(key, true);
          const output = [];
          await new Promise((resolve, reject) => {
            const request = store.openCursor(range, 'prev');
            request.onsuccess = () => {
              const cursor = request.result;
              if (!cursor || output.length >= bounded) return resolve();
              const value = cursor.value;
              if (Number(value.listenedAtMs) < earliestMs) return resolve();
              output.push(clone(value));
              cursor.continue();
            };
            request.onerror = () => reject(request.error || new Error('Could not read candidate lookback window.'));
          });
          return output.reverse();
        } finally { db.close(); }
      },
      async putCandidates(candidates = []) {
        if (!Array.isArray(candidates) || candidates.length > MAX_PREP_BATCH) throw new Error(`Preparation candidate batches are limited to ${MAX_PREP_BATCH} records.`);
        const normalized = candidates.map(normalizeCandidate).filter(Boolean);
        const db = await openPreparationDb(indexedDB);
        try {
          const tx = db.transaction(CANDIDATE_STORE, 'readwrite');
          const store = tx.objectStore(CANDIDATE_STORE);
          for (const candidate of normalized) store.put(candidate);
          await transactionDone(tx, 'Could not save duplicate candidates.');
          return { written: normalized.length };
        } finally { db.close(); }
      },
      async count(storeName) {
        const db = await openPreparationDb(indexedDB);
        try { return Number(await requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).count(), 'Could not count preparation records.')) || 0; }
        finally { db.close(); }
      },
    };
  }

  async function runMigrationChunks(options = {}) {
    const migration = options.migration || root?.BandmarkrListeningDerivedMigration;
    const store = options.store || stateStore(options.localStorage);
    if (!migration?.runChunk) throw new Error('Listening migration is unavailable.');
    let state = begin(store.load());
    store.save(state);
    if (phaseComplete(state, 'migration')) return { state, paused: false, processed: 0 };
    let totalProcessed = 0;
    while (true) {
      if (shouldPauseForVisibility(options.documentRef)) {
        state = pause(state); store.save(state); return { state, paused: true, processed: totalProcessed };
      }
      const result = await migration.runChunk({ ...options, bands: options.bands || [], chunkSize: options.chunkSize || DEFAULT_CHUNK_SIZE, checkpoints: options.migrationCheckpoints || migration.checkpointStore?.(options.localStorage) });
      totalProcessed += nonNegativeInteger(result?.processed);
      const migrationCheckpoint = result?.checkpoint || {};
      state = checkpoint(state, {
        phase: 'migration', phaseCursor: clean(migrationCheckpoint.afterSourceEventId), processedEvents: nonNegativeInteger(migrationCheckpoint.processedEvents),
        sourceEventCount: migrationCheckpoint.sourceEventCountAfter ?? migrationCheckpoint.sourceEventCountBefore ?? state.sourceEventCount,
        sourceIntegrity: clean(migrationCheckpoint.integrityStatus), phaseCounts: { ...state.phaseCounts, migrationChunks: nonNegativeInteger(state.phaseCounts?.migrationChunks) + 1 },
      });
      store.save(state);
      if (!result?.hasMore) {
        if (state.sourceIntegrity !== 'passed') throw new Error('Listening preparation integrity check failed.');
        state = completePhase(state, 'migration', { phaseCursor: null }); store.save(state); return { state, paused: false, processed: totalProcessed };
      }
      await yieldToBrowser(options);
    }
  }

  async function stageCandidateEvents(options = {}) {
    const migration = options.migration || root?.BandmarkrListeningDerivedMigration;
    const prep = options.preparationStorage || preparationStorage(options.indexedDB);
    const store = options.store || stateStore(options.localStorage);
    if (!migration?.readSourcePage) throw new Error('Listening source paging is unavailable.');
    let state = begin(store.load());
    if (phaseComplete(state, 'candidates') || state.candidateScanCursor) return { state, paused: false, staged: 0 };
    let afterSourceEventId = state.candidateStageCursor;
    let staged = 0;
    while (true) {
      if (shouldPauseForVisibility(options.documentRef)) {
        state = pause(state); store.save(state); return { state, paused: true, staged };
      }
      const events = await migration.readSourcePage(afterSourceEventId, options.chunkSize || DEFAULT_CHUNK_SIZE, options);
      if (!events.length) {
        const stagedEventCount = await prep.count(STAGED_EVENT_STORE);
        if (state.sourceEventCount != null && stagedEventCount !== state.sourceEventCount) throw new Error('Candidate staging does not cover the full listening source.');
        state = checkpoint(state, { phase: 'candidates', candidateStageCursor: afterSourceEventId, stagedEventCount, phaseCounts: { ...state.phaseCounts, stagingComplete: 1 } });
        store.save(state);
        return { state, paused: false, staged };
      }
      const written = await prep.putEvents(events);
      staged += written.written;
      afterSourceEventId = clean(events.at(-1)?.stableListenId);
      state = checkpoint(state, {
        phase: 'candidates', candidateStageCursor: afterSourceEventId, stagedEventCount: state.stagedEventCount + written.written,
        phaseCounts: { ...state.phaseCounts, candidateStageChunks: nonNegativeInteger(state.phaseCounts?.candidateStageChunks) + 1 },
      });
      store.save(state);
      await yieldToBrowser(options);
    }
  }

  function candidatePairsForPage(lookback = [], page = [], contracts, toleranceMs) {
    if (!contracts?.matchingEvidence) throw new Error('Listening identity contracts are unavailable.');
    const ordered = [...lookback, ...page].sort((a, b) => Number(a.listenedAtMs) - Number(b.listenedAtMs) || String(a.sourceEventId).localeCompare(String(b.sourceEventId)));
    const pageIds = new Set(page.map((event) => event.sourceEventId));
    const candidates = [];
    let comparedPairs = 0;
    let windowStart = 0;
    for (let rightIndex = 0; rightIndex < ordered.length; rightIndex += 1) {
      const right = ordered[rightIndex];
      if (!pageIds.has(right.sourceEventId)) continue;
      while (windowStart < rightIndex && Number(right.listenedAtMs) - Number(ordered[windowStart].listenedAtMs) > toleranceMs) windowStart += 1;
      for (let leftIndex = windowStart; leftIndex < rightIndex; leftIndex += 1) {
        const left = ordered[leftIndex];
        if (left.sourceEventId === right.sourceEventId) continue;
        if (left.source && right.source && left.source === right.source) continue;
        comparedPairs += 1;
        const evidence = contracts.matchingEvidence(left, right);
        if (!evidence?.tier || evidence.outcome === 'unique') continue;
        candidates.push(normalizeCandidate({ left, right, evidence, representativeId: [left.sourceEventId, right.sourceEventId].sort()[0] }));
      }
    }
    const unique = new Map(candidates.filter(Boolean).map((candidate) => [candidate.pairKey, candidate]));
    return { candidates: [...unique.values()], comparedPairs };
  }

  async function scanCandidateChunks(options = {}) {
    const prep = options.preparationStorage || preparationStorage(options.indexedDB);
    const store = options.store || stateStore(options.localStorage);
    const contracts = options.contracts || root?.BandmarkrListeningIdentityContracts;
    const toleranceMs = Number.isFinite(options.toleranceMs) ? Math.max(0, Number(options.toleranceMs)) : Number(contracts?.TIMESTAMP_TOLERANCE_MS) || 1000;
    let state = begin(store.load());
    if (phaseComplete(state, 'candidates')) return { state, paused: false, candidates: 0 };
    let afterSortKey = state.candidateScanCursor;
    let writtenTotal = 0;
    while (true) {
      if (shouldPauseForVisibility(options.documentRef)) {
        state = pause(state); store.save(state); return { state, paused: true, candidates: writtenTotal };
      }
      const page = await prep.readEvents(afterSortKey, options.chunkSize || DEFAULT_CHUNK_SIZE);
      if (!page.items.length) {
        const candidateCount = await prep.count(CANDIDATE_STORE);
        state = completePhase(state, 'candidates', { phaseCursor: null, candidateScanCursor: afterSortKey, candidateCount });
        store.save(state);
        return { state, paused: false, candidates: writtenTotal };
      }
      const first = page.items[0];
      const lookback = await prep.readLookback(first.sortKey, Number(first.listenedAtMs) - toleranceMs);
      const generated = candidatePairsForPage(lookback, page.items, contracts, toleranceMs);
      for (let index = 0; index < generated.candidates.length; index += MAX_PREP_BATCH) {
        const result = await prep.putCandidates(generated.candidates.slice(index, index + MAX_PREP_BATCH));
        writtenTotal += result.written;
      }
      afterSortKey = page.items.at(-1)?.sortKey || afterSortKey;
      const candidateCount = await prep.count(CANDIDATE_STORE);
      state = checkpoint(state, {
        phase: 'candidates', phaseCursor: afterSortKey, candidateScanCursor: afterSortKey, candidateCount,
        comparedPairCount: state.comparedPairCount + generated.comparedPairs,
        phaseCounts: { ...state.phaseCounts, candidateScanChunks: nonNegativeInteger(state.phaseCounts?.candidateScanChunks) + 1 },
      });
      store.save(state);
      await yieldToBrowser(options);
    }
  }

  async function runCandidatePhase(options = {}) {
    const staged = await stageCandidateEvents(options);
    if (staged.paused) return staged;
    return scanCandidateChunks(options);
  }

  function installAutoResume(options = {}) {
    const documentRef = options.documentRef || root?.document;
    const store = options.store || stateStore(options.localStorage);
    const resume = options.resume;
    if (!documentRef?.addEventListener || typeof resume !== 'function') return false;
    if (documentRef.__bandmarkrGau5ResumeInstalled) return false;
    documentRef.__bandmarkrGau5ResumeInstalled = true;
    documentRef.addEventListener('visibilitychange', () => {
      if (documentRef.visibilityState !== 'visible') return;
      const current = store.load();
      if (!resumable(current)) return;
      Promise.resolve(resume()).catch(() => {});
    });
    return true;
  }

  return {
    STATE_KEY, STATE_VERSION, PHASES, DEFAULT_CHUNK_SIZE, YIELD_DELAY_MS, PREP_DB_NAME, PREP_DB_VERSION, STAGED_EVENT_STORE, CANDIDATE_STORE, MAX_PREP_BATCH,
    defaultState, normalizeState, stateStore, phaseComplete, begin, checkpoint, completePhase, pause, fail, shouldPauseForVisibility, resumable, statusText, yieldToBrowser,
    stagedSortKey, normalizeStagedEvent, normalizeCandidate, openPreparationDb, preparationStorage,
    runMigrationChunks, stageCandidateEvents, candidatePairsForPage, scanCandidateChunks, runCandidatePhase, installAutoResume,
  };
});
