'use strict';

(function attachListeningPreparationRecovery(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrListeningPreparationRecovery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const ACTIVATION_STATE_KEY = 'bandmarkr-listening-canonical-activation-v1';
  const MIGRATION_CHECKPOINT_KEY = 'bandmarkr-listening-derived-migration-v1';
  const INTERRUPTED_MESSAGE = 'Preparation was interrupted when this device slept or closed. Tap Prepare again to continue from the saved checkpoint.';
  let wakeLock = null;
  let monitorTimer = null;

  function parse(storage, key) {
    try { return JSON.parse(storage?.getItem?.(key) || 'null'); } catch (_) { return null; }
  }

  function recoverInterruptedPreparation(storage = root?.localStorage) {
    const activation = root?.BandmarkrListeningCanonicalActivation;
    const store = activation?.stateStore?.(storage);
    if (!store) return { recovered: false, state: null };
    const current = store.load();
    if (current.status !== 'preparing') return { recovered: false, state: current };
    const next = store.save({ ...current, status: 'error', error: INTERRUPTED_MESSAGE });
    return { recovered: true, state: next };
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

  function startMonitor(storage = root?.localStorage) {
    if (monitorTimer || !root?.setInterval) return;
    monitorTimer = root.setInterval(async () => {
      const status = activationStatus(storage);
      if (status === 'preparing') {
        renderCurrentProgress(storage);
        if (root?.document?.visibilityState === 'visible') await requestWakeLock();
      } else {
        await releaseWakeLock();
      }
    }, 1000);
  }

  function install(storage = root?.localStorage) {
    recoverInterruptedPreparation(storage);
    startMonitor(storage);
    root?.document?.addEventListener?.('click', (event) => {
      if (event.target?.closest?.('[data-canonical-prepare]')) requestWakeLock();
    }, true);
    root?.document?.addEventListener?.('visibilitychange', () => {
      if (root.document.visibilityState === 'visible' && activationStatus(storage) === 'preparing') requestWakeLock();
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
    recoverInterruptedPreparation,
    progressText,
    renderCurrentProgress,
    requestWakeLock,
    releaseWakeLock,
    activationStatus,
    startMonitor,
    install,
  };
});
