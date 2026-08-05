'use strict';

(function attachDevicePrivacy(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LiveVaultDevicePrivacy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const SETTINGS_KEY = 'concertTrackerSettings';
  const LISTENBRAINZ_SETTINGS_KEY = 'livevault-listenbrainz-v1';
  const LISTENING_ACTIVATION_KEY = 'bandmarkr-listening-canonical-activation-v1';
  const SHELL_CACHE_PREFIX = 'concert-tracker-shell-';
  const TICKET_DB_NAME = 'live-vault-owned-tickets';
  const DERIVED_LISTENING_DB_NAME = 'bandmarkr-listening-derived-v1';
  const REVIEW_LISTENING_DB_NAME = 'bandmarkr-listening-review-v1';

  async function removeShellCaches(cacheStorage = root?.caches) {
    if (!cacheStorage?.keys) return [];
    const keys = await cacheStorage.keys();
    const targets = keys.filter((key) => String(key).startsWith(SHELL_CACHE_PREFIX));
    await Promise.all(targets.map((key) => cacheStorage.delete(key)));
    return targets;
  }

  function deleteDatabase(name, indexedDb = root?.indexedDB) {
    if (!indexedDb?.deleteDatabase) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      const request = indexedDb.deleteDatabase(name);
      request.onsuccess = () => resolve(true);
      request.onblocked = () => reject(new Error(`Could not erase ${name} because it is in use.`));
      request.onerror = () => reject(request.error || new Error(`Could not erase ${name}.`));
    });
  }

  function disconnectDevice({ clearConnection = root?.rsClearConnection, reload = () => root?.location?.reload?.() } = {}) {
    clearConnection?.();
    reload?.();
  }

  async function eraseDevice({
    clearSpotify = () => root?.SpotifyUser?.clearAuth?.(),
    clearListenBrainz = () => root?.LiveVaultListenBrainz?.clearConnection?.(),
    clearHistory = () => root?.LiveVaultSpotifyHistory?.clear?.(),
    clearTickets = () => deleteDatabase(TICKET_DB_NAME),
    clearDerivedListening = () => deleteDatabase(DERIVED_LISTENING_DB_NAME),
    clearReviewListening = () => deleteDatabase(REVIEW_LISTENING_DB_NAME),
    clearConnection = root?.rsClearConnection,
    storage = root?.localStorage,
    cacheStorage = root?.caches,
    reload = () => root?.location?.reload?.(),
  } = {}) {
    await Promise.allSettled([
      clearSpotify?.(),
      clearListenBrainz?.(),
      clearHistory?.(),
      clearTickets?.(),
      clearDerivedListening?.(),
      clearReviewListening?.(),
    ]);
    clearConnection?.();
    storage?.removeItem?.(SETTINGS_KEY);
    storage?.removeItem?.(LISTENBRAINZ_SETTINGS_KEY);
    storage?.removeItem?.(LISTENING_ACTIVATION_KEY);
    await removeShellCaches(cacheStorage);
    reload?.();
  }

  function enhanceConnectionCard() {
    const button = root?.document?.getElementById('change-connection-btn');
    if (!button || button.dataset.devicePrivacyReady === 'true') return;
    button.dataset.devicePrivacyReady = 'true';
    button.textContent = 'Disconnect';
    const card = button.closest('.settings-card');
    if (!card) return;

    const hint = root.document.createElement('p');
    hint.className = 'settings-hint';
    hint.dataset.devicePrivacyHint = 'true';
    hint.textContent = 'Disconnect removes the Worker URL and token from this device. Local settings, listening history and cached tickets remain.';
    button.before(hint);

    const eraseButton = root.document.createElement('button');
    eraseButton.type = 'button';
    eraseButton.id = 'erase-device-btn';
    eraseButton.className = 'btn-secondary btn-danger';
    eraseButton.textContent = 'Erase this device';
    button.after(eraseButton);

    const eraseHint = root.document.createElement('p');
    eraseHint.className = 'settings-hint';
    eraseHint.dataset.deviceEraseHint = 'true';
    eraseHint.textContent = 'Erases this browser’s connection, settings, Spotify authorization, ListenBrainz token, listening history, derived and review listening data, cached ticket PDFs and Live Vault app cache. Remote R2 data and permanent ticket files are not deleted.';
    eraseButton.after(eraseHint);

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      disconnectDevice();
    }, true);

    eraseButton.addEventListener('click', async () => {
      const confirmed = root.confirm?.('Erase all Live Vault data stored on this device? Your remote concert data and permanent ticket files will remain in Cloudflare R2.');
      if (!confirmed) return;
      eraseButton.disabled = true;
      eraseButton.textContent = 'Erasing…';
      await eraseDevice();
    });
  }

  function observeSettings() {
    if (!root?.document || !root.MutationObserver) return;
    const observer = new root.MutationObserver(enhanceConnectionCard);
    observer.observe(root.document.documentElement, { subtree: true, childList: true });
    enhanceConnectionCard();
  }

  if (root?.document) {
    if (root.document.readyState === 'loading') root.addEventListener('DOMContentLoaded', observeSettings, { once: true });
    else observeSettings();
  }

  return {
    SETTINGS_KEY,
    LISTENBRAINZ_SETTINGS_KEY,
    LISTENING_ACTIVATION_KEY,
    SHELL_CACHE_PREFIX,
    TICKET_DB_NAME,
    DERIVED_LISTENING_DB_NAME,
    REVIEW_LISTENING_DB_NAME,
    removeShellCaches,
    deleteDatabase,
    disconnectDevice,
    eraseDevice,
    enhanceConnectionCard,
    observeSettings,
  };
});
