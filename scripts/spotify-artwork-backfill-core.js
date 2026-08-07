'use strict';

const MAX_IDS_PER_INVOCATION = 100;
const DEFAULT_IDS_PER_INVOCATION = 25;
const VALID_SPOTIFY_ID = /^[A-Za-z0-9]{1,64}$/;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function validSpotifyId(value) {
  return VALID_SPOTIFY_ID.test(String(value || '').trim());
}

function validHttpsUrl(value) {
  if (value == null) return true;
  if (typeof value !== 'string' || !value) return false;
  try { return new URL(value).protocol === 'https:'; }
  catch (_) { return false; }
}

function validSpotifyUrl(value, kind, id) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'open.spotify.com' && url.pathname === `/${kind}/${id}`;
  } catch (_) {
    return false;
  }
}

function trustedTrackIds(events) {
  return [...new Set((events || [])
    .map((event) => String(event?.spotifyTrackId || '').trim())
    .filter(validSpotifyId))]
    .sort();
}

function existingRecordIds(metadata) {
  return new Set(Object.entries(metadata?.records || {})
    .filter(([key, record]) => validSpotifyId(key) && record?.spotifyTrackId === key)
    .map(([key]) => key));
}

function normalizeStagedRecord(key, value) {
  const id = String(key || '').trim();
  if (!validSpotifyId(id) || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.spotifyTrackId !== id || !validSpotifyUrl(value.spotifyTrackUrl, 'track', id)) return null;

  const albumId = value.spotifyAlbumId == null ? null : String(value.spotifyAlbumId).trim();
  if (albumId != null && !validSpotifyId(albumId)) return null;
  if (albumId == null ? value.spotifyAlbumUrl != null : !validSpotifyUrl(value.spotifyAlbumUrl, 'album', albumId)) return null;
  if (!validHttpsUrl(value.artworkUrl)) return null;
  if (typeof value.fetchedAt !== 'string' || !Number.isFinite(Date.parse(value.fetchedAt))) return null;
  if (value.source !== 'spotify_exact_track_id') return null;

  const normalized = {
    spotifyTrackId: id,
    spotifyTrackUrl: `https://open.spotify.com/track/${id}`,
    spotifyAlbumId: albumId,
    spotifyAlbumUrl: albumId ? `https://open.spotify.com/album/${albumId}` : null,
    artworkUrl: value.artworkUrl == null ? null : String(value.artworkUrl),
    fetchedAt: new Date(value.fetchedAt).toISOString(),
    source: 'spotify_exact_track_id',
  };

  if (value.spotifyProviderResolvedTrackId != null || value.spotifyProviderRelinked != null) {
    const resolvedId = String(value.spotifyProviderResolvedTrackId || '').trim();
    if (!validSpotifyId(resolvedId) || resolvedId === id || value.spotifyProviderRelinked !== true) return null;
    normalized.spotifyProviderResolvedTrackId = resolvedId;
    normalized.spotifyProviderRelinked = true;
  }
  return normalized;
}

function normalizeCheckpoint(value) {
  if (!value || Number(value.schemaVersion) !== 1) return null;
  const plannedIds = Array.isArray(value.plannedIds) ? value.plannedIds.map(String) : [];
  const remainingIds = Array.isArray(value.remainingIds) ? value.remainingIds.map(String) : [];
  const terminalNotFoundIds = Array.isArray(value.terminalNotFoundIds) ? value.terminalNotFoundIds.map(String) : [];
  if (!plannedIds.length || plannedIds.length > MAX_IDS_PER_INVOCATION) return null;
  if ([...plannedIds, ...remainingIds, ...terminalNotFoundIds].some((id) => !validSpotifyId(id))) return null;
  const uniquePlanned = [...new Set(plannedIds)];
  const uniqueRemaining = [...new Set(remainingIds)];
  const planned = new Set(uniquePlanned);
  if (uniqueRemaining.some((id) => !planned.has(id))) return null;

  if (value.stagedRecords != null && (!value.stagedRecords || typeof value.stagedRecords !== 'object' || Array.isArray(value.stagedRecords))) return null;
  const stagedRecords = {};
  for (const [id, rawRecord] of Object.entries(value.stagedRecords || {})) {
    if (!planned.has(id) || uniqueRemaining.includes(id)) return null;
    const record = normalizeStagedRecord(id, rawRecord);
    if (!record) return null;
    stagedRecords[id] = record;
  }

  return {
    schemaVersion: 1,
    plannedIds: uniquePlanned,
    remainingIds: uniqueRemaining,
    terminalNotFoundIds: [...new Set(terminalNotFoundIds)],
    stagedRecords,
    requestCount: Math.max(0, Math.floor(Number(value.requestCount) || 0)),
    stopReason: value.stopReason == null ? null : String(value.stopReason),
  };
}

