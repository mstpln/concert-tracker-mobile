'use strict';

(function attachListeningPreparationRecovery(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrListeningPreparationRecovery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const ACTIVATION_STATE_KEY = 'bandmarkr-listening-canonical-activation-v1';
  const MIGRATION_CHECKPOINT_KEY = 'bandmarkr-listening-derived-migration-v1';
  const INTERRUPTED_MESSAGE = 'Preparation was interrupted when this device slept or closed. Tap Prepare again to continue from the saved checkpoint.';
  const STALL_TIMEOUT_MS = 120000;
  let wakeLock = null;
  let monitorTimer = null;
  let lastProgressSignature = null;
  let lastProgressAt = 0;

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
    const next = store.save({ ...current, status: 'error', error: INTERRUPTED_MESSAGE });
    lastProgressSignature = null;
    lastProgressAt = 0;
    return { recovered: true, state: next };
  }

  function recoverInterruptedPreparation(storage = root?.localStorage) {
    return markInterrupted(storage);
  }

  function progressSignature(storage = root?.localStorage) {
    const checkpoint = parse(storage, MIGRATION_CHECKPOINT_KEY);
    return JSON.stringify({
      status: checkpoint?.status || null,
      processedEvents: Math.max(0, Number(checkpoint?.processedEvents) || 0),
      nextAfterSourceEventId: checkpoint?.nextAfterSourceEventId || null,
      integrityStatus: checkpoint?.integrityStatus || null,
    });
  }

  function checkForStalledPreparation(storage = root?.localStorage, nowMs = Date.now()) {
    if (activationStatus(storage) !== 'preparing') {
      lastProgressSignature = null;
      lastProgressAt = 0;
      return { recovered: false, state: parse(storage, ACTIVATION_STATE_KEY) };
    }
    if (root?.document?.visibilityState === 'hidden') {
      lastProgressSignature = progressSignature(storage);
      lastProgressAt = nowMs;
      return { recovered: false, state: parse(storage, ACTIVATION_STATE_KEY) };
    }
    const signature = progressSignature(storage);
    if (signature !== lastProgressSignature) {
      lastProgressSignature = signature;
      lastProgressAt = nowMs;
      return { recovered: false, state: parse(storage, ACTIVATION_STATE_KEY) };
    }
    if (!lastProgressAt) lastProgressAt = nowMs;
    if (nowMs - lastProgressAt < STALL_TIMEOUT_MS) return { recovered: false, state: parse(storage, ACTIVATION_STATE_KEY) };
    return markInterrupted(storage);
  }

  function progressText(storage = root?.localStorage) {
    const checkpoint = parse(storage, MIGRATION_CHECKPOINT_KEY);
    const processed = Math.max(0, Number(checkpoint?.processedEvents) || 0);
    const total = Math.max(0, Number(checkpoint?.sourceEventCountAfter ?? checkpoint?.sourceEventCountBefore) || 0);
    if (checkpoint?.status === 'complete') return 'Checking the prepared history for confirmed and possible duplicates…';
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
    const status = activationStatus(storage);
    if (status === 'preparing') {
      renderCurrentProgress(storage);
      const recovered = checkForStalledPreparation(storage, nowMs);
      if (recovered.recovered) {
        const card = root?.document?.querySelector?.('[data-canonical-activation]');
        root?.BandmarkrListeningCanonicalActivation?.renderSettingsCard?.(card);
        await releaseWakeLock();
        return recovered;
      }
      if (root?.document?.visibilityState === 'visible') await requestWakeLock();
      return recovered;
    }
    lastProgressSignature = null;
    lastProgressAt = 0;
    await releaseWakeLock();
    return { recovered: false, state: parse(storage, ACTIVATION_STATE_KEY) };
  }

  function startMonitor(storage = root?.localStorage) {
    if (monitorTimer || !root?.setInterval) return;
    monitorTimer = root.setInterval(() => monitorTick(storage), 1000);
  }

  function install(storage = root?.localStorage) {
    recoverInterruptedPreparation(storage);
    startMonitor(storage);
    root?.document?.addEventListener?.('click', (event) => {
      if (event.target?.closest?.('[data-canonical-prepare]')) {
        lastProgressSignature = progressSignature(storage);
        lastProgressAt = Date.now();
        requestWakeLock();
      }
    }, true);
    root?.document?.addEventListener?.('visibilitychange', () => {
      if (activationStatus(storage) !== 'preparing') return;
      lastProgressSignature = progressSignature(storage);
      lastProgressAt = Date.now();
      if (root.document.visibilityState === 'visible') requestWakeLock();
    });
    root?.addEventListener?.('pagehide', releaseWakeLock);
  }

  if (root?.document) {
    install();
    root.addEventListener?.('DOMContentLoaded', () => recoverInterruptedPreparation(), { once: true });
  }

  return {
    ACTIVATION_STATE_KEY,
    MIGRATION_CHECKPOINT_KEY,
    INTERRUPTED_MESSAGE,
    STALL_TIMEOUT_MS,
    recoverInterruptedPreparation,
    checkForStalledPreparation,
    progressSignature,
    progressText,
    renderCurrentProgress,
    requestWakeLock,
    releaseWakeLock,
    activationStatus,
    monitorTick,
    startMonitor,
    install,
  };
});
