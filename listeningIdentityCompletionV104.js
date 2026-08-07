'use strict';

(function attachListeningIdentityCompletionV104(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrListeningIdentityCompletionV104 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const LOOKUP_URL = 'https://api.listenbrainz.org/1/metadata/lookup/';
  const MAX_SIGNATURES_PER_RUN = 25;
  const MAX_WRITE_BATCH = 500;
  const REQUEST_DELAY_MS = 1000;

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

  function identityComplete(identity = {}) {
    return Boolean(identity.recordingMbid && identity.releaseMbid && identity.releaseGroupMbid);
  }

  function lookupSignature(event = {}) {
    const artistName = clean(event.artistCreditName);
    const recordingName = clean(event.recordingTitle);
    const releaseName = clean(event.releaseTitle);
    if (!artistName || !recordingName) return null;
    return {
      key: `${normalizeText(artistName)}|${normalizeText(recordingName)}|${normalizeText(releaseName)}`,
      artistName,
      recordingName,
      releaseName,
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
      const source = sourceIdentity(event);
      const existing = existingById.get(id) || {};
      const effective = {
        recordingMbid: safeUuid(existing.recordingMbid) || source.recordingMbid,
        releaseMbid: safeUuid(existing.releaseMbid) || source.releaseMbid,
        releaseGroupMbid: safeUuid(existing.releaseGroupMbid) || source.releaseGroupMbid,
      };
      if (identityComplete(effective)) { alreadyResolved += 1; continue; }
      const signature = lookupSignature(event);
      if (!signature) { ineligible += 1; continue; }
      const group = groups.get(signature.key) || { ...signature, sourceEventIds: [], sourceIdentities: [] };
      group.sourceEventIds.push(id);
      group.sourceIdentities.push(source);
      groups.set(signature.key, group);
    }
    const items = [...groups.values()]
      .map((group) => ({ ...group, sourceEventIds: [...new Set(group.sourceEventIds)].sort() }))
      .sort((a, b) => a.key.localeCompare(b.key));
    return { items, alreadyResolved, ineligible };
  }

  function exactLookupResult(request, raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const recordingMbid = safeUuid(raw.recording_mbid || raw.recordingMbid);
    if (!recordingMbid) return null;
    if (normalizeText(raw.artist_credit_name) !== normalizeText(request.artistName)) return null;
    if (normalizeText(raw.recording_name) !== normalizeText(request.recordingName)) return null;

    const result = {
      artistMbids: safeUuidList(raw.artist_mbids || raw.artistMbids),
      recordingMbid,
      releaseMbid: null,
      releaseGroupMbid: null,
    };
    if (!request.releaseName || normalizeText(raw.release_name) !== normalizeText(request.releaseName)) return result;

    const returnedReleaseMbid = safeUuid(raw.release_mbid || raw.releaseMbid);
    const metadataRelease = raw.metadata?.release || raw.release || null;
    const metadataReleaseMbid = safeUuid(metadataRelease?.mbid || metadataRelease?.release_mbid);
    const metadataReleaseName = clean(metadataRelease?.name || metadataRelease?.release_name);
    if (!returnedReleaseMbid || returnedReleaseMbid !== metadataReleaseMbid) return result;
    if (normalizeText(metadataReleaseName) !== normalizeText(request.releaseName)) return result;

    result.releaseMbid = returnedReleaseMbid;
    result.releaseGroupMbid = safeUuid(metadataRelease?.release_group_mbid || metadataRelease?.releaseGroupMbid);
    return result;
  }

  function buildIdentityRecords(group, resolved, now = new Date().toISOString()) {
    if (!group || !resolved?.recordingMbid) return [];
    const artistMbids = safeUuidList(resolved.artistMbids);
    const releaseMbid = safeUuid(resolved.releaseMbid);
    const releaseGroupMbid = safeUuid(resolved.releaseGroupMbid);
    return (group.sourceEventIds || []).map((id) => ({
      sourceEventId: id,
      identityVersion: 1,
      status: 'resolved',
      ...(artistMbids.length ? { artistMbids, artistMbid: artistMbids[0] } : {}),
      recordingMbid: safeUuid(resolved.recordingMbid),
      ...(releaseMbid ? { releaseMbid } : {}),
      ...(releaseGroupMbid ? { releaseGroupMbid } : {}),
      evidence: [{ type: releaseMbid ? 'listenbrainz_musicbrainz_recording_release_mapping' : 'listenbrainz_musicbrainz_recording_mapping', version: 1 }],
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

  async function applyDerivedIdentities(storage = root?.BandmarkrListeningDerivedStorage) {
    if (typeof listeningEvents === 'undefined' || !Array.isArray(listeningEvents)) return { applied: 0 };
    const identities = await listAllIdentities(storage);
    const byId = new Map(identities.map((record) => [clean(record.sourceEventId), record]));
    let applied = 0;
    listeningEvents = listeningEvents.map((event) => {
      const ids = [sourceEventId(event), ...(Array.isArray(event?.canonicalSourceEventIds) ? event.canonicalSourceEventIds.map(clean).filter(Boolean) : [])];
      const identity = ids.map((id) => byId.get(id)).find((record) => record?.recordingMbid || record?.releaseMbid || record?.releaseGroupMbid || record?.artistMbid || record?.artistMbids?.length);
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
    url.searchParams.set('metadata', 'true');
    url.searchParams.set('inc', 'release');
    return url.toString();
  }

  async function requestLookupOne(request, token, fetchImpl = root?.fetch) {
    const response = await fetchImpl(lookupUrl(request), { headers: { Authorization: `Token ${token}` } });
    if (response.status === 429) throw new Error('ListenBrainz is rate limiting identity lookups. Try again later.');
    if (!response.ok) throw new Error(`ListenBrainz identity lookup returned HTTP ${response.status}.`);
    return exactLookupResult(request, await response.json());
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

  async function complete({ cap = MAX_SIGNATURES_PER_RUN, fetchImpl = root?.fetch, storage = root?.BandmarkrListeningDerivedStorage, listenbrainz = root?.LiveVaultListenBrainz, events, onProgress = () => {} } = {}) {
    const connection = listenbrainz?.connection?.();
    if (!connection?.token) throw new Error('Connect ListenBrainz on this device before completing listening identities.');
    const allEvents = await sourceEvents({ events });
    const existing = await listAllIdentities(storage);
    const plan = buildLookupPlan(allEvents, existing);
    const selected = plan.items.slice(0, Math.max(1, Math.min(MAX_SIGNATURES_PER_RUN, Number(cap) || MAX_SIGNATURES_PER_RUN)));
    if (!selected.length) return { checked: 0, resolvedSignatures: 0, resolvedReleases: 0, written: 0, remaining: 0, ...plan };

    let written = 0;
    let resolvedSignatures = 0;
    let resolvedReleases = 0;
    for (let index = 0; index < selected.length; index += 1) {
      if (index > 0) await sleep(REQUEST_DELAY_MS);
      const mapping = await requestLookupOne(selected[index], connection.token, fetchImpl);
      if (mapping) {
        written += await writeIdentityRecords(storage, buildIdentityRecords(selected[index], mapping));
        resolvedSignatures += 1;
        if (mapping.releaseMbid) resolvedReleases += 1;
      }
      onProgress({ checked: index + 1, total: selected.length, resolvedSignatures, resolvedReleases, written });
    }
    const activation = root?.BandmarkrListeningCanonicalActivation;
    if (activation?.applyToApp) await activation.applyToApp().catch(() => {});
    await applyDerivedIdentities(storage);
    rerenderListening();
    return { checked: selected.length, resolvedSignatures, resolvedReleases, written, remaining: Math.max(0, plan.items.length - selected.length), alreadyResolved: plan.alreadyResolved, ineligible: plan.ineligible };
  }

  function injectSettingsUi() {
    const screen = root?.document?.getElementById('screen-settings');
    if (!screen || screen.querySelector('[data-v104-listening-identity]')) return;
    const anchor = screen.querySelector('[data-canonical-activation]') || screen.querySelector('#listening-review-maintenance');
    if (!anchor) return;
    const wrapper = root.document.createElement('div');
    wrapper.dataset.v104ListeningIdentity = 'true';
    wrapper.className = 'settings-card';
    wrapper.innerHTML = `<p class="section-label" style="margin-top:0">Listening identity</p><p class="settings-hint">Fill missing MusicBrainz recording, release and release-group IDs through your existing ListenBrainz connection. BANDMARKR checks at most ${MAX_SIGNATURES_PER_RUN} unique artist/track/release combinations per run, one at a time. Release identity is accepted only when the returned release ID and release name agree exactly with the requested release. Release groups never combine editions automatically.</p><button type="button" class="btn-secondary" data-v104-complete-identities>Complete listening identities</button><p class="settings-hint" data-v104-identity-status aria-live="polite">Only runs when you press the button. No listening timestamps, event IDs or full-history payload is sent.</p>`;
    anchor.after(wrapper);
    const button = wrapper.querySelector('[data-v104-complete-identities]');
    const status = wrapper.querySelector('[data-v104-identity-status]');
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = 'Checking unresolved listening identities…';
      try {
        const result = await complete({ onProgress: ({ checked, total, resolvedSignatures, resolvedReleases }) => {
          status.textContent = `Checking ${checked} of ${total} · ${resolvedSignatures} recording mappings · ${resolvedReleases} exact releases`;
        } });
        status.textContent = result.checked
          ? `Done. ${result.resolvedSignatures} of ${result.checked} combinations received exact recording mappings · ${result.resolvedReleases} also received exact release identity · ${result.written.toLocaleString()} local identity records updated${result.remaining ? ` · ${result.remaining.toLocaleString()} combinations remain for another manual run` : ''}.`
          : 'No eligible unresolved listening identities need a lookup on this device.';
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

  return { LOOKUP_URL, MAX_SIGNATURES_PER_RUN, MAX_WRITE_BATCH, REQUEST_DELAY_MS, safeUuid, safeUuidList, sourceIdentity, identityComplete, lookupSignature, buildLookupPlan, exactLookupResult, buildIdentityRecords, writeIdentityRecords, identityFields, mergeIdentityIntoEvent, applyDerivedIdentities, installHistoryIdentityHook, lookupUrl, requestLookupOne, complete, injectSettingsUi, install };
});
