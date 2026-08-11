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

function albumGroupKey(localBandId, releaseTitle) {
  const bandId = safeString(localBandId);
  const release = normalizeText(releaseTitle);
  if (!bandId || !release) return null;
  const digest = crypto.createHash('sha256').update(`${bandId}\n${release}`, 'utf8').digest('hex');
  return `album:${digest}`;
}

function uniqueBandNameMap(bands = []) {
  const owners = new Map();
  for (const band of bands || []) {
    const id = safeString(band?.id);
    const name = normalizeText(band?.name);
    if (!id || !name) continue;
    const set = owners.get(name) || new Set();
    set.add(id);
    owners.set(name, set);
  }
  const unique = new Map();
  for (const [name, ids] of owners) {
    if (ids.size === 1) unique.set(name, [...ids][0]);
  }
  return unique;
}

function mappedBandId(event, uniqueBands) {
  const explicit = safeString(event?.localBandId || event?.bandId);
  if (explicit) return explicit;
  return uniqueBands.get(normalizeText(event?.artistCreditName)) || null;
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

function buildAlbumGroups({ events = [], bands = [], metadata = {} } = {}) {
  const uniqueBands = uniqueBandNameMap(bands);
  const known = metadataRecords(metadata);
  const groups = new Map();
  let unsafeEvents = 0;

  for (const event of events || []) {
    const localBandId = mappedBandId(event, uniqueBands);
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
    };
    group.trackIds.add(spotifyTrackId);
    const existing = known.get(spotifyTrackId);
    if (existing?.spotifyAlbumId) group.knownAlbumIds.add(existing.spotifyAlbumId);
    if (existing?.spotifyAlbumId && existing?.artworkUrl) group.knownArtwork.push(existing);
    groups.set(key, group);
  }

  const safe = [];
  const ambiguous = [];
  for (const group of groups.values()) {
    const trackIds = [...group.trackIds].sort();
    if (group.knownAlbumIds.size > 1) {
      ambiguous.push({ key: group.key, trackCount: trackIds.length, reason: 'conflicting_known_spotify_album_ids' });
      continue;
    }
    const knownAlbumId = [...group.knownAlbumIds][0] || null;
    const knownRecord = knownAlbumId
      ? group.knownArtwork.find((record) => record.spotifyAlbumId === knownAlbumId) || null
      : null;
    safe.push({
      key: group.key,
      localBandId: group.localBandId,
      normalizedReleaseTitle: group.normalizedReleaseTitle,
      trackIds,
      representativeTrackId: trackIds[0],
      knownAlbumId,
      knownRecord,
    });
  }

  safe.sort((a, b) => b.trackIds.length - a.trackIds.length || a.key.localeCompare(b.key));
  ambiguous.sort((a, b) => b.trackCount - a.trackCount || a.key.localeCompare(b.key));
  return { groups: safe, ambiguous, unsafeEvents };
}

function reusableAlbumRecord(group) {
  const record = group?.knownRecord;
  if (!record?.spotifyAlbumId || !record?.artworkUrl) return null;
  return record;
}

function materializeGroupRecords({ metadata = {}, group, albumRecord, fetchedAt = null } = {}) {
  const output = {
    ...(metadata || {}),
    kind: metadata?.kind || 'livevault-spotify-listening-metadata',
    schemaVersion: Number(metadata?.schemaVersion) || 1,
    records: { ...(metadata?.records || {}) },
  };
  if (!group || !Array.isArray(group.trackIds) || !albumRecord?.spotifyAlbumId || !albumRecord?.artworkUrl) return output;
  const albumId = safeString(albumRecord.spotifyAlbumId);
  if (!validSpotifyId(albumId)) return output;
  const albumUrl = `https://open.spotify.com/album/${albumId}`;
  const stamp = Number.isFinite(Date.parse(fetchedAt || albumRecord.fetchedAt))
    ? new Date(fetchedAt || albumRecord.fetchedAt).toISOString()
    : new Date().toISOString();

  for (const trackId of group.trackIds) {
    if (!validSpotifyId(trackId)) continue;
    const existing = normalizeMetadataRecord(trackId, output.records[trackId]);
    if (existing?.spotifyAlbumId && existing.spotifyAlbumId !== albumId) continue;
    output.records[trackId] = {
      ...(output.records[trackId] || {}),
      spotifyTrackId: trackId,
      spotifyTrackUrl: `https://open.spotify.com/track/${trackId}`,
      spotifyAlbumId: albumId,
      spotifyAlbumUrl: albumUrl,
      artworkUrl: safeString(albumRecord.artworkUrl) || null,
      fetchedAt: existing?.fetchedAt || stamp,
      source: existing?.source || 'spotify_album_group_reuse',
      albumGroupKey: group.key,
      albumArtworkSeedTrackId: safeString(albumRecord.spotifyTrackId) || group.representativeTrackId,
    };
  }
  return output;
}

function planAlbumArtwork({ events = [], bands = [], metadata = {} } = {}) {
  const built = buildAlbumGroups({ events, bands, metadata });
  const reusable = [];
  const provider = [];
  for (const group of built.groups) {
    const record = reusableAlbumRecord(group);
    if (record) reusable.push({ group, albumRecord: record });
    else provider.push(group);
  }
  return {
    reusable,
    provider,
    ambiguous: built.ambiguous,
    unsafeEvents: built.unsafeEvents,
    summary: {
      safeAlbumGroups: built.groups.length,
      reusableAlbumGroups: reusable.length,
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
  albumGroupKey,
  uniqueBandNameMap,
  mappedBandId,
  normalizeMetadataRecord,
  buildAlbumGroups,
  reusableAlbumRecord,
  materializeGroupRecords,
  planAlbumArtwork,
};
