'use strict';

const crypto = require('node:crypto');

const VALID_SPOTIFY_ID = /^[A-Za-z0-9]{1,64}$/;

function safeString(value) {
  return String(value || '').trim();
}

function validSpotifyId(value) {
  return VALID_SPOTIFY_ID.test(safeString(value));
}

function normalizeText(value) {
  return safeString(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en');
}

function bandNames(band) {
  const aliases = Array.isArray(band?.listeningAliases)
    ? band.listeningAliases.filter((value) => typeof value === 'string')
    : [];
  return [band?.name, ...aliases]
    .map(normalizeText)
    .filter(Boolean);
}

function listenTime(value) {
  const text = safeString(value);
  if (!text) return 0;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function albumGroupKey(localBandId, releaseTitle) {
  const bandId = safeString(localBandId);
  const release = normalizeText(releaseTitle);
  if (!bandId || !release) return null;
  const digest = crypto.createHash('sha256').update(`${bandId}\n${release}`, 'utf8').digest('hex');
  return `album:${digest}`;
}

function bandOwnershipIndex(bands = []) {
  const byId = new Set();
  const owners = new Map();
  for (const band of bands || []) {
    const id = safeString(band?.id);
    if (!id) continue;
    byId.add(id);
    for (const name of bandNames(band)) {
      const set = owners.get(name) || new Set();
      set.add(id);
      owners.set(name, set);
    }
  }
  const byUniqueName = new Map();
  for (const [name, ids] of owners) {
    if (ids.size === 1) byUniqueName.set(name, [...ids][0]);
  }
  return { byId, byUniqueName };
}

function uniqueBandNameMap(bands = []) {
  return bandOwnershipIndex(bands).byUniqueName;
}

function mappedBandId(event, bandIndex) {
  const explicit = safeString(event?.localBandId || event?.bandId);
  if (explicit) return bandIndex.byId.has(explicit) ? explicit : null;
  return bandIndex.byUniqueName.get(normalizeText(event?.artistCreditName)) || null;
}

function normalizeMetadataRecord(key, record) {
  const id = safeString(key);
  if (!validSpotifyId(id) || !record || typeof record !== 'object' || Array.isArray(record)) return null;
  if (safeString(record.spotifyTrackId) !== id) return null;
  const albumId = safeString(record.spotifyAlbumId);
  const albumUrl = safeString(record.spotifyAlbumUrl);
  const artworkUrl = safeString(record.artworkUrl);
  if (albumId && !validSpotifyId(albumId)) return null;
  if (albumId && albumUrl !== `https://open.spotify.com/album/${albumId}`) return null;
  if (!albumId && albumUrl) return null;
  if (artworkUrl) {
    try { if (new URL(artworkUrl).protocol !== 'https:') return null; }
    catch (_) { return null; }
  }
  return {
    ...record,
    spotifyTrackId: id,
    spotifyTrackUrl: `https://open.spotify.com/track/${id}`,
    spotifyAlbumId: albumId || null,
    spotifyAlbumUrl: albumId ? `https://open.spotify.com/album/${albumId}` : null,
    artworkUrl: artworkUrl || null,
  };
}

function metadataRecords(metadata = {}) {
  const result = new Map();
  for (const [id, record] of Object.entries(metadata?.records || {})) {
    const normalized = normalizeMetadataRecord(id, record);
    if (normalized) result.set(id, normalized);
  }
  return result;
}

function terminalSuppression(metadata, group) {
  const item = metadata?.albumArtworkSuppressions?.[group?.key];
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  if (safeString(item.albumGroupKey) !== group.key) return null;
  if (safeString(item.representativeTrackId) !== group.representativeTrackId) return null;
  if (!['exact_track_not_found', 'exact_track_has_no_usable_artwork'].includes(item.reason)) return null;
  return item;
}

function mergeTerminalSuppression(metadata = {}, group, reason, suppressedAt) {
  if (!group?.key || !validSpotifyId(group?.representativeTrackId)) return null;
  if (!['exact_track_not_found', 'exact_track_has_no_usable_artwork'].includes(reason)) return null;
  const timestamp = safeString(suppressedAt);
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return null;
  return {
    ...(metadata || {}),
    kind: metadata?.kind || 'livevault-spotify-listening-metadata',
    schemaVersion: Number(metadata?.schemaVersion) || 1,
    records: { ...(metadata?.records || {}) },
    albumArtworkSuppressions: {
      ...(metadata?.albumArtworkSuppressions || {}),
      [group.key]: {
        ...(metadata?.albumArtworkSuppressions?.[group.key] || {}),
        albumGroupKey: group.key,
        representativeTrackId: group.representativeTrackId,
        reason,
        suppressedAt: new Date(Date.parse(timestamp)).toISOString(),
      },
    },
  };
}

function buildAlbumGroups({ events = [], bands = [], metadata = {} } = {}) {
  const bandIndex = bandOwnershipIndex(bands);
  const known = metadataRecords(metadata);
  const groups = new Map();
  const trackGroupKeys = new Map();
  let unsafeEvents = 0;

  for (const event of events || []) {
    const localBandId = mappedBandId(event, bandIndex);
    const releaseTitle = safeString(event?.releaseTitle);
    const spotifyTrackId = safeString(event?.spotifyTrackId);
    const key = albumGroupKey(localBandId, releaseTitle);
    if (!key || !validSpotifyId(spotifyTrackId)) {
      unsafeEvents += 1;
      continue;
    }
    const group = groups.get(key) || {
      key,
      localBandId,
      normalizedReleaseTitle: normalizeText(releaseTitle),
      trackIds: new Set(),
      knownAlbumIds: new Set(),
      knownArtwork: [],
      listenCount: 0,
      latestListenedAt: null,
      latestListenTime: 0,
    };
    group.listenCount += 1;
    const eventListenTime = listenTime(event?.listenedAt);
    if (eventListenTime > group.latestListenTime) {
      group.latestListenTime = eventListenTime;
      group.latestListenedAt = safeString(event?.listenedAt) || null;
    }
    group.trackIds.add(spotifyTrackId);
    const groupKeys = trackGroupKeys.get(spotifyTrackId) || new Set();
    groupKeys.add(key);
    trackGroupKeys.set(spotifyTrackId, groupKeys);
    const existing = known.get(spotifyTrackId);
    if (existing?.spotifyAlbumId) group.knownAlbumIds.add(existing.spotifyAlbumId);
    if (existing?.spotifyAlbumId && existing?.artworkUrl) group.knownArtwork.push(existing);
    groups.set(key, group);
  }

  const safe = [];
  const ambiguous = [];
  for (const group of groups.values()) {
    const trackIds = [...group.trackIds].sort();
    if (trackIds.some((trackId) => (trackGroupKeys.get(trackId)?.size || 0) > 1)) {
      ambiguous.push({ key: group.key, trackCount: trackIds.length, reason: 'spotify_track_crosses_album_groups' });
      continue;
    }
    if (group.knownAlbumIds.size > 1) {
      ambiguous.push({ key: group.key, trackCount: trackIds.length, reason: 'conflicting_known_spotify_album_ids' });
      continue;
    }
    const knownAlbumId = [...group.knownAlbumIds][0] || null;
    const knownRecord = knownAlbumId
      ? group.knownArtwork.find((record) => record.spotifyAlbumId === knownAlbumId) || null
      : null;
    const representativeTrackId = knownAlbumId
      ? trackIds.find((trackId) => known.get(trackId)?.spotifyAlbumId === knownAlbumId) || trackIds[0]
      : trackIds[0];
    safe.push({
      key: group.key,
      localBandId: group.localBandId,
      normalizedReleaseTitle: group.normalizedReleaseTitle,
      trackIds,
      representativeTrackId,
      knownAlbumId,
      knownRecord,
      listenCount: group.listenCount,
      latestListenedAt: group.latestListenedAt,
      latestListenTime: group.latestListenTime,
    });
  }

  safe.sort((a, b) => b.latestListenTime - a.latestListenTime
    || b.listenCount - a.listenCount
    || b.trackIds.length - a.trackIds.length
    || a.key.localeCompare(b.key));
  ambiguous.sort((a, b) => b.trackCount - a.trackCount || a.key.localeCompare(b.key));
  return { groups: safe, ambiguous, unsafeEvents };
}

function reusableAlbumRecord(group) {
  const record = group?.knownRecord;
  if (!record?.spotifyAlbumId || !record?.artworkUrl) return null;
  return record;
}

function exactRepresentativeRecord({ metadata = {}, group, record } = {}) {
  if (!group?.key || !validSpotifyId(group?.representativeTrackId)) return null;
  const normalized = normalizeMetadataRecord(group.representativeTrackId, record);
  if (!normalized?.spotifyAlbumId || !normalized?.artworkUrl) return null;
  if (group.knownAlbumId && group.knownAlbumId !== normalized.spotifyAlbumId) return null;
  return {
    ...(metadata?.records?.[group.representativeTrackId] || {}),
    ...normalized,
    albumGroupKey: group.key,
  };
}

function mergeRepresentativeRecord(metadata = {}, group, record) {
  const exact = exactRepresentativeRecord({ metadata, group, record });
  if (!exact) return null;
  const suppressions = { ...(metadata?.albumArtworkSuppressions || {}) };
  delete suppressions[group.key];
  return {
    ...(metadata || {}),
    kind: metadata?.kind || 'livevault-spotify-listening-metadata',
    schemaVersion: Number(metadata?.schemaVersion) || 1,
    records: {
      ...(metadata?.records || {}),
      [group.representativeTrackId]: exact,
    },
    albumArtworkSuppressions: suppressions,
  };
}

function planAlbumArtwork({ events = [], bands = [], metadata = {} } = {}) {
  const built = buildAlbumGroups({ events, bands, metadata });
  const reusable = [];
  const suppressed = [];
  const provider = [];
  for (const group of built.groups) {
    const record = reusableAlbumRecord(group);
    if (record) reusable.push({ group, albumRecord: record });
    else {
      const suppression = terminalSuppression(metadata, group);
      if (suppression) suppressed.push({ group, suppression });
      else provider.push(group);
    }
  }
  return {
    reusable,
    suppressed,
    provider,
    ambiguous: built.ambiguous,
    unsafeEvents: built.unsafeEvents,
    summary: {
      safeAlbumGroups: built.groups.length,
      reusableAlbumGroups: reusable.length,
      suppressedAlbumGroups: suppressed.length,
      providerAlbumGroups: provider.length,
      ambiguousAlbumGroups: built.ambiguous.length,
      unsafeEvents: built.unsafeEvents,
      uniqueTracksInSafeGroups: built.groups.reduce((sum, group) => sum + group.trackIds.length, 0),
    },
  };
}

module.exports = {
  validSpotifyId,
  normalizeText,
  bandNames,
  listenTime,
  albumGroupKey,
  bandOwnershipIndex,
  uniqueBandNameMap,
  mappedBandId,
  normalizeMetadataRecord,
  terminalSuppression,
  mergeTerminalSuppression,
  buildAlbumGroups,
  reusableAlbumRecord,
  exactRepresentativeRecord,
  mergeRepresentativeRecord,
  planAlbumArtwork,
};
