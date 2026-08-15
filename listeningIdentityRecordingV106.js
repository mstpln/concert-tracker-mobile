'use strict';

(function attachListeningIdentityRecordingV106(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrListeningIdentityRecordingV106 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const MAX_WRITE_BATCH = 500;
  const clean = (value) => String(value == null ? '' : value).trim() || null;

  function sourceEventId(event) {
    return clean(event?.stableListenId || event?.sourceEventId);
  }

  async function listAllIdentities(storage) {
    if (!storage?.listIdentities) return [];
    const output = [];
    let afterSourceEventId = null;
    do {
      const page = await storage.listIdentities({ limit: MAX_WRITE_BATCH, afterSourceEventId });
      output.push(...(page.items || []));
      afterSourceEventId = clean(page.nextAfterSourceEventId);
    } while (afterSourceEventId);
    return output;
  }

  function recordingWorkEvents(events = [], existingIdentities = [], bandRecords = [], completion = root?.BandmarkrListeningIdentityCompletionV104) {
    if (!completion) throw new Error('Listening identity completion is unavailable.');
    const existingById = new Map((existingIdentities || []).map((record) => [clean(record?.sourceEventId), record]));
    const tracked = completion.addTrustedBandArtistIdentity(completion.trackedListeningEvents(events), bandRecords);
    return tracked.filter((event) => {
      const id = sourceEventId(event);
      if (!id) return false;
      return !completion.effectiveIdentity(event, existingById.get(id) || {}).recordingMbid;
    });
  }

  function rerenderListening() {
    if (typeof currentScreen === 'undefined') return;
    if (currentScreen === 'stats' && typeof renderStatsScreen === 'function') renderStatsScreen();
    else if (currentScreen === 'top-bands' && typeof renderTopBandsScreen === 'function') renderTopBandsScreen();
    else if (currentScreen === 'profile' && typeof renderProfileScreen === 'function') renderProfileScreen(activeProfileBandId);
  }

  async function completeRecordingIdentities({
    cap,
    fetchImpl = root?.fetch,
    storage = root?.BandmarkrListeningDerivedStorage,
    listenbrainz = root?.LiveVaultListenBrainz,
    events,
    bandRecords = (typeof bands === 'undefined' ? [] : bands),
    progressStore,
    completion = root?.BandmarkrListeningIdentityCompletionV104,
    history = root?.LiveVaultSpotifyHistory,
    onProgress = () => {},
  } = {}) {
    if (!completion) throw new Error('Listening identity completion is unavailable.');
    const loadedEvents = Array.isArray(events)
      ? JSON.parse(JSON.stringify(events))
      : await history?.loadEvents?.(bandRecords);
    if (!Array.isArray(loadedEvents)) throw new Error('Private listening history is unavailable.');

    const existing = await listAllIdentities(storage);
    const existingById = new Map(existing.map((record) => [clean(record?.sourceEventId), record]));
    const workEvents = recordingWorkEvents(loadedEvents, existing, bandRecords, completion);
    const plan = completion.buildLookupPlan(workEvents, existing);
    const store = progressStore === undefined ? completion.defaultProgressStore() : progressStore;
    if (!plan.items.length) {
      completion.clearCursor(store);
      return { checked: 0, resolvedRecordings: 0, written: 0, remaining: 0, alreadyResolved: plan.alreadyResolved, ineligible: plan.ineligible };
    }

    completion.verifyProgressStore(store);
    const cursorBefore = completion.readCursor(store);
    const selection = completion.selectPlanItems(plan.items, cursorBefore, cap || completion.MAX_SIGNATURES_PER_RUN);
    const selected = selection.selected;
    const connection = listenbrainz?.connection?.();
    if (!connection?.token) throw new Error('Connect ListenBrainz on this device before completing missing recording identities.');

    let written = 0;
    let resolvedRecordings = 0;
    let unresolvedSelected = 0;
    for (let index = 0; index < selected.length; index += 1) {
      if (index > 0) await new Promise((resolve) => (root?.setTimeout || setTimeout)(resolve, completion.REQUEST_DELAY_MS));
      const item = selected[index];
      const mapping = await completion.requestLookupOne(item, connection.token, fetchImpl);
      if (!mapping) {
        unresolvedSelected += 1;
        completion.writeCursor(item.cursorKey, store);
        onProgress({ checked: index + 1, total: selected.length, resolvedRecordings, written });
        continue;
      }

      const resolved = {
        artistMbids: mapping.artistMbids,
        recordingMbid: mapping.recordingMbid,
        releaseGroupMbid: item.releaseGroupMbid,
      };
      const records = completion.buildIdentityRecords(item, resolved, new Date().toISOString(), existingById);
      written += await completion.writeIdentityRecords(storage, records);
      resolvedRecordings += 1;
      completion.writeCursor(item.cursorKey, store);
      onProgress({ checked: index + 1, total: selected.length, resolvedRecordings, written });
    }

    const activation = root?.BandmarkrListeningCanonicalActivation;
    if (activation?.applyToApp) await activation.applyToApp().catch(() => {});
    await completion.applyDerivedIdentities(storage);
    rerenderListening();

    return {
      checked: selected.length,
      resolvedRecordings,
      written,
      remaining: Math.max(0, plan.items.length - selected.length + unresolvedSelected),
      alreadyResolved: plan.alreadyResolved,
      ineligible: plan.ineligible,
      wrapped: selection.wrapped,
      cursorBefore,
      cursorAfter: selected[selected.length - 1]?.cursorKey || cursorBefore,
    };
  }

  function takeOverSettingsUi() {
    const screen = root?.document?.getElementById('screen-settings');
    const card = screen?.querySelector('[data-v104-listening-identity]');
    if (!card || card.dataset.v106RecordingOnly === 'true') return false;
    const button = card.querySelector('[data-v104-complete-identities]');
    const hints = card.querySelectorAll('.settings-hint');
    const status = card.querySelector('[data-v104-identity-status]');
    if (!button || !status) return false;

    card.dataset.v106RecordingOnly = 'true';
    if (hints[0]) hints[0].textContent = 'Fill missing MusicBrainz recording IDs for followed bands only when BANDMARKR already has a trusted MusicBrainz artist identity. BANDMARKR checks at most 25 unique recording combinations per run, one at a time. Progress is saved locally so unresolved items do not block later combinations. Release-group enrichment is deferred and does not block recording identity completion.';
    status.textContent = 'Only runs when you press the button. This action uses ListenBrainz for recording identity only; it does not call MusicBrainz release context or send listening timestamps, event IDs, or full-history payloads.';

    const replacement = button.cloneNode(true);
    button.replaceWith(replacement);
    replacement.addEventListener('click', async () => {
      replacement.disabled = true;
      status.textContent = 'Checking unresolved recording identities…';
      try {
        const result = await completeRecordingIdentities({
          onProgress: ({ checked, total, resolvedRecordings }) => {
            status.textContent = `Checking ${checked} of ${total} · ${resolvedRecordings} recording IDs added`;
          },
        });
        status.textContent = result.checked
          ? `Done. Checked ${result.checked} recording combinations · ${result.resolvedRecordings} recording IDs added · ${result.written.toLocaleString()} local identity records updated${result.remaining ? ` · ${result.remaining.toLocaleString()} unresolved recording combinations remain` : ''}. Release-group enrichment is deferred and did not run.`
          : 'No missing recording identities need a safe ListenBrainz lookup on this device. Release-group enrichment is deferred.';
      } catch (error) {
        status.textContent = error?.message || 'Listening identity completion stopped safely.';
      } finally {
        replacement.disabled = false;
      }
    });
    return true;
  }

  function install() {
    if (!root?.document || root.__bandmarkrIdentityRecordingOnlyV106Installed) return false;
    root.__bandmarkrIdentityRecordingOnlyV106Installed = true;
    // v106 made user-initiated identity completion recording-only. Settings v123
    // owns the presentation now, so preserve that provider boundary at the API
    // entry point instead of relying on the retired DOM takeover.
    if (root.BandmarkrListeningIdentityCompletionV104) {
      root.BandmarkrListeningIdentityCompletionV104.complete = completeRecordingIdentities;
    }
    root.document.addEventListener('DOMContentLoaded', takeOverSettingsUi, { once: true });
    const observer = new root.MutationObserver(takeOverSettingsUi);
    observer.observe(root.document.documentElement, { subtree: true, childList: true });
    root.setTimeout?.(takeOverSettingsUi, 0);
    return true;
  }

  if (typeof root?.document !== 'undefined') install();

  return {
    MAX_WRITE_BATCH,
    sourceEventId,
    listAllIdentities,
    recordingWorkEvents,
    completeRecordingIdentities,
    takeOverSettingsUi,
    install,
  };
});