function createOrResumePlan({ events = [], metadata = {}, checkpoint = null, cap = DEFAULT_IDS_PER_INVOCATION } = {}) {
  const effectiveCap = Math.max(1, Math.min(MAX_IDS_PER_INVOCATION, Math.floor(Number(cap) || DEFAULT_IDS_PER_INVOCATION)));
  const existing = existingRecordIds(metadata);
  const sourceIds = trustedTrackIds(events);
  const prior = normalizeCheckpoint(checkpoint);
  if (checkpoint && !prior) throw new Error('Invalid private backfill checkpoint.');
  if (prior) {
    const notFound = new Set(prior.terminalNotFoundIds);
    const remainingIds = prior.remainingIds.filter((id) => sourceIds.includes(id) && !existing.has(id) && !notFound.has(id));
    if (remainingIds.length || Object.keys(prior.stagedRecords).length) {
      return { ...prior, remainingIds, stopReason: null };
    }
  }

  const unavailable = new Set(prior?.terminalNotFoundIds || []);
  const plannedIds = sourceIds.filter((id) => !existing.has(id) && !unavailable.has(id)).slice(0, effectiveCap);
  if (!plannedIds.length) return null;
  return {
    schemaVersion: 1,
    plannedIds,
    remainingIds: [...plannedIds],
    terminalNotFoundIds: [...unavailable].sort(),
    stagedRecords: {},
    requestCount: 0,
    stopReason: null,
  };
}

function recordFromSpotifyTrack(requestedId, track, now = new Date().toISOString()) {
  const requested = String(requestedId || '').trim();
  const resolved = String(track?.id || '').trim();
  if (!validSpotifyId(requested) || !validSpotifyId(resolved)) return null;
  const album = track?.album || {};
  const albumId = validSpotifyId(album.id) ? String(album.id) : null;
  const artwork = Array.isArray(album.images)
    ? album.images.find((image) => validHttpsUrl(image?.url))?.url || null
    : null;
  const fetchedAt = new Date(now).toISOString();
  const record = {
    spotifyTrackId: requested,
    spotifyTrackUrl: `https://open.spotify.com/track/${requested}`,
    spotifyAlbumId: albumId,
    spotifyAlbumUrl: albumId ? `https://open.spotify.com/album/${albumId}` : null,
    artworkUrl: artwork,
    fetchedAt,
    source: 'spotify_exact_track_id',
  };
  if (resolved !== requested) {
    record.spotifyProviderResolvedTrackId = resolved;
    record.spotifyProviderRelinked = true;
  }
  return record;
}

function completeSuccess(checkpoint, requestedId, track, now) {
  const state = normalizeCheckpoint(checkpoint);
  if (!state) throw new Error('Invalid backfill checkpoint.');
  const id = String(requestedId || '').trim();
  if (!state.remainingIds.includes(id)) throw new Error('Track is not pending in this backfill checkpoint.');
  const record = recordFromSpotifyTrack(id, track, now);
  if (!record) throw new Error('Spotify returned track metadata that cannot be used safely.');
  return {
    ...state,
    remainingIds: state.remainingIds.filter((candidate) => candidate !== id),
    stagedRecords: { ...state.stagedRecords, [id]: record },
    requestCount: state.requestCount + 1,
    stopReason: null,
  };
}

function completeNotFound(checkpoint, requestedId) {
  const state = normalizeCheckpoint(checkpoint);
  if (!state) throw new Error('Invalid backfill checkpoint.');
  const id = String(requestedId || '').trim();
  if (!state.remainingIds.includes(id)) throw new Error('Track is not pending in this backfill checkpoint.');
  return {
    ...state,
    remainingIds: state.remainingIds.filter((candidate) => candidate !== id),
    terminalNotFoundIds: [...new Set([...state.terminalNotFoundIds, id])].sort(),
    requestCount: state.requestCount + 1,
    stopReason: null,
  };
}

function stopWithoutConsuming(checkpoint, reason, { countRequest = true } = {}) {
  const state = normalizeCheckpoint(checkpoint);
  if (!state) throw new Error('Invalid backfill checkpoint.');
  return {
    ...state,
    requestCount: state.requestCount + (countRequest ? 1 : 0),
    stopReason: String(reason || 'stopped'),
  };
}

function mergeStagedRecords(metadata, checkpoint) {
  const state = normalizeCheckpoint(checkpoint);
  const base = clone(metadata || {});
  const output = {
    ...base,
    kind: base.kind || 'livevault-spotify-listening-metadata',
    schemaVersion: Number(base.schemaVersion) || 1,
    records: { ...(base.records || {}) },
  };
  if (!state) return output;
  for (const [id, staged] of Object.entries(state.stagedRecords)) {
    output.records[id] = { ...(output.records[id] || {}), ...clone(staged), spotifyTrackId: id };
  }
  return output;
}

function clearSynchronizedStages(checkpoint, metadata) {
  const state = normalizeCheckpoint(checkpoint);
  if (!state) return null;
  const records = metadata?.records || {};
  const stagedRecords = Object.fromEntries(Object.entries(state.stagedRecords)
    .filter(([id]) => !records[id]));
  return { ...state, stagedRecords };
}

module.exports = {
  MAX_IDS_PER_INVOCATION,
  DEFAULT_IDS_PER_INVOCATION,
  validSpotifyId,
  validHttpsUrl,
  validSpotifyUrl,
  trustedTrackIds,
  normalizeStagedRecord,
  normalizeCheckpoint,
  createOrResumePlan,
  recordFromSpotifyTrack,
  completeSuccess,
  completeNotFound,
  stopWithoutConsuming,
  mergeStagedRecords,
  clearSynchronizedStages,
};
