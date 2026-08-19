'use strict';

(function attachListenBrainzReportingV145(root) {
  const api = root?.LiveVaultListenBrainz;
  if (!api || api.__reportingV145) return;

  function safeCount(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null;
  }

  function normalizeSyncResult(result) {
    const added = safeCount(result?.added);
    const skipped = safeCount(result?.skipped);
    if (added === null || skipped === null) return null;
    return { processed: added + skipped, added, skipped };
  }

  function storedSettings(storage = root.localStorage) {
    if (!storage?.getItem) return null;
    try {
      const parsed = JSON.parse(storage.getItem(api.SETTINGS_KEY) || 'null');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (_) { return null; }
  }

  function persistSyncResult(result, storage = root.localStorage) {
    const summary = normalizeSyncResult(result);
    const current = storedSettings(storage);
    if (!summary || !current || !storage?.setItem) return summary;
    storage.setItem(api.SETTINGS_KEY, JSON.stringify({ ...current, lastSyncResult: summary }));
    return summary;
  }

  const originalConnection = api.connection.bind(api);
  const originalSyncNow = api.syncNow.bind(api);
  const originalAutoSyncIfDue = api.autoSyncIfDue.bind(api);

  api.connection = (storage = root.localStorage) => {
    const connection = originalConnection(storage);
    if (!connection) return null;
    const summary = storedSettings(storage)?.lastSyncResult;
    const processed = safeCount(summary?.processed);
    const added = safeCount(summary?.added);
    const skipped = safeCount(summary?.skipped);
    return {
      ...connection,
      lastSyncResult: processed !== null && added !== null && skipped !== null ? { processed, added, skipped } : null,
    };
  };

  api.syncNow = async (...args) => {
    const result = await originalSyncNow(...args);
    persistSyncResult(result);
    return result;
  };

  api.autoSyncIfDue = (options = {}) => originalAutoSyncIfDue({ ...options, sync: options.sync || api.syncNow });

  // The legacy bootstrap's Settings injector targets pre-v123 markup and is
  // inert on the current Settings screen. Rebuild only its scheduling hooks
  // so automatic foreground/timer syncs use the wrapped syncNow() above and
  // therefore retain the same minimal device-owned aggregate as manual syncs.
  api.bootstrap = () => {
    api.observeForegroundSync(() => api.autoSyncIfDue());
    root.setTimeout?.(() => api.autoSyncIfDue(), 4000);
    root.setInterval?.(() => api.autoSyncIfDue(), api.AUTO_SYNC_INTERVAL_MS);
  };

  api.normalizeSyncResult = normalizeSyncResult;
  api.persistSyncResult = persistSyncResult;
  api.__reportingV145 = true;
})(typeof globalThis !== 'undefined' ? globalThis : this);
