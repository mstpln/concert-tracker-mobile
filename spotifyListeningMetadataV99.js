'use strict';

(function attachSpotifyListeningMetadata(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SpotifyListeningMetadataV99 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const DB_NAME = 'bandmarkr-spotify-listening-metadata-v1';
  const STORE_NAME = 'metadata';
  const META_KEY = 'spotify-listening-metadata';
  const REMOTE_PATH = 'listening/spotify-metadata.json';
  const SCHEMA_VERSION = 1;
  const BATCH_SIZE = 50;
  const MAX_TRACKS_PER_RUN = 5000;

  const safeString = (value) => String(value || '').trim();
  const validSpotifyId = (value) => /^[A-Za-z0-9]{1,64}$/.test(safeString(value));
  const validHttpsUrl = (value) => {
    try { return new URL(String(value)).protocol === 'https:'; } catch (_) { return false; }
  };

  function emptyDocument() {
    return { kind: 'livevault-spotify-listening-metadata', schemaVersion: SCHEMA_VERSION, updatedAt: null, records: {} };
  }

  let activeDocument = emptyDocument();

  function normalizeRecord(record) {
    if (!record || !validSpotifyId(record.spotifyTrackId)) return null;
    const spotifyTrackUrl = safeString(record.spotifyTrackUrl);
    const spotifyAlbumId = safeString(record.spotifyAlbumId);
    const spotifyAlbumUrl = safeString(record.spotifyAlbumUrl);
    const artworkUrl = safeString(record.artworkUrl);
    if (!validHttpsUrl(spotifyTrackUrl)) return null;
    if (spotifyAlbumId && !validSpotifyId(spotifyAlbumId)) return null;
    if (spotifyAlbumUrl && !validHttpsUrl(spotifyAlbumUrl)) return null;
    if (artworkUrl && !validHttpsUrl(artworkUrl)) return null;
    return {
      ...record,
      spotifyTrackId: safeString(record.spotifyTrackId),
      spotifyTrackUrl,
      spotifyAlbumId: spotifyAlbumId || null,
      spotifyAlbumUrl: spotifyAlbumUrl || null,
      artworkUrl: artworkUrl || null,
      fetchedAt: Number.isFinite(Date.parse(record.fetchedAt)) ? new Date(record.fetchedAt).toISOString() : new Date().toISOString(),
      source: 'spotify_exact_track_id',
    };
  }

  function normalizeDocument(value) {
    const output = emptyDocument();
    if (!value || value.kind !== output.kind || Number(value.schemaVersion) !== SCHEMA_VERSION || !value.records || typeof value.records !== 'object' || Array.isArray(value.records)) return output;
    for (const [key, raw] of Object.entries(value.records)) {
      const record = normalizeRecord(raw);
      if (record && key === record.spotifyTrackId) output.records[key] = record;
    }
    output.updatedAt = Number.isFinite(Date.parse(value.updatedAt)) ? new Date(value.updatedAt).toISOString() : null;
    return output;
  }

  function mergeRecord(left, right) {
    if (!left) return right;
    if (!right) return left;
    const leftTime = Date.parse(left.fetchedAt) || 0;
    const rightTime = Date.parse(right.fetchedAt) || 0;
    const newer = rightTime >= leftTime ? right : left;
    const older = newer === right ? left : right;
    return normalizeRecord({ ...older, ...newer });
  }

  function mergeDocuments(base, incoming) {
    const left = normalizeDocument(base);
    const right = normalizeDocument(incoming);
    const records = { ...left.records };
    for (const [id, record] of Object.entries(right.records)) records[id] = mergeRecord(records[id], record);
    const leftTime = Date.parse(left.updatedAt) || 0;
    const rightTime = Date.parse(right.updatedAt) || 0;
    return {
      kind: left.kind,
      schemaVersion: SCHEMA_VERSION,
      updatedAt: rightTime >= leftTime ? right.updatedAt : left.updatedAt,
      records,
    };
  }

  function documentsEqual(left, right) {
    const a = normalizeDocument(left);
    const b = normalizeDocument(right);
    const aKeys = Object.keys(a.records).sort();
    const bKeys = Object.keys(b.records).sort();
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key, index) => key === bKeys[index]
      && JSON.stringify(a.records[key]) === JSON.stringify(b.records[key]));
  }

  function setActive(document) {
    activeDocument = normalizeDocument(document);
    return activeDocument;
  }

  function recordForTrack(spotifyTrackId) {
    return activeDocument.records[safeString(spotifyTrackId)] || null;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error('This browser does not support private listening metadata storage.'));
      const request = root.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open listening metadata storage.'));
    });
  }

  async function loadLocal() {
    const db = await openDb();
    const result = await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(META_KEY);
      request.onsuccess = () => resolve(request.result?.value || emptyDocument());
      request.onerror = () => reject(request.error || new Error('Could not read listening metadata.'));
    });
    db.close();
    return normalizeDocument(result);
  }

  async function saveLocal(document) {
    const value = normalizeDocument(document);
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ key: META_KEY, value });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Could not save listening metadata.'));
      tx.onabort = () => reject(tx.error || new Error('Listening metadata save was cancelled.'));
    });
    db.close();
    return setActive(value);
  }

  function remoteConfig() {
    if (typeof remote === 'undefined' || !remote?.endpoint || !remote?.token) return null;
    return { endpoint: String(remote.endpoint).replace(/\/$/, ''), token: remote.token };
  }

  async function readRemote(fetchImpl = fetch) {
    const config = remoteConfig();
    if (!config) return { document: emptyDocument(), etag: null, missing: true };
    const response = await fetchImpl(`${config.endpoint}/${REMOTE_PATH}`, {
      headers: { Authorization: `Bearer ${config.token}` },
      cache: 'no-store',
    });
    if (response.status === 404) return { document: emptyDocument(), etag: null, missing: true };
    if (!response.ok) throw new Error('Could not restore Spotify listening metadata.');
    return { document: normalizeDocument(await response.json()), etag: response.headers.get('etag'), missing: false };
  }

  async function writeRemote(document, etag, missing, fetchImpl = fetch) {
    const config = remoteConfig();
    if (!config) throw new Error('Connect BANDMARKR to its private data store first.');
    const headers = {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      ...(etag ? { 'If-Match': etag } : missing ? { 'If-None-Match': '*' } : {}),
    };
    const response = await fetchImpl(`${config.endpoint}/${REMOTE_PATH}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(normalizeDocument(document)),
    });
    if (response.status === 412 || response.status === 428) throw new Error('Listening metadata changed on another device. Sync again before retrying.');
    if (!response.ok) throw new Error('Could not save Spotify listening metadata.');
    return response.headers.get('etag') || null;
  }

  function applyToEvents(document = activeDocument) {
    if (typeof listeningEvents === 'undefined') return 0;
    const records = setActive(document).records;
    let applied = 0;
    listeningEvents = (listeningEvents || []).map((event) => {
      const record = records[event?.spotifyTrackId];
      if (!record) return event;
      applied += 1;
      return {
        ...event,
        spotifyTrackUrl: record.spotifyTrackUrl,
        spotifyAlbumId: record.spotifyAlbumId,
        spotifyAlbumUrl: record.spotifyAlbumUrl,
        albumArtworkUrl: record.artworkUrl,
        artworkPath: record.artworkUrl || event.artworkPath || null,
        spotifyMetadataSource: record.source,
        spotifyMetadataFetchedAt: record.fetchedAt,
      };
    });
    return applied;
  }

  function rerenderCurrentScreen() {
    if (typeof currentScreen === 'undefined') return;
    if (currentScreen === 'stats' && typeof renderStatsScreen === 'function') renderStatsScreen();
    else if (currentScreen === 'top-bands' && typeof renderTopBandsScreen === 'function') renderTopBandsScreen();
    else if (currentScreen === 'profile' && typeof profileTab !== 'undefined' && profileTab === 'listening' && typeof renderProfileScreen === 'function') renderProfileScreen(activeProfileBandId);
  }

  async function restore() {
    const local = await loadLocal().catch(() => emptyDocument());
    let merged = local;
    try {
      const remoteState = await readRemote();
      merged = mergeDocuments(local, remoteState.document);
      await saveLocal(merged);
    } catch (_) { setActive(local); }
    applyToEvents(merged);
    rerenderCurrentScreen();
    return activeDocument;
  }

  function recordFromSpotifyTrack(track, now = new Date().toISOString()) {
    if (!track || !validSpotifyId(track.id)) return null;
    const album = track.album || {};
    const images = Array.isArray(album.images) ? album.images.filter((image) => validHttpsUrl(image?.url)) : [];
    images.sort((a, b) => Number(b.width || 0) - Number(a.width || 0));
    return normalizeRecord({
      spotifyTrackId: track.id,
      spotifyTrackUrl: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
      spotifyAlbumId: album.id || null,
      spotifyAlbumUrl: album.external_urls?.spotify || (album.id ? `https://open.spotify.com/album/${album.id}` : null),
      artworkUrl: images[0]?.url || null,
      fetchedAt: now,
      source: 'spotify_exact_track_id',
    });
  }

  function unresolvedTrackIds(document, events = typeof listeningEvents === 'undefined' ? [] : listeningEvents) {
    const known = normalizeDocument(document).records;
    return [...new Set((events || []).map((event) => safeString(event?.spotifyTrackId)).filter((id) => validSpotifyId(id) && !known[id]))].sort();
  }

  async function enrich({ cap = MAX_TRACKS_PER_RUN, onProgress = () => {}, fetchImpl = fetch } = {}) {
    if (!root.SpotifyUser?.request) throw new Error('Spotify connection support is unavailable.');
    const remoteState = await readRemote(fetchImpl);
    let document = mergeDocuments(await loadLocal().catch(() => emptyDocument()), remoteState.document);
    setActive(document);
    const ids = unresolvedTrackIds(document).slice(0, Math.max(1, Math.min(MAX_TRACKS_PER_RUN, Number(cap) || MAX_TRACKS_PER_RUN)));
    let added = 0;
    for (let index = 0; index < ids.length; index += BATCH_SIZE) {
      const batch = ids.slice(index, index + BATCH_SIZE);
      const response = await root.SpotifyUser.request(`/tracks?market=SE&ids=${batch.map(encodeURIComponent).join(',')}`, {}, fetchImpl);
      const payload = await response.json();
      if (!Array.isArray(payload?.tracks)) throw new Error('Spotify returned an invalid track metadata response.');
      for (const track of payload.tracks) {
        const record = recordFromSpotifyTrack(track);
        if (!record) continue;
        document.records[record.spotifyTrackId] = mergeRecord(document.records[record.spotifyTrackId], record);
        added += 1;
      }
      document.updatedAt = new Date().toISOString();
      document = await saveLocal(document);
      applyToEvents(document);
      onProgress({ processed: Math.min(ids.length, index + batch.length), total: ids.length, added });
    }
    const remoteChanged = !documentsEqual(document, remoteState.document);
    if (remoteChanged) await writeRemote(document, remoteState.etag, remoteState.missing, fetchImpl);
    applyToEvents(document);
    rerenderCurrentScreen();
    return { requested: ids.length, added, total: Object.keys(document.records).length, synced: remoteChanged };
  }

  function injectSettingsUi() {
    const screen = root.document?.getElementById('screen-settings');
    if (!screen || screen.querySelector('[data-v99-spotify-listening-metadata]')) return;
    const anchor = screen.querySelector('[data-spotify-history-import]') || [...screen.querySelectorAll('.section-label')].find((node) => node.textContent.trim() === 'Data export');
    if (!anchor) return;
    const wrapper = root.document.createElement('div');
    wrapper.dataset.v99SpotifyListeningMetadata = 'true';
    wrapper.innerHTML = `
      <p class="section-label">Listening artwork</p>
      <div class="settings-card">
        <p class="settings-hint" style="margin-top:0">Fetch exact Spotify track, album and artwork metadata for listening records that already contain a trusted Spotify track ID. No title search is used.</p>
        <button type="button" class="btn-primary" data-v99-enrich-listening>Fetch listening artwork</button>
        <p class="settings-hint" data-v99-enrich-status aria-live="polite">Only runs when you press the button. Metadata is cached privately for your BANDMARKR devices.</p>
      </div>`;
    anchor.before(wrapper);
    const button = wrapper.querySelector('[data-v99-enrich-listening]');
    const status = wrapper.querySelector('[data-v99-enrich-status]');
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = 'Checking trusted Spotify track IDs…';
      try {
        const result = await enrich({ onProgress: ({ processed, total, added }) => { status.textContent = `Fetched ${processed.toLocaleString()} of ${total.toLocaleString()} · ${added.toLocaleString()} matched`; } });
        status.textContent = result.requested
          ? `${result.added.toLocaleString()} exact Spotify records added · ${result.total.toLocaleString()} cached`
          : result.synced
            ? `Pending listening artwork metadata synchronized · ${result.total.toLocaleString()} cached`
            : 'Artwork metadata is already complete for the trusted Spotify track IDs on this device.';
      } catch (error) {
        status.textContent = error?.message || 'Spotify listening artwork could not be fetched.';
      } finally { button.disabled = false; }
    });
  }

  function installLoadHook() {
    if (typeof loadDataAndShowApp !== 'function' || loadDataAndShowApp.__liveVaultSpotifyMetadataV99) return;
    const previous = loadDataAndShowApp;
    const wrapped = async function loadDataAndShowAppWithSpotifyMetadata(...args) {
      const result = await previous.apply(this, args);
      await restore().catch(() => {});
      return result;
    };
    wrapped.__liveVaultSpotifyMetadataV99 = true;
    loadDataAndShowApp = wrapped;
  }

  function install() {
    installLoadHook();
    restore().catch(() => {});
    injectSettingsUi();
  }

  if (typeof root.document !== 'undefined') {
    root.document.addEventListener('DOMContentLoaded', install, { once: true });
    const observer = new MutationObserver(injectSettingsUi);
    observer.observe(root.document.documentElement, { childList: true, subtree: true });
    root.setTimeout?.(install, 0);
  }

  return {
    DB_NAME, STORE_NAME, REMOTE_PATH, SCHEMA_VERSION, BATCH_SIZE, MAX_TRACKS_PER_RUN,
    emptyDocument, normalizeRecord, normalizeDocument, mergeDocuments, documentsEqual, recordFromSpotifyTrack,
    unresolvedTrackIds, loadLocal, saveLocal, readRemote, writeRemote, recordForTrack,
    applyToEvents, restore, enrich, installLoadHook,
  };
});
