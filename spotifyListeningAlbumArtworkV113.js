'use strict';

(function attachSpotifyListeningAlbumArtworkV113(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SpotifyListeningAlbumArtworkV113 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const safeString = (value) => String(value || '').trim();
  const validSpotifyId = (value) => /^[A-Za-z0-9]{1,64}$/.test(safeString(value));
  const normalizeText = (value) => safeString(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en');

  function currentBands() {
    try { if (typeof bands !== 'undefined' && Array.isArray(bands)) return bands; } catch (_) { /* global lexical may be absent */ }
    return Array.isArray(root.bands) ? root.bands : [];
  }

  function currentEvents() {
    try { if (typeof listeningEvents !== 'undefined' && Array.isArray(listeningEvents)) return listeningEvents; } catch (_) { /* global lexical may be absent */ }
    return Array.isArray(root.listeningEvents) ? root.listeningEvents : [];
  }

  function replaceEvents(next) {
    try {
      if (typeof listeningEvents !== 'undefined') {
        listeningEvents = next;
        return;
      }
    } catch (_) { /* fall through to global property */ }
    root.listeningEvents = next;
  }

  function uniqueBandNameMap(bandList = currentBands()) {
    const owners = new Map();
    for (const band of bandList || []) {
      const id = safeString(band?.id);
      const name = normalizeText(band?.name);
      if (!id || !name) continue;
      const ids = owners.get(name) || new Set();
      ids.add(id);
      owners.set(name, ids);
    }
    const unique = new Map();
    for (const [name, ids] of owners) {
      if (ids.size === 1) unique.set(name, [...ids][0]);
    }
    return unique;
  }

  function knownBandIds(bandList = currentBands()) {
    return new Set((bandList || []).map((band) => safeString(band?.id)).filter(Boolean));
  }

  function localBandId(event, bandMap = uniqueBandNameMap(), bandIds = knownBandIds()) {
    const explicit = safeString(event?.localBandId || event?.bandId);
    if (explicit) return bandIds.has(explicit) ? explicit : null;
    return bandMap.get(normalizeText(event?.artistCreditName)) || null;
  }

  function groupKey(event, bandMap = uniqueBandNameMap(), bandIds = knownBandIds()) {
    const bandId = localBandId(event, bandMap, bandIds);
    const release = normalizeText(event?.releaseTitle);
    if (!bandId || !release) return null;
    return `${bandId}\n${release}`;
  }

  function buildGroups(document, events = currentEvents()) {
    const records = document?.records || {};
    const bandList = currentBands();
    const bandMap = uniqueBandNameMap(bandList);
    const bandIds = knownBandIds(bandList);
    const groups = new Map();
    const trackGroupKeys = new Map();
    for (const event of events || []) {
      const trackId = safeString(event?.spotifyTrackId);
      const key = groupKey(event, bandMap, bandIds);
      if (!key || !validSpotifyId(trackId)) continue;
      const group = groups.get(key) || { key, trackIds: new Set(), events: [], albumIds: new Set(), artworkRecords: [] };
      group.trackIds.add(trackId);
      group.events.push(event);
      const keys = trackGroupKeys.get(trackId) || new Set();
      keys.add(key);
      trackGroupKeys.set(trackId, keys);
      const record = records[trackId];
      const albumId = safeString(record?.spotifyAlbumId);
      if (validSpotifyId(albumId)) group.albumIds.add(albumId);
      if (validSpotifyId(albumId) && safeString(record?.artworkUrl)) group.artworkRecords.push(record);
      groups.set(key, group);
    }
    return [...groups.values()].map((group) => {
      const trackIds = [...group.trackIds].sort();
      const crossGroupTrack = trackIds.some((trackId) => (trackGroupKeys.get(trackId)?.size || 0) > 1);
      const ambiguous = crossGroupTrack || group.albumIds.size > 1;
      const albumId = !ambiguous && group.albumIds.size === 1 ? [...group.albumIds][0] : null;
      return {
        ...group,
        trackIds,
        ambiguous,
        ambiguityReason: crossGroupTrack
          ? 'spotify_track_crosses_album_groups'
          : group.albumIds.size > 1
            ? 'conflicting_known_spotify_album_ids'
            : null,
        albumId,
        artworkRecord: albumId
          ? group.artworkRecords.find((record) => safeString(record.spotifyAlbumId) === albumId) || null
          : null,
      };
    });
  }

  function albumOrientedUnresolvedTrackIds(document, events = currentEvents()) {
    return buildGroups(document, events)
      .filter((group) => !group.ambiguous && !group.artworkRecord)
      .map((group) => {
        if (group.albumId) {
          const withKnownAlbum = group.trackIds.find((trackId) => safeString(document?.records?.[trackId]?.spotifyAlbumId) === group.albumId);
          if (withKnownAlbum) return withKnownAlbum;
        }
        return group.trackIds[0];
      })
      .filter(validSpotifyId)
      .sort();
  }

  function applyAlbumReuse(document, events = currentEvents()) {
    const records = document?.records || {};
    const groups = buildGroups(document, events);
    const reusable = new Map(groups
      .filter((group) => !group.ambiguous && group.albumId && group.artworkRecord)
      .map((group) => [group.key, group]));
    if (!reusable.size) return 0;

    const bandList = currentBands();
    const bandMap = uniqueBandNameMap(bandList);
    const bandIds = knownBandIds(bandList);
    let applied = 0;
    const next = currentEvents().map((event) => {
      const key = groupKey(event, bandMap, bandIds);
      const group = reusable.get(key);
      if (!group) return event;
      const own = records[safeString(event?.spotifyTrackId)] || null;
      const album = group.artworkRecord;
      applied += 1;
      if (own) return event;
      return {
        ...event,
        albumArtworkUrl: album.artworkUrl,
        artworkPath: album.artworkUrl || event.artworkPath || null,
        spotifyAlbumArtworkSource: 'spotify_album_group_reuse',
        spotifyAlbumArtworkSeedTrackId: safeString(album.spotifyTrackId) || null,
        spotifyAlbumArtworkFetchedAt: album.fetchedAt || null,
      };
    });
    replaceEvents(next);
    return applied;
  }

  function rerender() {
    try {
      if (typeof currentScreen === 'undefined') return;
      if (currentScreen === 'stats' && typeof renderStatsScreen === 'function') renderStatsScreen();
      else if (currentScreen === 'top-bands' && typeof renderTopBandsScreen === 'function') renderTopBandsScreen();
      else if (currentScreen === 'profile' && typeof profileTab !== 'undefined' && profileTab === 'listening' && typeof renderProfileScreen === 'function') renderProfileScreen(activeProfileBandId);
    } catch (_) { /* rendering remains owned by the existing app */ }
  }

  function patchMetadata(metadata = root.SpotifyListeningMetadataV99) {
    if (!metadata || metadata.__liveVaultAlbumArtworkV113) return false;
    const originalApply = metadata.applyToEvents?.bind(metadata);
    metadata.unresolvedTrackIds = albumOrientedUnresolvedTrackIds;
    metadata.applyToEvents = function applyToEventsWithAlbumReuse(document) {
      const exact = originalApply ? originalApply(document) : 0;
      const album = applyAlbumReuse(document);
      return Math.max(Number(exact) || 0, album);
    };
    metadata.__liveVaultAlbumArtworkV113 = true;
    return true;
  }

  function install() {
    const metadata = root.SpotifyListeningMetadataV99;
    if (!patchMetadata(metadata)) return;
    if (typeof root.loadDataAndShowApp === 'function' && !root.loadDataAndShowApp.__liveVaultAlbumArtworkV113) {
      const previous = root.loadDataAndShowApp;
      const wrapped = async function loadDataAndShowAppWithAlbumArtwork(...args) {
        const result = await previous.apply(this, args);
        try {
          const local = await metadata.loadLocal?.();
          if (local) metadata.applyToEvents(local);
          rerender();
        } catch (_) { /* exact-track behavior remains available */ }
        return result;
      };
      wrapped.__liveVaultAlbumArtworkV113 = true;
      root.loadDataAndShowApp = wrapped;
    }
  }

  if (root.document) {
    root.document.addEventListener('DOMContentLoaded', () => root.setTimeout?.(install, 0), { once: true });
    root.setTimeout?.(install, 0);
  }

  return {
    normalizeText,
    currentBands,
    currentEvents,
    uniqueBandNameMap,
    knownBandIds,
    localBandId,
    groupKey,
    buildGroups,
    albumOrientedUnresolvedTrackIds,
    applyAlbumReuse,
    patchMetadata,
    install,
  };
});
