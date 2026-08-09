'use strict';

const config = require('./config');

const SPOTIFY_TRACK_URL = 'https://api.spotify.com/v1/tracks';
const LISTENBRAINZ_LOOKUP_URL = 'https://api.listenbrainz.org/1/metadata/lookup/';
const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
const SPOTIFY_ID_RE = /^[A-Za-z0-9]{1,64}$/;

function validDateMs(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function retryAtFromHeader(response, nowMs = Date.now()) {
  const raw = response?.headers?.get?.('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return new Date(nowMs + Math.ceil(seconds * 1000)).toISOString();
  const absolute = validDateMs(raw);
  return absolute != null && absolute > nowMs ? new Date(absolute).toISOString() : null;
}

async function safeJson(response) {
  try { return await response.json(); } catch (error) { return null; }
}

function httpFailure(response, nowMs) {
  const status = Number(response?.status);
  const retryAt = retryAtFromHeader(response, nowMs);
  if ((status === 429 || status === 503) && retryAt) {
    return { kind: 'retry', reason: `http_${status}`, nextEligibleCheckAt: retryAt };
  }
  return { kind: 'error', reason: Number.isFinite(status) ? `http_${status}` : 'provider_http_error' };
}

function requiredToken(provider, value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${provider} maintenance token is unavailable.`);
  return value.trim();
}

function spotifyQuotaExceeded(payload) {
  return payload?.error?.reason === 'QUOTA_EXCEEDED';
}

function createListeningMaintenanceProviders({
  fetchImpl = fetch,
  spotifyTokenProvider,
  listenbrainzTokenProvider,
  now = () => Date.now(),
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Listening maintenance providers require fetch.');

  return {
    spotify: {
      async exact_track({ spotifyTrackId } = {}) {
        if (!SPOTIFY_ID_RE.test(String(spotifyTrackId || ''))) return { kind: 'error', reason: 'invalid_spotify_track_id' };
        if (typeof spotifyTokenProvider !== 'function') return { kind: 'error', reason: 'spotify_token_provider_missing' };
        let token;
        try { token = requiredToken('Spotify', await spotifyTokenProvider()); }
        catch (error) { return { kind: 'error', reason: 'spotify_token_unavailable' }; }
        let response;
        try {
          response = await fetchImpl(`${SPOTIFY_TRACK_URL}/${encodeURIComponent(spotifyTrackId)}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
        } catch (error) {
          return { kind: 'error', reason: 'spotify_network_error' };
        }
        if (response.status === 404) return { kind: 'no_match', reason: 'spotify_track_not_found' };
        if (!response.ok) {
          if (response.status === 429) {
            const payload = await safeJson(response);
            if (spotifyQuotaExceeded(payload)) return { kind: 'halt', reason: 'quota_exceeded' };
          }
          return httpFailure(response, now());
        }
        const data = await safeJson(response);
        return data && typeof data === 'object' ? { kind: 'ok', data } : { kind: 'error', reason: 'spotify_invalid_json' };
      },
    },

    musicbrainz: {
      async isrc_lookup({ isrc } = {}) {
        const normalized = String(isrc || '').toUpperCase();
        if (!ISRC_RE.test(normalized)) return { kind: 'error', reason: 'invalid_isrc' };
        const url = `${config.MUSICBRAINZ.baseUrl}/isrc/${encodeURIComponent(normalized)}?fmt=json&inc=artist-credits`;
        let response;
        try {
          response = await fetchImpl(url, {
            headers: {
              Accept: 'application/json',
              'User-Agent': config.MUSICBRAINZ.userAgent,
            },
          });
        } catch (error) {
          return { kind: 'error', reason: 'musicbrainz_network_error' };
        }
        if (response.status === 404) return { kind: 'no_match', reason: 'musicbrainz_isrc_not_found' };
        if (!response.ok) return httpFailure(response, now());
        const data = await safeJson(response);
        return data && typeof data === 'object' ? { kind: 'ok', data } : { kind: 'error', reason: 'musicbrainz_invalid_json' };
      },
    },

    listenbrainz: {
      async metadata_lookup({ artistName, recordingName } = {}) {
        if (typeof artistName !== 'string' || !artistName.trim() || typeof recordingName !== 'string' || !recordingName.trim()) {
          return { kind: 'error', reason: 'invalid_listenbrainz_lookup_text' };
        }
        if (typeof listenbrainzTokenProvider !== 'function') return { kind: 'error', reason: 'listenbrainz_token_provider_missing' };
        let token;
        try { token = requiredToken('ListenBrainz', await listenbrainzTokenProvider()); }
        catch (error) { return { kind: 'error', reason: 'listenbrainz_token_unavailable' }; }
        const params = new URLSearchParams({ artist_name: artistName, recording_name: recordingName });
        let response;
        try {
          response = await fetchImpl(`${LISTENBRAINZ_LOOKUP_URL}?${params.toString()}`, {
            headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
          });
        } catch (error) {
          return { kind: 'error', reason: 'listenbrainz_network_error' };
        }
        if (response.status === 404) return { kind: 'no_match', reason: 'listenbrainz_metadata_not_found' };
        if (!response.ok) return httpFailure(response, now());
        const data = await safeJson(response);
        return data && typeof data === 'object' ? { kind: 'ok', data } : { kind: 'error', reason: 'listenbrainz_invalid_json' };
      },
    },
  };
}

module.exports = {
  SPOTIFY_TRACK_URL,
  LISTENBRAINZ_LOOKUP_URL,
  retryAtFromHeader,
  httpFailure,
  spotifyQuotaExceeded,
  createListeningMaintenanceProviders,
};
