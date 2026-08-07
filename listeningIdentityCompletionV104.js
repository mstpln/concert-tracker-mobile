'use strict';

(function attachListeningIdentityCompletionV104(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrListeningIdentityCompletionV104 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const LOOKUP_URL = 'https://api.listenbrainz.org/1/metadata/lookup/';
  const RECORDING_METADATA_URL = 'https://api.listenbrainz.org/1/metadata/recording/';
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
    return Boolean(identity.recordingMbid && identity.releaseMbid);
  }

  function lookupSignature(event = {}) {
    const artistName = clean(event.artistCreditName);
    const recordingName = clean(event.recordingTitle);
    const releaseName = clean(event.releaseTitle);
    if (!artistName || !recordingName || !releaseName) return null;
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
    const releaseMbid = safeUuid(raw.release_mbid || raw.releaseMbid);
    if (!recordingMbid || !releaseMbid) return null;
    if (normalizeText(raw.artist_credit_name) !== normalizeText(request.artistName)) return null;
    if (normalizeText(raw.recording_name) !== normalizeText(request.recordingName)) return null;
    if (normalizeText(raw.release_name) !== normalizeText(request.releaseName)) return null;
    return {
      artistMbids: safeUuidList(raw.artist_mbids || raw.artistMbids),
      recordingMbid,
      releaseMbid,
      releaseGroupMbid: safeUuid(raw.release_group_mbid || raw.releaseGroupMbid),
    };
  }

  function normalizeLookupResponse(payload, requests) {
    const rows = Array.isArray(payload) ? payload
      : Array.isArray(payload?.recordings) ? payload.recordings
        : Array.isArray(payload?.results) ? payload.results : [];
    return (requests || []).map((request, index) => exactLookupResult(request, rows[index]));
  }

  function releaseGroupFromRecordingMetadata(payload, recordingMbid, releaseMbid) {
    const record = payload?.[recordingMbid];
    const release = record?.release;
    if (!release || safeUuid(release.mbid || release.release_mbid) !== safeUuid(releaseMbid)) return null;
    return safeUuid(release.release_group_mbid || release.releaseGroupMbid);
  }

  function buildIdentityRecords(group, resolved, now = new Date().toISOString()) {
    if (!group || !resolved?.recordingMbid || !resolved?.releaseMbid) return [];
    return (group.sourceEventIds || []).map((id) => ({
      sourceEventId: id,
      identityVersion: 1,
      status: 'resolved',
      artistMbids: safeUuidList(resolved.artistMbids),
      artistMbid: safeUuidList(resolved.artistMbids)[0] || null,
      recordingMbid: safeUuid(resolved.recordingMbid),
      releaseMbid: safeUuid(resolved.releaseMbid),
      releaseGroupMbid: safeUuid(resolved.releaseGroupMbid),
      evidence: [{ type: 'listenbrainz_musicbrainz_mapping', version: 1 }],
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

  async function requestLookupBatch(requests, token, fetchImpl = root?.fetch) {
    const response = await fetchImpl(LOOKUP_URL, {
      method: 'POST',
      headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordings: requests.map((item) => ({
        artist_name: item.artistName,
        recording_name: item.recordingName,
        release_name: item.releaseName,
      })) }),
    });
    if (response.status === 429) throw new Error('ListenBrainz is rate limiting identity lookups. Try again later.');
    if (!response.ok) throw new Error(`ListenBrainz identity lookup returned HTTP ${response.status}.`);
    return response.json();
  }

  async function requestRecordingMetadata(recordingMbids, token, fetchImpl = root?.fetch) {
    if (!recordingMbids.length) return {};
    const response = await fetchImpl(RECORDING_METADATA_URL, {
      method: 'POST',
      headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recording_mbids: recordingMbids, inc: 'release' }),
    });
    if (response.status === 429) return {};
    if (!response.ok) return {};
    const payload = await response.json();
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  }

  function sleep(ms) { return new Promise((resolve) => root?.setTimeout ? root.setTimeout(resolve, ms) : setTimeout(resolve, ms)); }

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
    onProgress = () => {},
  } = {}) {
    const connection = listenbrainz?.connection?.();
    if (!connection?.token) throw new Error('Connect ListenBrainz on this device before completing listening identities.');
    const allEvents = await sourceEvents({ events });
    const existing = await listAllIdentities(storage);
    const plan = buildLookupPlan(allEvents, existing);
    const selected = plan.items.slice(0, Math.max(1, Math.min(MAX_SIGNATURES_PER_RUN, Number(cap) || MAX_SIGNATURES_PER_RUN)));
    if (!selected.length) return { checked: 0, resolvedSignatures: 0, written: 0, remaining: 0, alreadyResolved: plan.alreadyResolved, ineligible: plan.ineligible };

    const payload = await requestLookupBatch(selected, connection.token, fetchImpl);
    const resolved = normalizeLookupResponse(payload, selected);
    const recordingMbids = [...new Set(resolved.map((item) => item?.recordingMbid).filter(Boolean))];
    let recordingMetadata = {};
    if (recordingMbids.length) {
      await sleep(REQUEST_DELAY_MS);
      recordingMetadata = await requestRecordingMetadata(recordingMbids, connection.token, fetchImpl);
    }

    let written = 0;
    let resolvedSignatures = 0;
    for (let index = 0; index < selected.length; index += 1) {
      const mapping = resolved[index];
      if (!mapping) {
        onProgress({ checked: index + 1, total: selected.length, resolvedSignatures, written });
        continue;
      }
      mapping.releaseGroupMbid = mapping.releaseGroupMbid
        || releaseGroupFromRecordingMetadata(recordingMetadata, mapping.recordingMbid, mapping.releaseMbid);
      const records = buildIdentityRecords(selected[index], mapping);
      written += await writeIdentityRecords(storage, records);
      resolvedSignatures += 1;
      onProgress({ checked: index + 1, total: selected.length, resolvedSignatures, written });
    }

    const remaining = Math.max(0, plan.items.length - selected.length);
    const activation = root?.BandmarkrListeningCanonicalActivation;
    if (activation?.applyToApp) await activation.applyToApp().catch(() => {});
    return { checked: selected.length, resolvedSignatures, written, remaining, alreadyResolved: plan.alreadyResolved, ineligible: plan.ineligible };
  }

  function injectSettingsUi() {
    const screen = root?.document?.getElementById('screen-settings');
    if (!screen || screen.querySelector('[data-v104-listening-identity]')) return;
    const anchor = screen.querySelector('[data-canonical-activation]') || screen.querySelector('#listening-review-maintenance');
    if (!anchor) return;
    const wrapper = root.document.createElement('div');
    wrapper.dataset.v104ListeningIdentity = 'true';
    wrapper.className = 'settings-card';
    wrapper.innerHTML = `<p class="section-label" style="margin-top:0">Listening identity</p><p class="settings-hint">Fill missing MusicBrainz recording and release IDs through your existing ListenBrainz connection. BANDMARKR checks at most ${MAX_SIGNATURES_PER_RUN} unique track/release combinations per run. It sends artist, track and release names only — never listening timestamps or the full history.</p><button type="button" class="btn-secondary" data-v104-complete-identities>Complete listening identities</button><p class="settings-hint" data-v104-identity-status aria-live="polite">Only runs when you press the button.</p>`;
    anchor.after(wrapper);
    const button = wrapper.querySelector('[data-v104-complete-identities]');
    const status = wrapper.querySelector('[data-v104-identity-status]');
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = 'Checking unresolved listening identities…';
      try {
        const result = await complete({ onProgress: ({ checked, total, resolvedSignatures }) => {
          status.textContent = `Checking ${checked} of ${total} · ${resolvedSignatures} exact mappings found`;
        } });
        status.textContent = result.checked
          ? `Done. ${result.resolvedSignatures} of ${result.checked} checked track/release combinations received exact MusicBrainz mappings · ${result.written.toLocaleString()} local listen identity records updated${result.remaining ? ` · ${result.remaining.toLocaleString()} combinations remain for another manual run` : ''}.`
          : 'No eligible unresolved track/release combinations need a MusicBrainz lookup on this device.';
      } catch (error) {
        status.textContent = error?.message || 'Listening identity completion stopped safely.';
      } finally { button.disabled = false; }
    });
  }

  function install() {
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
    RECORDING_METADATA_URL,
    MAX_SIGNATURES_PER_RUN,
    MAX_WRITE_BATCH,
    REQUEST_DELAY_MS,
    safeUuid,
    safeUuidList,
    sourceIdentity,
    lookupSignature,
    buildLookupPlan,
    exactLookupResult,
    normalizeLookupResponse,
    releaseGroupFromRecordingMetadata,
    buildIdentityRecords,
    writeIdentityRecords,
    requestLookupBatch,
    requestRecordingMetadata,
    complete,
    injectSettingsUi,
    install,
  };
});
