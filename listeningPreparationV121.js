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

  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const clean = (value) => String(value == null ? '' : value).trim() || null;
  const nonNegativeInteger = (value, fallback = 0) => Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;

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
    return normalizeState({
      ...current,
      status: 'running',
      startedAt: current.startedAt || now,
      pausedAt: null,
      error: null,
    });
  }

  function checkpoint(state, update = {}, now = new Date().toISOString()) {
    const current = normalizeState(state);
    const next = normalizeState({ ...current, ...clone(update), status: 'running', pausedAt: null, error: null, updatedAt: now });
    if (next.sourceEventCount != null && next.processedEvents > next.sourceEventCount) throw new Error('Preparation checkpoint exceeds the source event count.');
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

  function shouldPauseForVisibility(documentRef = root?.document) {
    return documentRef?.visibilityState === 'hidden';
  }

  function resumable(state) {
    const current = normalizeState(state);
    return current.status === 'paused' || current.status === 'running';
  }

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
        state = pause(state);
        store.save(state);
        return { state, paused: true, processed: totalProcessed };
      }

      const result = await migration.runChunk({
        ...options,
        bands: options.bands || [],
        chunkSize: options.chunkSize || DEFAULT_CHUNK_SIZE,
        checkpoints: options.migrationCheckpoints || migration.checkpointStore?.(options.localStorage),
      });
      totalProcessed += nonNegativeInteger(result?.processed);
      const migrationCheckpoint = result?.checkpoint || {};
      state = checkpoint(state, {
        phase: 'migration',
        phaseCursor: clean(migrationCheckpoint.afterSourceEventId),
        processedEvents: nonNegativeInteger(migrationCheckpoint.processedEvents),
        sourceEventCount: migrationCheckpoint.sourceEventCountAfter ?? migrationCheckpoint.sourceEventCountBefore ?? state.sourceEventCount,
        sourceIntegrity: clean(migrationCheckpoint.integrityStatus),
        phaseCounts: { ...state.phaseCounts, migrationChunks: nonNegativeInteger(state.phaseCounts?.migrationChunks) + 1 },
      });
      store.save(state);

      if (!result?.hasMore) {
        if (state.sourceIntegrity !== 'passed') throw new Error('Listening preparation integrity check failed.');
        state = completePhase(state, 'migration', { phaseCursor: null });
        store.save(state);
        return { state, paused: false, processed: totalProcessed };
      }
      await yieldToBrowser(options);
    }
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
    STATE_KEY,
    STATE_VERSION,
    PHASES,
    DEFAULT_CHUNK_SIZE,
    YIELD_DELAY_MS,
    defaultState,
    normalizeState,
    stateStore,
    phaseComplete,
    begin,
    checkpoint,
    completePhase,
    pause,
    fail,
    shouldPauseForVisibility,
    resumable,
    statusText,
    yieldToBrowser,
    runMigrationChunks,
    installAutoResume,
  };
});
