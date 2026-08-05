'use strict';

(function attachListeningPreparationRecovery(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrListeningPreparationRecovery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const ACTIVATION_STATE_KEY = 'bandmarkr-listening-canonical-activation-v1';
  const MIGRATION_CHECKPOINT_KEY = 'bandmarkr-listening-derived-migration-v1';
  const INTERRUPTED_MESSAGE = 'Preparation was interrupted when this device slept or closed. Tap Prepare again to continue from the saved checkpoint.';
  const STALL_TIMEOUT_MS = 300000;
  const HEARTBEAT_INTERVAL_MS = 30000;
  let wakeLock = null;
  let monitorTimer = null;
  let lastCheckpointSignature = null;
  let lastCheckpointActivityAt = 0;
  let nextActiveOperationId = 1;
  const activeOperations = new Map();

  function parse(storage, key) {
    try { return JSON.parse(storage?.getItem?.(key) || 'null'); } catch (_) { return null; }
  }

  function stateStore(storage = root?.localStorage) {
    return root?.BandmarkrListeningCanonicalActivation?.stateStore?.(storage) || null;
  }

  function markInterrupted(storage = root?.localStorage) {
    const store = stateStore(storage);
    if (!store) return { recovered: false, state: null };
    const current = store.load();
    if (current.status !== 'preparing') return { recovered: false, state: current };
    const next = store.save({
      ...current,
      status: 'error',
      preparationPhase: 'interrupted',
      preparationHeartbeatAt: null,
      error: INTERRUPTED_MESSAGE,
    });
    lastCheckpointSignature = null;
    lastCheckpointActivityAt = 0;
    return { recovered: true, state: next };
  }

  function recoverInterruptedPreparation(storage = root?.localStorage) {
    return markInterrupted(storage);
  }

  function touchPreparation(storage = root?.localStorage, phase = 'preparing', nowMs = Date.now()) {
    const store = stateStore(storage);
    if (!store) return null;
    const current = store.load();
    if (current.status !== 'preparing') return current;
    return store.save({
      ...current,
      preparationPhase: phase,
      preparationHeartbeatAt: new Date(nowMs).toISOString(),
    });
  }

  function beginActiveOperation(phase) {
    const token = nextActiveOperationId++;
    activeOperations.set(token, phase);
    return token;
  }

  function endActiveOperation(token) {
    activeOperations.delete(token);
  }

  function activeOperationPhase() {
    let phase = null;
    for (const value of activeOperations.values()) phase = value;
    return phase;
  }

  function refreshActivePreparation(storage = root?.localStorage, nowMs = Date.now()) {
    const phase = activeOperationPhase();
    if (!phase || activationStatus(storage) !== 'preparing') return null;
    return touchPreparation(storage, phase, nowMs);
  }

  function checkpointSignature(storage = root?.localStorage) {
    const checkpoint = parse(storage, MIGRATION_CHECKPOINT_KEY);
    return JSON.stringify({
      status: checkpoint?.status || null,
      processedEvents: Math.max(0, Number(checkpoint?.processedEvents) || 0),
      nextAfterSourceEventId: checkpoint?.nextAfterSourceEventId || null,
      integrityStatus: checkpoint?.integrityStatus || null,
    });
  }

  function checkForStalledPreparation(storage = root?.localStorage, nowMs = Date.now()) {
    let state = parse(storage, ACTIVATION_STATE_KEY);
    if (state?.status !== 'preparing') {
      lastCheckpointSignature = null;
      lastCheckpointActivityAt = 0;
      return { recovered: false, state };
    }
    if (root?.document?.visibilityState === 'hidden') return { recovered: false, state };

    const refreshed = refreshActivePreparation(storage, nowMs);
    if (refreshed) state = refreshed;

    const signature = checkpointSignature(storage);
    if (signature !== lastCheckpointSignature) {
      lastCheckpointSignature = signature;
      lastCheckpointActivityAt = nowMs;
      return { recovered: false, state };
    }

    const heartbeatMs = Date.parse(state.preparationHeartbeatAt || '');
    const heartbeatFresh = Number.isFinite(heartbeatMs) && nowMs - heartbeatMs < STALL_TIMEOUT_MS;
    const checkpointFresh = lastCheckpointActivityAt > 0 && nowMs - lastCheckpointActivityAt < STALL_TIMEOUT_MS;
    if (heartbeatFresh || checkpointFresh) return { recovered: false, state };
    return markInterrupted(storage);
  }

  function progressText(storage = root?.localStorage) {
    const checkpoint = parse(storage, MIGRATION_CHECKPOINT_KEY);
    const state = parse(storage, ACTIVATION_STATE_KEY);
    const processed = Math.max(0, Number(checkpoint?.processedEvents) || 0);
    const total = Math.max(0, Number(checkpoint?.sourceEventCountAfter ?? checkpoint?.sourceEventCountBefore) || 0);
    if (state?.preparationPhase === 'loading-source') return 'Loading listening history on this device…';
    if (state?.preparationPhase === 'persisting-candidates') return 'Saving confirmed and possible duplicate matches…';
    if (state?.preparationPhase === 'verifying-storage' || state?.preparationPhase === 'reading-canonical' || state?.preparationPhase === 'reading-identities') {
      return 'Verifying cleaned listening totals…';
    }
    if (checkpoint?.status === 'complete' || state?.preparationPhase === 'generating-candidates' || state?.preparationPhase === 'assigning-candidates') {
      return 'Checking the prepared history for confirmed and possible duplicates…';
    }
    if (total > 0) return `Preparing cleaned totals on this device… ${processed.toLocaleString()} of ${total.toLocaleString()} source listens processed.`;
    if (processed > 0) return `Preparing cleaned totals on this device… ${processed.toLocaleString()} source listens processed.`;
    return 'Preparing cleaned totals on this device…';
  }

  function renderCurrentProgress(storage = root?.localStorage) {
    const state = parse(storage, ACTIVATION_STATE_KEY);
    const status = root?.document?.querySelector?.('[data-canonical-activation-status]');
    if (!status || state?.status !== 'preparing') return false;
    status.textContent = progressText(storage);
    return true;
  }

  function renderInterruptedState() {
    const card = root?.document?.querySelector?.('[data-canonical-activation]');
    if (!card) return false;
    const status = card.querySelector('[data-canonical-activation-status]');
    const prepareButton = card.querySelector('[data-canonical-prepare]');
    const activateButton = card.querySelector('[data-canonical-activate]');
    const deactivateButton = card.querySelector('[data-canonical-deactivate]');
    if (status) status.textContent = `Preparation stopped safely: ${INTERRUPTED_MESSAGE}`;
    if (prepareButton) {
      prepareButton.hidden = false;
      prepareButton.textContent = 'Prepare again';
    }
    if (activateButton) activateButton.hidden = true;
    if (deactivateButton) deactivateButton.hidden = true;
    return true;
  }

  function wrapMethod(target, name, phase, storage = root?.localStorage) {
    if (!target || typeof target[name] !== 'function' || target[name].__preparationHeartbeatWrapped) return;
    const original = target[name];
    const wrapped = function wrappedPreparationMethod(...args) {
      touchPreparation(storage, phase);
      let result;
      try {
        result = original.apply(this, args);
      } catch (error) {
        touchPreparation(storage, `${phase}-failed`);
        throw error;
      }
      if (result && typeof result.then === 'function') {
        const activeToken = beginActiveOperation(phase);
        const pulse = root?.setInterval?.(() => touchPreparation(storage, phase), HEARTBEAT_INTERVAL_MS);
        const finish = (finalPhase) => {
          if (pulse != null) root?.clearInterval?.(pulse);
          endActiveOperation(activeToken);
          touchPreparation(storage, finalPhase);
        };
        return result.then((value) => {
          finish(`${phase}-complete`);
          return value;
        }, (error) => {
          finish(`${phase}-failed`);
          throw error;
        });
      }
      touchPreparation(storage, `${phase}-complete`);
      return result;
    };
    wrapped.__preparationHeartbeatWrapped = true;
    target[name] = wrapped;
  }

  function installPreparationInstrumentation(storage = root?.localStorage) {
    const history = root?.LiveVaultSpotifyHistory;
    const migration = root?.BandmarkrListeningDerivedMigration;
    const rollout = root?.BandmarkrListeningReviewRollout;
    const derived = root?.BandmarkrListeningDerivedStorage;
    const reviewStorage = rollout?.reviewStorage;

    wrapMethod(history, 'loadEvents', 'loading-source', storage);
    wrapMethod(migration, 'runToCompletion', 'migrating', storage);
    wrapMethod(rollout, 'generateCandidates', 'generating-candidates', storage);
    wrapMethod(rollout, 'assignOneToOne', 'assigning-candidates', storage);
    wrapMethod(rollout, 'persistCandidatePlan', 'persisting-candidates', storage);
    wrapMethod(rollout, 'reviewComponents', 'summarizing-review', storage);
    wrapMethod(rollout, 'safeAudit', 'finalizing-audit', storage);

    wrapMethod(derived, 'putIdentities', 'persisting-identities', storage);
    wrapMethod(derived, 'putCanonicalBatch', 'persisting-canonical', storage);
    wrapMethod(derived, 'storageSummary', 'verifying-storage', storage);
    wrapMethod(derived, 'listCanonical', 'reading-canonical', storage);
    wrapMethod(derived, 'listIdentities', 'reading-identities', storage);

    for (const name of ['putGroups', 'putReviewGroups', 'listGroups', 'deleteGroups']) {
      wrapMethod(reviewStorage, name, `review-${name}`, storage);
    }
  }

  async function requestWakeLock() {
    if (!root?.navigator?.wakeLock?.request || root?.document?.visibilityState === 'hidden') return null;
    if (wakeLock && !wakeLock.released) return wakeLock;
    try {
      wakeLock = await root.navigator.wakeLock.request('screen');
      wakeLock.addEventListener?.('release', () => { wakeLock = null; }, { once: true });
      return wakeLock;
    } catch (_) { return null; }
  }

  async function releaseWakeLock() {
    const current = wakeLock;
    wakeLock = null;
    try { await current?.release?.(); } catch (_) {}
  }

  function activationStatus(storage = root?.localStorage) {
    return parse(storage, ACTIVATION_STATE_KEY)?.status || 'inactive';
  }

  async function monitorTick(storage = root?.localStorage, nowMs = Date.now()) {
    installPreparationInstrumentation(storage);
    const status = activationStatus(storage);
    if (status === 'preparing') {
      renderCurrentProgress(storage);
      const recovered = checkForStalledPreparation(storage, nowMs);
      if (recovered.recovered) {
        renderInterruptedState();
        await releaseWakeLock();
        return recovered;
      }
      if (root?.document?.visibilityState === 'visible') await requestWakeLock();
      return recovered;
    }
    lastCheckpointSignature = null;
    lastCheckpointActivityAt = 0;
    await releaseWakeLock();
    return { recovered: false, state: parse(storage, ACTIVATION_STATE_KEY) };
  }

  function startMonitor(storage = root?.localStorage) {
    if (monitorTimer || !root?.setInterval) return;
    monitorTimer = root.setInterval(() => monitorTick(storage), 1000);
  }

  function install(storage = root?.localStorage) {
    installPreparationInstrumentation(storage);
    const recovered = recoverInterruptedPreparation(storage);
    if (recovered.recovered) root?.setTimeout?.(renderInterruptedState, 0);
    startMonitor(storage);
    root?.document?.addEventListener?.('click', (event) => {
      if (event.target?.closest?.('[data-canonical-prepare]')) {
        touchPreparation(storage, 'starting');
        requestWakeLock();
      }
    }, true);
    root?.document?.addEventListener?.('visibilitychange', () => {
      if (root.document.visibilityState !== 'visible' || activationStatus(storage) !== 'preparing') return;
      refreshActivePreparation(storage);
      requestWakeLock();
    });
    root?.addEventListener?.('pagehide', releaseWakeLock);
  }

  if (root?.document) {
    install();
    root.addEventListener?.('DOMContentLoaded', () => {
      installPreparationInstrumentation();
      const recovered = recoverInterruptedPreparation();
      if (recovered.recovered) renderInterruptedState();
    }, { once: true });
  }

  return {
    ACTIVATION_STATE_KEY,
    MIGRATION_CHECKPOINT_KEY,
    INTERRUPTED_MESSAGE,
    STALL_TIMEOUT_MS,
    HEARTBEAT_INTERVAL_MS,
    recoverInterruptedPreparation,
    touchPreparation,
    beginActiveOperation,
    endActiveOperation,
    activeOperationPhase,
    refreshActivePreparation,
    checkForStalledPreparation,
    checkpointSignature,
    progressText,
    renderCurrentProgress,
    renderInterruptedState,
    wrapMethod,
    installPreparationInstrumentation,
    requestWakeLock,
    releaseWakeLock,
    activationStatus,
    monitorTick,
    startMonitor,
    install,
  };
});
