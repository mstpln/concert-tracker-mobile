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

function normalizeCheckpoint(value) {
  if (!value || Number(value.schemaVersion) !== 1) return null;
  const plannedIds = Array.isArray(value.plannedIds) ? value.plannedIds.map(String) : [];
  const remainingIds = Array.isArray(value.remainingIds) ? value.remainingIds.map(String) : [];
  const terminalNotFoundIds = Array.isArray(value.terminalNotFoundIds) ? value.terminalNotFoundIds.map(String) : [];
  if (!plannedIds.length || plannedIds.length > MAX_IDS_PER_INVOCATION) return null;
  if ([...plannedIds, ...remainingIds, ...terminalNotFoundIds].some((id) => !validSpotifyId(id))) return null;
  const planned = new Set(plannedIds);
  if (remainingIds.some((id) => !planned.has(id))) return null;
  return {
    ...clone(value),
    schemaVersion: 1,
    plannedIds: [...new Set(plannedIds)],
    remainingIds: [...new Set(remainingIds)],
    terminalNotFoundIds: [...new Set(terminalNotFoundIds)],
    stagedRecords: clone(value.stagedRecords || {}),
    requestCount: Math.max(0, Number(value.requestCount) || 0),
    stopReason: value.stopReason || null,
  };
}

function createOrResumePlan({ events = [], metadata = {}, checkpoint = null, cap = DEFAULT_IDS_PER_INVOCATION } = {}) {
  const effectiveCap = Math.max(1, Math.min(MAX_IDS_PER_INVOCATION, Math.floor(Number(cap) || DEFAULT_IDS_PER_INVOCATION)));
  const existing = existingRecordIds(metadata);
  const sourceIds = trustedTrackIds(events);
  const prior = normalizeCheckpoint(checkpoint);
  if (prior) {
    const notFound = new Set(prior.terminalNotFoundIds);
    const remainingIds = prior.remainingIds.filter((id) => sourceIds.includes(id) && !existing.has(id) && !notFound.has(id));
    if (remainingIds.length || Object.keys(prior.stagedRecords || {}).length) {
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
    ? album.images.find((image) => typeof image?.url === 'string' && /^https:\/\//i.test(image.url))?.url || null
    : null;
  const record = {
    spotifyTrackId: requested,
    spotifyTrackUrl: `https://open.spotify.com/track/${requested}`,
    spotifyAlbumId: albumId,
    spotifyAlbumUrl: albumId ? `https://open.spotify.com/album/${albumId}` : null,
    artworkUrl: artwork,
    fetchedAt: now,
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
  for (const [id, staged] of Object.entries(state.stagedRecords || {})) {
    if (!validSpotifyId(id) || staged?.spotifyTrackId !== id) continue;
    output.records[id] = { ...(output.records[id] || {}), ...clone(staged), spotifyTrackId: id };
  }
  return output;
}

function clearSynchronizedStages(checkpoint, metadata) {
  const state = normalizeCheckpoint(checkpoint);
  if (!state) return null;
  const records = metadata?.records || {};
  const stagedRecords = Object.fromEntries(Object.entries(state.stagedRecords || {})
    .filter(([id]) => !records[id]));
  return { ...state, stagedRecords };
}

module.exports = {
  MAX_IDS_PER_INVOCATION,
  DEFAULT_IDS_PER_INVOCATION,
  validSpotifyId,
  trustedTrackIds,
  normalizeCheckpoint,
  createOrResumePlan,
  recordFromSpotifyTrack,
  completeSuccess,
  completeNotFound,
  stopWithoutConsuming,
  mergeStagedRecords,
  clearSynchronizedStages,
};
