'use strict';

// Sanitized v135 observability. Counts only lane/endpoint families and provider
// outcomes; never stores provider IDs, query text, URLs, tokens or payloads.
const PATCH = Symbol.for('bandmarkr.v135.spotifyDiagnostics');
const ENDPOINTS = new Set(['token', 'artist_exact', 'artist_search', 'artist_albums', 'track_exact', 'track_search', 'album_exact_tracks', 'other']);
const LANES = new Set(['structured_identity', 'artist_image', 'album_artwork', 'predicted_playlist', 'historical_non_playlist', 'other']);

function ensure(usage) {
  if (!usage?.state?.spotify) return null;
  const spotify = usage.state.spotify;
  if (!spotify.diagnostics || typeof spotify.diagnostics !== 'object' || Array.isArray(spotify.diagnostics)) {
    spotify.diagnostics = { callsByLane: {}, callsByEndpoint: {}, outcomes: {}, circuitEvents: [], circuitStart: null, circuitFinish: null };
  }
  for (const key of ['callsByLane', 'callsByEndpoint', 'outcomes']) {
    if (!spotify.diagnostics[key] || typeof spotify.diagnostics[key] !== 'object' || Array.isArray(spotify.diagnostics[key])) spotify.diagnostics[key] = {};
  }
  if (!Array.isArray(spotify.diagnostics.circuitEvents)) spotify.diagnostics.circuitEvents = [];
  return spotify.diagnostics;
}

function count(bucket, key, amount = 1) {
  if (!bucket || !key || !(amount > 0)) return;
  bucket[key] = (Number(bucket[key]) || 0) + amount;
}

function calls(usage) {
  const value = Number(usage?.state?.spotify?.callsThisRun);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function outcomeKind(result) {
  if (result?.kind === 'ok' || result?.kind === 'confirmed' || result?.kind === 'reused') return 'successful';
  if (result?.kind === 'no_match') return 'no_match';
  if (result?.kind === 'skipped' || result?.kind === 'unavailable') return 'skipped';
  if (result?.kind === 'error' || result?.kind === 'quota_exceeded' || result?.kind === 'rate_limited') return 'provider_error';
  return null;
}

function recordOperation(usage, { lane, endpoint, before, result }) {
  const diagnostics = ensure(usage);
  if (!diagnostics) return;
  lane = LANES.has(lane) ? lane : 'other';
  endpoint = ENDPOINTS.has(endpoint) ? endpoint : 'other';
  const delta = Math.max(0, calls(usage) - Number(before || 0));
  if (delta > 0) {
    // A process-local Client Credentials token is fetched at most once. When
    // the first observed operation consumes >1 call, one is the token request;
    // the remainder belong to the operation endpoint (including bounded retry).
    const seenToken = Number(diagnostics.callsByEndpoint.token || 0) > 0;
    const tokenFailure = !seenToken && delta === 1 && /token/i.test(String(result?.error || result?.reason || ''));
    const tokenCalls = !seenToken && (delta > 1 || tokenFailure) ? 1 : 0;
    count(diagnostics.callsByEndpoint, 'token', tokenCalls);
    count(diagnostics.callsByEndpoint, endpoint, delta - tokenCalls);
    count(diagnostics.callsByLane, lane, delta);
  }
  const outcome = outcomeKind(result);
  if (outcome) count(diagnostics.outcomes, outcome);
}

function wrap(spotify, name, lane, endpoint) {
  const original = spotify[name];
  if (typeof original !== 'function') return;
  spotify[name] = async function v135Diagnosed(...args) {
    const usage = name === 'resolveArtistIdentity' ? args[0]?.usage : args[2]?.state?.spotify ? args[2] : args[1]?.state?.spotify ? args[1] : null;
    const before = calls(usage);
    try {
      const result = await original.apply(this, args);
      recordOperation(usage, { lane, endpoint, before, result });
      return result;
    } catch (error) {
      recordOperation(usage, { lane, endpoint, before, result: { kind: 'error', error: error?.message || 'request_failed' } });
      throw error;
    }
  };
}

function installSpotifyDiagnosticsV135(spotify) {
  if (!spotify || typeof spotify !== 'object') throw new Error('Spotify diagnostics require the Spotify module.');
  if (spotify[PATCH]) return false;
  Object.defineProperty(spotify, PATCH, { value: true, enumerable: false });
  wrap(spotify, 'searchTrackOutcome', 'historical_non_playlist', 'track_search');
  wrap(spotify, 'resolveArtistIdentity', 'structured_identity', 'artist_search');
  wrap(spotify, 'getArtistExact', 'artist_image', 'artist_exact');
  wrap(spotify, 'listArtistReleases', 'other', 'artist_albums');
  wrap(spotify, 'getReleaseTracks', 'other', 'album_exact_tracks');
  wrap(spotify, 'matchPredictedSong', 'predicted_playlist', 'track_search');
  return true;
}

module.exports = { ensure, calls, outcomeKind, recordOperation, installSpotifyDiagnosticsV135 };
