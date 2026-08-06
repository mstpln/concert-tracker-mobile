'use strict';

const SPOTIFY_ID = /^[A-Za-z0-9]{1,64}$/;
const MAX_RECORDS = 100000;

function validDate(value) {
  return value == null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

function validHttpsUrl(value) {
  if (value == null) return true;
  if (typeof value !== 'string' || !value) return false;
  try { return new URL(value).protocol === 'https:'; } catch (_) { return false; }
}

function validSpotifyUrl(value, kind, id) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'open.spotify.com'
      && url.pathname === `/${kind}/${id}`;
  } catch (_) { return false; }
}

function spotifyListeningMetadataRecordIsValid(key, record) {
  if (!SPOTIFY_ID.test(String(key || '')) || !record || typeof record !== 'object' || Array.isArray(record)) return false;
  if (record.spotifyTrackId !== key) return false;
  if (!validSpotifyUrl(record.spotifyTrackUrl, 'track', key)) return false;
  if (record.spotifyAlbumId != null) {
    if (!SPOTIFY_ID.test(String(record.spotifyAlbumId))) return false;
    if (!validSpotifyUrl(record.spotifyAlbumUrl, 'album', record.spotifyAlbumId)) return false;
  } else if (record.spotifyAlbumUrl != null) return false;
  if (!validHttpsUrl(record.artworkUrl)) return false;
  if (!validDate(record.fetchedAt)) return false;
  if (record.source !== 'spotify_exact_track_id') return false;
  return true;
}

function spotifyListeningMetadataIsValid(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.kind !== 'livevault-spotify-listening-metadata' || value.schemaVersion !== 1) return false;
  if (!validDate(value.updatedAt)) return false;
  if (!value.records || typeof value.records !== 'object' || Array.isArray(value.records)) return false;
  const entries = Object.entries(value.records);
  if (entries.length > MAX_RECORDS) return false;
  return entries.every(([key, record]) => spotifyListeningMetadataRecordIsValid(key, record));
}

export { MAX_RECORDS, spotifyListeningMetadataRecordIsValid, spotifyListeningMetadataIsValid };
