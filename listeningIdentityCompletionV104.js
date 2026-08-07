'use strict';

(function attachListeningIdentityCompletionV104(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrListeningIdentityCompletionV104 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const LOOKUP_URL = 'https://api.listenbrainz.org/1/metadata/lookup/';
  const RELEASE_CONTEXT_PATH = 'musicbrainz/release-context';
  const MAX_SIGNATURES_PER_RUN = 25;
  const MAX_WRITE_BATCH = 500;
  const REQUEST_DELAY_MS = 1000;
  const CURSOR_STORAGE_KEY = 'bandmarkrListeningIdentityV104Cursor';

  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const clean = (value) => String(value == null ? '' : value).trim() || null;
  const normalizeText = (value) => String(value || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
  const validUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());

  function safeUuid(value) {
    const text = String(value || '').trim().toLowerCase();
    return validUuid(text) ? text : null;
  }

  function safeUuidList(values) {
    return [...new Set((Array.isArray(values) ? values : []).map(safeUuid).filter(Boolean))];
  }

  function sourceEventId(event) {
    return clean(event?.stableListenId || event?.sourceEventId);
  }

  function sourceIdentity(event = {}) {
    return {
      artistMbids: safeUuidList(event.musicbrainzArtistIds || event.artistMbids),
      recordingMbid: safeUuid(event.musicbrainzRecordingId || event.recordingMbid),
      releaseMbid: safeUuid(event.musicbrainzReleaseId || event.releaseMbid),
      releaseGroupMbid: safeUuid(event.musicbrainzReleaseGroupId || event.releaseGroupMbid),
    };
  }

  function trustedBandArtistMap(bandRecords = []) {
    const map = new Map();
    for (const band of Array.isArray(bandRecords) ? bandRecords : []) {
      const status = clean(band?.musicbrainz?.status);
      const mbid = safeUuid(band?.musicbrainz?.mbid);
      const id = clean(band?.id);
      if (id && mbid && (status === 'manual_confirmed' || status === 'auto_confirmed')) map.set(id, [mbid]);
    }
    return map;
  }

  function addTrustedBandArtistIdentity(events = [], bandRecords = []) {
    const byBandId = trustedBandArtistMap(bandRecords);
    return (events || []).map((event) => {
      if (sourceIdentity(event).artistMbids.length) return event;
      const bandId = clean(event?.bandId || event?.localBandId);
      const artistMbids = byBandId.get(bandId);
      return artistMbids ? { ...event, musicbrainzArtistIds: artistMbids } : event;
    });
  }

  function effectiveIdentity(event, existing = {}) {
    const source = sourceIdentity(event);
    const artistMbids = safeUuidList(existing.artistMbids || existing.musicbrainzArtistIds);
    return {
      artistMbids: artistMbids.length ? artistMbids : source.artistMbids,
      recordingMbid: safeUuid(existing.recordingMbid || existing.musicbrainzRecordingId) || source.recordingMbid,
      releaseMbid: safeUuid(existing.releaseMbid || existing.musicbrainzReleaseId) || source.releaseMbid,
      releaseGroupMbid: safeUuid(existing.releaseGroupMbid || existing.musicbrainzReleaseGroupId) || source.releaseGroupMbid,
    };
  }

  function needsCompletion(identity = {}) {
    return !identity.recordingMbid || Boolean(identity.releaseMbid && !identity.releaseGroupMbid);
  }

  function lookupSignature(event = {}, identity = sourceIdentity(event)) {
    const artistName = clean(event.artistCreditName);
    const recordingName = clean(event.recordingTitle);
    const releaseName = clean(event.releaseTitle);
    if (!identity.recordingMbid && (!artistName || !recordingName)) return null;
    const artistMbids = safeUuidList(identity.artistMbids).sort();
    return {
      key: [
        normalizeText(artistName),
        normalizeText(recordingName),
        normalizeText(releaseName),
        artistMbids.join(',') || 'no-artist-mbid',
        identity.recordingMbid || 'no-recording-mbid',
        identity.releaseMbid || 'no-release-mbid',
      ].join('|'),
      artistName,
      recordingName,
      releaseName,
      artistMbids,
      recordingMbid: safeUuid(identity.recordingMbid),
      releaseMbid: safeUuid(identity.releaseMbid),
      releaseGroupMbid: safeUuid(identity.releaseGroupMbid),
    };
  }

  function buildLookupPlan(events = [], existingIdentities = []) {
    const existingById = new Map((existingIdentities || []).map((record) => [clean(record?.sourceEventId), record]));
    const groups = new Map();
    let alreadyResolved = 0;
    let ineligible = 0;
    for (const event of events || []) {
      const id = sourceEventId(event);
      if (!id) continue;
      const effective = effectiveIdentity(event, existingById.get(id) || {});
      if (!needsCompletion(effective)) { alreadyResolved += 1; continue; }
      const signature = lookupSignature(event, effective);
      if (!signature) { ineligible += 1; continue; }
      const group = groups.get(signature.key) || { ...signature, sourceEventIds: [] };
      group.sourceEventIds.push(id);
      groups.set(signature.key, group);
    }
    const items = [...groups.values()]
      .map((group) => {
        const sourceEventIds = [...new Set(group.sourceEventIds)].sort();
        return { ...group, sourceEventIds, cursorKey: sourceEventIds[0] };
      })
      .sort((a, b) => a.cursorKey.localeCompare(b.cursorKey));
    return { items, alreadyResolved, ineligible };
  }

  function defaultProgressStore() {
    try { return root?.localStorage || null; } catch { return null; }
  }

  function readCursor(progressStore = defaultProgressStore()) {
    if (!progressStore?.getItem) return null;
    try { return clean(progressStore.getItem(CURSOR_STORAGE_KEY)); } catch { return null; }
  }

  function verifyProgressStore(progressStore = defaultProgressStore()) {
    if (!progressStore?.getItem || !progressStore?.setItem || !progressStore?.removeItem) {
      throw new Error('BANDMARKR cannot save listening identity progress on this device, so no provider request was started.');
    }
    try {
      const previous = progressStore.getItem(CURSOR_STORAGE_KEY);
      progressStore.setItem(CURSOR_STORAGE_KEY, previous == null ? '__bandmarkr_probe__' : previous);
      if (previous == null) progressStore.removeItem(CURSOR_STORAGE_KEY);
      else progressStore.setItem(CURSOR_STORAGE_KEY, previous);
      return true;
    } catch {
      throw new Error('BANDMARKR cannot save listening identity progress on this device, so no provider request was started.');
    }
  }

  function writeCursor(cursorKey, progressStore = defaultProgressStore()) {
    try {
      progressStore.setItem(CURSOR_STORAGE_KEY, String(cursorKey));
      return true;
    } catch {
      throw new Error('BANDMARKR could not save listening identity progress, so the provider run stopped safely.');
    }
  }

  function clearCursor(progressStore = defaultProgressStore()) {
    if (!progressStore?.removeItem) return false;
    try {
      progressStore.removeItem(CURSOR_STORAGE_KEY);
      return true;
    } catch {
      return false;
    }
  }

  function selectPlanItems(items = [], cursorKey = null, cap = MAX_SIGNATURES_PER_RUN) {
    const limit = Math.max(1, Math.min(MAX_SIGNATURES_PER_RUN, Number(cap) || MAX_SIGNATURES_PER_RUN));
    if (!items.length) return { selected: [], wrapped: false };
    const cursor = clean(cursorKey);
    let startIndex = 0;
    let wrapped = false;
    if (cursor) {
      const nextIndex = items.findIndex((item) => item.cursorKey > cursor);
      if (nextIndex >= 0) startIndex = nextIndex;
      else wrapped = true;
    }
    return { selected: items.slice(startIndex, startIndex + limit), wrapped };
  }

  function exactLookupResult(request, raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const recordingMbid = safeUuid(raw.recording_mbid || raw.recordingMbid);
    if (!recordingMbid) return null;
    if (normalizeText(raw.artist_credit_name) !== normalizeText(request.artistName)) return null;
    if (normalizeText(raw.recording_name) !== normalizeText(request.recordingName)) return null;
    const returnedArtistMbids = safeUuidList(raw.artist_mbids || raw.artistMbids);
    const trustedArtistMbids = safeUuidList(request.artistMbids);
    if (trustedArtistMbids.length && !returnedArtistMbids.some((id) => trustedArtistMbids.includes(id))) return null;
    return {
      artistMbids: trustedArtistMbids.length ? trustedArtistMbids : returnedArtistMbids,
      recordingMbid,
    };
  }

  function mergeEvidence(existingEvidence, newEvidence) {
    const combined = [...(Array.isArray(existingEvidence) ? existingEvidence : []), ...(Array.isArray(newEvidence) ? newEvidence : [])];
    const seen = new Set();
    return combined.filter((item) => {
      const key = JSON.stringify(item || null);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function buildIdentityRecords(group, resolved, now = new Date().toISOString(), existingById = new Map()) {
    const recordingMbid = safeUuid(resolved?.recordingMbid || group?.recordingMbid);
    if (!group || !recordingMbid) return [];
    const artistMbids = safeUuidList(resolved?.artistMbids?.length ? resolved.artistMbids : group.artistMbids);
    const releaseMbid = safeUuid(group.releaseMbid);
    const releaseGroupMbid = releaseMbid ? safeUuid(resolved?.releaseGroupMbid || group.releaseGroupMbid) : null;
    const newEvidence = [{
      type: releaseGroupMbid
        ? 'trusted_musicbrainz_release_context'
        : (group.recordingMbid ? 'trusted_source_musicbrainz_recording' : 'listenbrainz_musicbrainz_recording_mapping'),
      version: 1,
    }];
    return (group.sourceEventIds || []).map((id) => ({
      sourceEventId: id,
      identityVersion: 1,
      status: 'resolved',
      ...(artistMbids.length ? { artistMbids, artistMbid: artistMbids[0] } : {}),
      recordingMbid,
      ...(releaseMbid ? { releaseMbid } : {}),
      ...(releaseGroupMbid ? { releaseGroupMbid } : {}),
      evidence: mergeEvidence(existingById.get(id)?.evidence, newEvidence),
      updatedAt: now,
    }));
  }

  async function writeIdentityRecords(storage, records) {
    if (!storage?.putIdentities) throw new Error('Derived listening identity storage is unavailable.');
    let written = 0;
    for (let index = 0; index < records.length; index += MAX_WRITE_BATCH) {
      const batch = records.slice(index, index + MAX_WRITE_BATCH);
      await storage.putIdentities(batch);
      written += batch.length;
    }
    return written;
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

  function identityFields(record = {}) {
    const artistMbids = safeUuidList(record.artistMbids || record.musicbrainzArtistIds);
    return {
      musicbrainzArtistIds: artistMbids,
      musicbrainzRecordingId: safeUuid(record.recordingMbid || record.musicbrainzRecordingId),
      musicbrainzReleaseId: safeUuid(record.releaseMbid || record.musicbrainzReleaseId),
      musicbrainzReleaseGroupId: safeUuid(record.releaseGroupMbid || record.musicbrainzReleaseGroupId),
    };
  }

  function mergeIdentityIntoEvent(event, identity) {
    if (!identity) return event;
    const fields = identityFields(identity);
    const output = { ...event };
    if ((!Array.isArray(output.musicbrainzArtistIds) || !output.musicbrainzArtistIds.length) && fields.musicbrainzArtistIds.length) output.musicbrainzArtistIds = fields.musicbrainzArtistIds;
    if (!output.musicbrainzRecordingId && fields.musicbrainzRecordingId) output.musicbrainzRecordingId = fields.musicbrainzRecordingId;
    if (!output.musicbrainzReleaseId && fields.musicbrainzReleaseId) output.musicbrainzReleaseId = fields.musicbrainzReleaseId;
    if (!output.musicbrainzReleaseGroupId && fields.musicbrainzReleaseGroupId) output.musicbrainzReleaseGroupId = fields.musicbrainzReleaseGroupId;
    return output;
  }

  function providerIdentityRecord(record) {
    return Boolean(record?.recordingMbid || record?.releaseMbid || record?.releaseGroupMbid || record?.artistMbid || record?.artistMbids?.length);
  }

  function canonicalFallbackIdentity(event, byId) {
    const siblingIds = Array.isArray(event?.canonicalSourceEventIds)
      ? event.canonicalSourceEventIds.map(clean).filter(Boolean).filter((id) => id !== sourceEventId(event))
      : [];
    const siblingRecords = siblingIds.map((id) => byId.get(id)).filter(providerIdentityRecord);
    const recordingMbids = [...new Set(siblingRecords.map((record) => safeUuid(record?.recordingMbid)).filter(Boolean))];
    if (recordingMbids.length !== 1) return null;
    return { recordingMbid: recordingMbids[0] };
  }

  function identityForRuntimeEvent(event, byId) {
    const own = byId.get(sourceEventId(event));
    if (providerIdentityRecord(own)) return own;
    return canonicalFallbackIdentity(event, byId);
  }

  async function applyDerivedIdentities(storage = root?.BandmarkrListeningDerivedStorage) {
    if (typeof listeningEvents === 'undefined' || !Array.isArray(listeningEvents)) return { applied: 0 };
    const identities = await listAllIdentities(storage);
    const byId = new Map(identities.map((record) => [clean(record.sourceEventId), record]));
    let applied = 0;
    listeningEvents = listeningEvents.map((event) => {
      const identity = identityForRuntimeEvent(event, byId);
      if (!identity) return event;
      applied += 1;
      return mergeIdentityIntoEvent(event, identity);
    });
    return { applied };
  }

  function rerenderListening() {
    if (typeof currentScreen === 'undefined') return;
    if (currentScreen === 'stats' && typeof renderStatsScreen === 'function') renderStatsScreen();
    else if (currentScreen === 'top-bands' && typeof renderTopBandsScreen === 'function') renderTopBandsScreen();
    else if (currentScreen === 'profile' && typeof renderProfileScreen === 'function') renderProfileScreen(activeProfileBandId);
  }

  function installHistoryIdentityHook() {
    const history = root?.LiveVaultSpotifyHistory;
    if (!history?.applyToApp || history.__v104IdentityCompletionWrapped) return;
    const previous = history.applyToApp.bind(history);
    history.applyToApp = async (...args) => {
      const result = await previous(...args);
      await applyDerivedIdentities().catch(() => {});
      rerenderListening();
      return result;
    };
    history.__v104IdentityCompletionWrapped = true;
  }

  function lookupUrl(request) {
    const url = new URL(LOOKUP_URL);
    url.searchParams.set('artist_name', request.artistName);
    url.searchParams.set('recording_name', request.recordingName);
    if (request.releaseName) url.searchParams.set('release_name', request.releaseName);
    return url.toString();
  }

  async function requestLookupOne(request, token, fetchImpl = root?.fetch) {
    const response = await fetchImpl(lookupUrl(request), { headers: { Authorization: `Token ${token}` } });
    if (response.status === 429) throw new Error('ListenBrainz is rate limiting identity lookups. Try again later.');
    if (!response.ok) throw new Error(`ListenBrainz identity lookup returned HTTP ${response.status}.`);
    let payload;
    try { payload = await response.json(); } catch { throw new Error('ListenBrainz returned invalid identity data.'); }
    return exactLookupResult(request, payload);
  }

  function remoteConnection() {
    if (typeof rsGetConnection === 'function') return rsGetConnection();
    return null;
  }

  async function requestReleaseContext(releaseMbid, remote = remoteConnection(), fetchImpl = root?.fetch) {
    const trustedReleaseMbid = safeUuid(releaseMbid);
    if (!trustedReleaseMbid) return null;
    if (!remote?.endpoint || !remote?.token) throw new Error('BANDMARKR data connection is unavailable for MusicBrainz release context.');
    const endpoint = String(remote.endpoint).replace(/\/$/, '');
    const url = new URL(`${endpoint}/${RELEASE_CONTEXT_PATH}`);
    url.searchParams.set('release_mbid', trustedReleaseMbid);
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${remote.token}` } });
    if (response.status === 404) return null;
    if (response.status === 503 || response.status === 429) throw new Error('MusicBrainz is rate limiting release identity lookups. Try again later.');
    if (!response.ok) throw new Error(`MusicBrainz release identity lookup returned HTTP ${response.status}.`);
    let payload;
    try { payload = await response.json(); } catch { throw new Error('MusicBrainz returned invalid release identity data.'); }
    if (safeUuid(payload?.releaseMbid) !== trustedReleaseMbid) throw new Error('MusicBrainz returned invalid release identity data.');
    const releaseGroupMbid = safeUuid(payload?.releaseGroupMbid);
    if (!releaseGroupMbid) throw new Error('MusicBrainz returned invalid release-group identity data.');
    return { releaseMbid: trustedReleaseMbid, releaseGroupMbid };
  }

  function sleep(ms) {
    return new Promise((resolve) => (root?.setTimeout || setTimeout)(resolve, ms));
  }

  async function sourceEvents(options = {}) {
    if (Array.isArray(options.events)) return clone(options.events);
    const history = options.history || root?.LiveVaultSpotifyHistory;
    if (!history?.loadEvents) throw new Error('Private listening history is unavailable.');
    return history.loadEvents(options.bands || (typeof bands === 'undefined' ? [] : bands));
  }

  async function complete({
    cap = MAX_SIGNATURES_PER_RUN,
    fetchImpl = root?.fetch,
    storage = root?.BandmarkrListeningDerivedStorage,
    listenbrainz = root?.LiveVaultListenBrainz,
    events,
    bandRecords = (typeof bands === 'undefined' ? [] : bands),
    progressStore = defaultProgressStore(),
    onProgress = () => {},
  } = {}) {
    const loadedEvents = await sourceEvents({ events, bands: bandRecords });
    const allEvents = addTrustedBandArtistIdentity(loadedEvents, bandRecords);
    const existing = await listAllIdentities(storage);
    const existingById = new Map(existing.map((record) => [clean(record.sourceEventId), record]));
    const plan = buildLookupPlan(allEvents, existing);
    if (!plan.items.length) {
      clearCursor(progressStore);
      return { checked: 0, resolvedRecordings: 0, resolvedReleaseGroups: 0, written: 0, remaining: 0, ...plan };
    }
    verifyProgressStore(progressStore);
    const cursorBefore = readCursor(progressStore);
    const selection = selectPlanItems(plan.items, cursorBefore, cap);
    const selected = selection.selected;

    const connection = listenbrainz?.connection?.();
    if (selected.some((item) => !item.recordingMbid) && !connection?.token) {
      throw new Error('Connect ListenBrainz on this device before completing missing recording identities.');
    }

    let written = 0;
    let resolvedRecordings = 0;
    let resolvedReleaseGroups = 0;
    let unresolvedSelected = 0;
    let lastMusicBrainzRequestAt = 0;
    for (let index = 0; index < selected.length; index += 1) {
      if (index > 0) await sleep(REQUEST_DELAY_MS);
      const item = selected[index];
      let resolved = {
        artistMbids: item.artistMbids,
        recordingMbid: item.recordingMbid,
        releaseGroupMbid: item.releaseGroupMbid,
      };
      let gainedIdentity = false;

      if (!resolved.recordingMbid) {
        const mapping = await requestLookupOne(item, connection.token, fetchImpl);
        if (!mapping) {
          unresolvedSelected += 1;
          writeCursor(item.cursorKey, progressStore);
          onProgress({ checked: index + 1, total: selected.length, resolvedRecordings, resolvedReleaseGroups, written });
          continue;
        }
        resolved = { ...resolved, ...mapping };
        resolvedRecordings += 1;
        gainedIdentity = true;
      }

      if (item.releaseMbid && !resolved.releaseGroupMbid) {
        const elapsed = Date.now() - lastMusicBrainzRequestAt;
        if (lastMusicBrainzRequestAt && elapsed < REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS - elapsed);
        const context = await requestReleaseContext(item.releaseMbid, remoteConnection(), fetchImpl);
        lastMusicBrainzRequestAt = Date.now();
        if (context?.releaseGroupMbid) {
          resolved.releaseGroupMbid = context.releaseGroupMbid;
          resolvedReleaseGroups += 1;
          gainedIdentity = true;
        } else {
          unresolvedSelected += 1;
        }
      }

      if (gainedIdentity) written += await writeIdentityRecords(storage, buildIdentityRecords(item, resolved, new Date().toISOString(), existingById));
      writeCursor(item.cursorKey, progressStore);
      onProgress({ checked: index + 1, total: selected.length, resolvedRecordings, resolvedReleaseGroups, written });
    }

    const activation = root?.BandmarkrListeningCanonicalActivation;
    if (activation?.applyToApp) await activation.applyToApp().catch(() => {});
    await applyDerivedIdentities(storage);
    rerenderListening();
    return {
      checked: selected.length,
      resolvedRecordings,
      resolvedReleaseGroups,
      written,
      remaining: Math.max(0, plan.items.length - selected.length + unresolvedSelected),
      alreadyResolved: plan.alreadyResolved,
      ineligible: plan.ineligible,
      wrapped: selection.wrapped,
      cursorBefore,
      cursorAfter: selected[selected.length - 1]?.cursorKey || cursorBefore,
    };
  }

  function injectSettingsUi() {
    const screen = root?.document?.getElementById('screen-settings');
    if (!screen || screen.querySelector('[data-v104-listening-identity]')) return;
    const anchor = screen.querySelector('[data-canonical-activation]') || screen.querySelector('#listening-review-maintenance');
    if (!anchor) return;
    const wrapper = root.document.createElement('div');
    wrapper.dataset.v104ListeningIdentity = 'true';
    wrapper.className = 'settings-card';
    wrapper.innerHTML = `<p class="section-label" style="margin-top:0">Listening identity</p><p class="settings-hint">Fill missing MusicBrainz recording IDs through your existing ListenBrainz connection and add release-group context only when a listen already has a trusted MusicBrainz release ID. BANDMARKR checks at most ${MAX_SIGNATURES_PER_RUN} unique combinations per run, one at a time. Progress is saved locally so unresolved items do not block later combinations. Missing release editions are never guessed from text, and release groups never combine editions automatically.</p><button type="button" class="btn-secondary" data-v104-complete-identities>Complete listening identities</button><p class="settings-hint" data-v104-identity-status aria-live="polite">Only runs when you press the button. No listening timestamps, event IDs or full-history payload is sent to either provider.</p>`;
    anchor.after(wrapper);
    const button = wrapper.querySelector('[data-v104-complete-identities]');
    const status = wrapper.querySelector('[data-v104-identity-status]');
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = 'Checking unresolved listening identities…';
      try {
        const result = await complete({ onProgress: ({ checked, total, resolvedRecordings, resolvedReleaseGroups }) => {
          status.textContent = `Checking ${checked} of ${total} · ${resolvedRecordings} recording IDs added · ${resolvedReleaseGroups} release groups added`;
        } });
        status.textContent = result.checked
          ? `Done. Checked ${result.checked} identity combinations · ${result.resolvedRecordings} recording IDs added · ${result.resolvedReleaseGroups} release groups added · ${result.written.toLocaleString()} local identity records updated${result.remaining ? ` · ${result.remaining.toLocaleString()} unresolved combinations remain in the catalogue` : ''}.`
          : 'No safely resolvable listening identities need a lookup on this device.';
      } catch (error) {
        status.textContent = error?.message || 'Listening identity completion stopped safely.';
      } finally { button.disabled = false; }
    });
  }

  function install() {
    installHistoryIdentityHook();
    applyDerivedIdentities().then(rerenderListening).catch(() => {});
    injectSettingsUi();
  }

  if (typeof root?.document !== 'undefined') {
    root.document.addEventListener('DOMContentLoaded', install, { once: true });
    const observer = new root.MutationObserver(injectSettingsUi);
    observer.observe(root.document.documentElement, { subtree: true, childList: true });
    root.setTimeout?.(install, 0);
  }

  return {
    LOOKUP_URL,
    RELEASE_CONTEXT_PATH,
    MAX_SIGNATURES_PER_RUN,
    MAX_WRITE_BATCH,
    REQUEST_DELAY_MS,
    CURSOR_STORAGE_KEY,
    safeUuid,
    safeUuidList,
    sourceIdentity,
    trustedBandArtistMap,
    addTrustedBandArtistIdentity,
    effectiveIdentity,
    needsCompletion,
    lookupSignature,
    buildLookupPlan,
    defaultProgressStore,
    readCursor,
    verifyProgressStore,
    writeCursor,
    clearCursor,
    selectPlanItems,
    exactLookupResult,
    mergeEvidence,
    buildIdentityRecords,
    writeIdentityRecords,
    identityFields,
    mergeIdentityIntoEvent,
    providerIdentityRecord,
    canonicalFallbackIdentity,
    identityForRuntimeEvent,
    applyDerivedIdentities,
    installHistoryIdentityHook,
    lookupUrl,
    requestLookupOne,
    remoteConnection,
    requestReleaseContext,
    complete,
    injectSettingsUi,
    install,
  };
});
