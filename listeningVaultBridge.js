'use strict';

(function attachListeningVaultBridge(root) {
  if (!root?.LiveVaultSpotifyHistory) return;
  const history = root.LiveVaultSpotifyHistory;

  history.loadStoredEvents = async function loadStoredEvents() {
    const events = await history.loadEvents([]);
    return events.map(({ localBandId, ...event }) => event);
  };

  history.replaceEvents = async function replaceEvents(events, summary = {}) {
    const payload = {
      kind: 'livevault-listening-history',
      schemaVersion: 1,
      summary: { sha256: summary.sourceSha256 || null },
      events,
    };
    const file = new File([JSON.stringify(payload)], 'live-vault-listening-restore.json', {
      type: 'application/json',
    });
    return history.importFile(file);
  };
})(typeof window !== 'undefined' ? window : null);
