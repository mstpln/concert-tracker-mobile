'use strict';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SPOTIFY_ID = /^[A-Za-z0-9]{1,64}$/;
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/i;
const TRACK_KEY = /^(?:spotify:[A-Za-z0-9]{1,64}|listenbrainz:[a-f0-9]{64})$/;
const MAX_RECORDS = 100000;
const TRACK_STATUSES = new Set(['complete', 'unresolved', 'ambiguous', 'no_match', 'retry', 'review']);

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isDate(value) {
  return value == null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

function isHttpsUrl(value) {
  if (value == null) return true;
  if (typeof value !== 'string' || !value) return false;
  try { return new URL(value).protocol === 'https:'; }
  catch (_) { return false; }
}

function validSpotifyMetadataRecord(key, record) {
  if (!SPOTIFY_ID.test(String(key || '')) || !isObject(record) || record.spotifyTrackId !== key) return false;
  try {
    const trackUrl = new URL(record.spotifyTrackUrl);
    if (trackUrl.protocol !== 'https:' || trackUrl.hostname !== 'open.spotify.com' || trackUrl.pathname !== `/track/${key}`) return false;
  } catch (_) { return false; }
  if (record.spotifyAlbumId != null) {
    if (!SPOTIFY_ID.test(String(record.spotifyAlbumId))) return false;
    try {
      const albumUrl = new URL(record.spotifyAlbumUrl);
      if (albumUrl.protocol !== 'https:' || albumUrl.hostname !== 'open.spotify.com' || albumUrl.pathname !== `/album/${record.spotifyAlbumId}`) return false;
    } catch (_) { return false; }
  } else if (record.spotifyAlbumUrl != null) return false;
  if (!isHttpsUrl(record.artworkUrl) || !isDate(record.fetchedAt) || record.source !== 'spotify_exact_track_id') return false;
  if (record.spotifyArtistIds != null) {
    if (!Array.isArray(record.spotifyArtistIds) || record.spotifyArtistIds.length > 20 || record.spotifyArtistIds.some((id) => !SPOTIFY_ID.test(String(id || '')))) return false;
  }
  if (record.isrc != null && !ISRC.test(String(record.isrc))) return false;
  return true;
}

function validSpotifyMetadataDocument(value) {
  if (!isObject(value) || value.kind !== 'livevault-spotify-listening-metadata' || value.schemaVersion !== 1 || !isDate(value.updatedAt) || !isObject(value.records)) return false;
  const entries = Object.entries(value.records);
  return entries.length <= MAX_RECORDS && entries.every(([key, record]) => validSpotifyMetadataRecord(key, record));
}

function validEvidence(value) {
  if (!isObject(value) || typeof value.source !== 'string' || !value.source || value.source.length > 64) return false;
  return isDate(value.observedAt);
}

function validTrackIdentityRecord(key, record) {
  if (!TRACK_KEY.test(String(key || '')) || !isObject(record) || record.trackKey !== key || !SAFE_ID.test(String(record.bandId || ''))) return false;
  if (!TRACK_STATUSES.has(record.status)) return false;
  if (record.musicbrainzRecordingMbid != null && !MBID.test(String(record.musicbrainzRecordingMbid))) return false;
  if (record.musicbrainzArtistMbids != null) {
    if (!Array.isArray(record.musicbrainzArtistMbids) || record.musicbrainzArtistMbids.length > 20 || record.musicbrainzArtistMbids.some((id) => !MBID.test(String(id || '')))) return false;
  }
  if (record.evidence != null) {
    if (!Array.isArray(record.evidence) || record.evidence.length > 20 || record.evidence.some((item) => !validEvidence(item))) return false;
  }
  return isDate(record.verifiedAt) && isDate(record.nextEligibleCheckAt);
}

function validTrackIdentitiesDocument(value) {
  if (!isObject(value) || value.kind !== 'bandmarkr-listening-track-identities' || value.schemaVersion !== 1 || !isDate(value.updatedAt) || !isObject(value.records)) return false;
  const entries = Object.entries(value.records);
  return entries.length <= MAX_RECORDS && entries.every(([key, record]) => validTrackIdentityRecord(key, record));
}

function validCoordinates(value) {
  if (value == null) return true;
  if (!isObject(value)) return false;
  const lat = Number(value.latitude);
  const lon = Number(value.longitude);
  return Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lon) && lon >= -180 && lon <= 180;
}

function validWeatherRecord(key, record) {
  if (!SAFE_ID.test(String(key || '')) || !isObject(record) || record.concertId !== key || record.source !== 'open-meteo') return false;
  if (!isDate(record.fetchedAt) || !isDate(record.nextEligibleCheckAt) || !isDate(record.locationResolvedAt) || !validCoordinates(record.coordinates)) return false;
  if (record.locationFingerprint != null && !/^[a-f0-9]{64}$/.test(String(record.locationFingerprint))) return false;
  if (record.forecast != null && !isObject(record.forecast)) return false;
  return true;
}

function validWeatherDocument(value) {
  if (!isObject(value) || value.kind !== 'bandmarkr-concert-weather' || value.schemaVersion !== 1 || !isDate(value.updatedAt) || !isObject(value.records)) return false;
  const entries = Object.entries(value.records);
  return entries.length <= MAX_RECORDS && entries.every(([key, record]) => validWeatherRecord(key, record));
}

module.exports = {
  SAFE_ID,
  SPOTIFY_ID,
  MBID,
  ISRC,
  TRACK_KEY,
  TRACK_STATUSES,
  validSpotifyMetadataRecord,
  validSpotifyMetadataDocument,
  validTrackIdentityRecord,
  validTrackIdentitiesDocument,
  validWeatherRecord,
  validWeatherDocument,
};
