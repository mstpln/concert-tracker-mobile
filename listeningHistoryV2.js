'use strict';

(function attachListeningHistoryV2(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LiveVaultListeningHistoryV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const DB_NAME = 'livevault-listening-history-v1';
  const STORE_NAME = 'listens';
  const META_STORE = 'meta';
  const META_KEY = 'spotify-import';
  const OPTIONAL_ID_KEYS = [
    'musicbrainzRecordingId', 'musicbrainzArtistIds', 'musicbrainzReleaseId', 'musicbrainzReleaseGroupId',
    'listenbrainzRecordingMsid', 'listenbrainzUrlRels', 'listenbrainzCaaId', 'listenbrainzCaaReleaseMbid',
  ];

  function normalizeText(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('en');
  }

  function safeUuid(value) {
    const text = String(value || '').trim().toLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text) ? text : null;
  }

  function safeHttpsUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value.trim());
      return url.protocol === 'https:' ? url.toString() : null;
    } catch (_) { return null; }
  }

  function exactArtworkReleaseMbid(event) {
    const ids = [...new Set([event?.musicbrainzReleaseId, event?.listenbrainzCaaReleaseMbid].map(safeUuid).filter(Boolean))];
    return ids.length === 1 ? ids[0] : null;
  }

  function providerNeutralArtworkUrl(event) {
    const releaseMbid = exactArtworkReleaseMbid(event);
    return releaseMbid ? `https://coverartarchive.org/release/${releaseMbid}/front-500` : null;
  }

  function sanitizeEvent(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const source = raw.source === 'listenbrainz' ? 'listenbrainz' : 'spotify_import';
    const timestamp = Date.parse(String(raw.listenedAt || ''));
    const artist = String(raw.artistCreditName || '').trim();
    const track = String(raw.recordingTitle || '').trim();
    const stableListenId = String(raw.stableListenId || '').trim();
    if (!Number.isFinite(timestamp) || !artist || !track || !stableListenId) return null;

    const durationValue = Number(raw.listenedDurationMs);
    const duration = Number.isFinite(durationValue) && durationValue > 0 ? Math.round(durationValue) : null;
    const spotifyTrackId = String(raw.spotifyTrackId || '').trim() || null;
    if (source === 'spotify_import' && (!spotifyTrackId || !duration || duration < 30000)) return null;

    const event = {
      stableListenId,
      listenedAt: new Date(timestamp).toISOString(),
      listenedDurationMs: duration,
      artistCreditName: artist,
      recordingTitle: track,
      releaseTitle: raw.releaseTitle == null ? null : String(raw.releaseTitle).trim() || null,
      spotifyTrackId,
      source,
    };
    event.musicbrainzRecordingId = safeUuid(raw.musicbrainzRecordingId);
    event.musicbrainzReleaseId = safeUuid(raw.musicbrainzReleaseId);
    event.musicbrainzReleaseGroupId = safeUuid(raw.musicbrainzReleaseGroupId);
    event.listenbrainzRecordingMsid = safeUuid(raw.listenbrainzRecordingMsid);
    event.listenbrainzCaaReleaseMbid = safeUuid(raw.listenbrainzCaaReleaseMbid);
    event.listenbrainzCaaId = raw.listenbrainzCaaId == null ? null : (/^[A-Za-z0-9_-]{1,128}$/.test(String(raw.listenbrainzCaaId).trim()) ? String(raw.listenbrainzCaaId).trim() : null);
    event.listenbrainzUrlRels = [...new Set((Array.isArray(raw.listenbrainzUrlRels) ? raw.listenbrainzUrlRels : []).map(safeHttpsUrl).filter(Boolean))].slice(0, 32);
    event.musicbrainzArtistIds = [...new Set((Array.isArray(raw.musicbrainzArtistIds) ? raw.musicbrainzArtistIds : []).map(safeUuid).filter(Boolean))];
    const artworkUrl = providerNeutralArtworkUrl(event);
    if (artworkUrl) {
      // Derived local presentation evidence only. The immutable provider
      // observation remains unchanged in R2, and CAA data never enters the
      // Spotify-owned metadata document.
      event.albumArtworkUrl = artworkUrl;
      event.artworkPath = artworkUrl;
      event.albumArtworkSource = 'cover-art-archive-exact-release';
    }
    return event;
  }

  function fingerprint(event) {
    const timestamp = Date.parse(event?.listenedAt || '');
    if (!Number.isFinite(timestamp)) return null;
    return `${Math.floor(timestamp / 1000)}|${normalizeText(event.artistCreditName)}|${normalizeText(event.recordingTitle)}`;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = root.indexedDB.open(DB_NAME, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open private listening storage.'));
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Private listening storage failed.'));
    });
  }

  function summary(events, previous = {}) {
    const ordered = [...events].sort((a, b) => a.listenedAt.localeCompare(b.listenedAt) || a.stableListenId.localeCompare(b.stableListenId));
    return {
      key: META_KEY,
      importedAt: previous.importedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      eventCount: ordered.length,
      firstListenedAt: ordered[0]?.listenedAt || null,
      lastListenedAt: ordered.at(-1)?.listenedAt || null,
      sourceSha256: previous.sourceSha256 || null,
    };
  }

  async function replaceEvents(events, options = {}) {
    const sanitized = (events || []).map(sanitizeEvent).filter(Boolean);
    const byId = new Map(sanitized.map((event) => [event.stableListenId, event]));
    const ordered = [...byId.values()].sort((a, b) => a.listenedAt.localeCompare(b.listenedAt) || a.stableListenId.localeCompare(b.stableListenId));
    const db = await openDb();
    const previous = await requestResult(db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get(META_KEY)).catch(() => null);
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      for (const event of ordered) tx.objectStore(STORE_NAME).put(event);
      tx.objectStore(META_STORE).put({ ...summary(ordered, previous || {}), sourceSha256: options.sourceSha256 || previous?.sourceSha256 || null });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Could not replace listening history.'));
      tx.onabort = () => reject(tx.error || new Error('Listening-history replacement was cancelled.'));
    });
    db.close();
    return { eventCount: ordered.length };
  }

  async function mergeEvents(events) {
    const incoming = (events || []).map(sanitizeEvent).filter(Boolean);
    const db = await openDb();
    const readTx = db.transaction([STORE_NAME, META_STORE], 'readonly');
    const eventsRequest = readTx.objectStore(STORE_NAME).getAll();
    const metaRequest = readTx.objectStore(META_STORE).get(META_KEY);
    const existing = await requestResult(eventsRequest);
    const previous = await requestResult(metaRequest);
    const byId = new Map(existing.map((event) => [event.stableListenId, event]));
    const fingerprints = new Set(existing.map(fingerprint).filter(Boolean));
    let added = 0;
    let skipped = 0;
    for (const event of incoming) {
      const mark = fingerprint(event);
      if (byId.has(event.stableListenId) || (mark && fingerprints.has(mark))) { skipped += 1; continue; }
      byId.set(event.stableListenId, event);
      if (mark) fingerprints.add(mark);
      added += 1;
    }
    const ordered = [...byId.values()].sort((a, b) => a.listenedAt.localeCompare(b.listenedAt) || a.stableListenId.localeCompare(b.stableListenId));
    if (added) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
        for (const event of incoming) {
          if (byId.get(event.stableListenId) === event) tx.objectStore(STORE_NAME).put(event);
        }
        tx.objectStore(META_STORE).put(summary(ordered, previous || {}));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not merge listening history.'));
      });
    }
    db.close();
    return { added, skipped, eventCount: ordered.length };
  }

  function install() {
    const history = root?.LiveVaultSpotifyHistory;
    if (!history) return false;
    history.sanitizeEvent = sanitizeEvent;
    history.replaceEvents = replaceEvents;
    history.mergeEvents = mergeEvents;
    history.OPTIONAL_ID_KEYS = OPTIONAL_ID_KEYS;
    return true;
  }

  return { OPTIONAL_ID_KEYS, sanitizeEvent, fingerprint, exactArtworkReleaseMbid, providerNeutralArtworkUrl, replaceEvents, mergeEvents, install };
});

if (typeof window !== 'undefined') window.LiveVaultListeningHistoryV2.install();
