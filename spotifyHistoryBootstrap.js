'use strict';

(function bootstrapPrivateSpotifyHistory(root) {
  if (!root || !root.document) return;

  function applyAfterAppLoad() {
    if (root.__LIVEVAULT_QA_SYNTHETIC_LISTENING__ === true) return;
    root.LiveVaultSpotifyHistory?.applyToApp?.();
  }

  root.addEventListener('DOMContentLoaded', () => {
    root.setTimeout(applyAfterAppLoad, 1000);
    root.setTimeout(applyAfterAppLoad, 3000);
  }, { once: true });
})(typeof window !== 'undefined' ? window : null);
