'use strict';

// Resolve the root geographic filter before app.js restores its existing
// Nearby/EU settings. This uses the shared chrome.storage.local contract so
// production and synthetic QA follow the same path.
window.LiveVaultV143GeoStateReady = chrome.storage.local
  .get({ swedenOnly: false, nearbyOnly: false, europeOnly: true })
  .then(async (state) => {
    const swedenOnly = state.swedenOnly === true;
    const normalized = {
      swedenOnly,
      nearbyOnly: swedenOnly ? false : state.nearbyOnly === true && state.europeOnly !== true,
      europeOnly: swedenOnly ? false : state.europeOnly === true,
    };

    if (
      normalized.swedenOnly !== state.swedenOnly ||
      normalized.nearbyOnly !== state.nearbyOnly ||
      normalized.europeOnly !== state.europeOnly
    ) {
      await chrome.storage.local.set(normalized);
    }
    return normalized;
  });
