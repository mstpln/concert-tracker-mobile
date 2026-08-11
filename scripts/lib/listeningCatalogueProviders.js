'use strict';

const config = require('./config');
const inventoryLib = require('../listening-inventory');

const MUSICBRAINZ_RELEASE_BROWSE_LIMIT = 100;
const MUSICBRAINZ_TRANSIENT_RETRY_MS = 30 * 60 * 1000;
const LISTENBRAINZ_LOOKUP_URL = 'https://api.listenbrainz.org/1/metadata/lookup/';
const MAX_LISTENBRAINZ_BATCH = 100;
const SUPPORTED_SCOPES = Object.freeze(['release_artist', 'release_track_artist']);

function safeJson(response) {
  return response.json().catch(() => null);
}

function retryAtFromHeaders(response, nowMs) {
  const raw = response?.headers?.get?.('retry-after');
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return new Date(nowMs + Math.ceil(seconds * 1000)).toISOString();
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed) && parsed > nowMs) return new Date(parsed).toISOString();
  }
  return new Date(nowMs + MUSICBRAINZ_TRANSIENT_RETRY_MS).toISOString();
}

function catalogueScopeParam(scope) {
  if (scope === 'release_artist') return 'artist';
  if (scope === 'release_track_artist') return 'track_artist';
  return null;
}

function createMusicBrainzCatalogueAdapter({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('MusicBrainz catalogue adapter requires fetch.');
  return {
    async releaseBrowse({ artistMbid, scope, offset = 0, limit = MUSICBRAINZ_RELEASE_BROWSE_LIMIT } = {}) {
      const trustedArtist = inventoryLib.validMbid(artistMbid);
      const scopeParam = catalogueScopeParam(scope);
      if (!trustedArtist || !scopeParam || !Number.isInteger(offset) || offset < 0
        || !Number.isInteger(limit) || limit < 1 || limit > MUSICBRAINZ_RELEASE_BROWSE_LIMIT) {
        return { kind: 'error', reason: 'invalid_musicbrainz_catalogue_request' };
      }
      const url = new URL(`${config.MUSICBRAINZ.baseUrl}/release`);
      url.searchParams.set(scopeParam, trustedArtist);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('offset', String(offset));
      url.searchParams.set('inc', 'recordings release-groups artist-credits');
      url.searchParams.set('fmt', 'json');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.MUSICBRAINZ.timeoutMs);
      let response;
      try {
        response = await fetchImpl(url, {
          headers: { Accept: 'application/json', 'User-Agent': config.MUSICBRAINZ.userAgent },
          signal: controller.signal,
        });
      } catch (error) {
        return {
          kind: 'retry',
          reason: error?.name === 'AbortError' ? 'musicbrainz_timeout' : 'musicbrainz_network_error',
          nextEligibleCheckAt: new Date(now() + MUSICBRAINZ_TRANSIENT_RETRY_MS).toISOString(),
        };
      } finally {
        clearTimeout(timer);
      }
      if (response.status === 429 || response.status === 503) {
        return { kind: 'retry', reason: `http_${response.status}`, nextEligibleCheckAt: retryAtFromHeaders(response, now()) };
      }
      if (!response.ok) return { kind: 'error', reason: `http_${response.status}` };
      const data = await safeJson(response);
      return data && typeof data === 'object' && !Array.isArray(data)
        ? { kind: 'ok', data }
        : { kind: 'error', reason: 'musicbrainz_invalid_json' };
    },
  };
}

function createListenBrainzBatchAdapter({ fetchImpl = fetch, tokenProvider, now = () => Date.now() } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('ListenBrainz batch adapter requires fetch.');
  return {
    async lookupBatch({ items } = {}) {
      if (!Array.isArray(items) || items.length < 1 || items.length > MAX_LISTENBRAINZ_BATCH) {
        return { kind: 'error', reason: 'invalid_listenbrainz_batch' };
      }
      const recordings = [];
      for (const item of items) {
        const artistName = typeof item?.artistName === 'string' ? item.artistName.trim() : '';
        const recordingName = typeof item?.recordingName === 'string' ? item.recordingName.trim() : '';
        const releaseName = typeof item?.releaseName === 'string' ? item.releaseName.trim() : '';
        if (!artistName || !recordingName) return { kind: 'error', reason: 'invalid_listenbrainz_batch_item' };
        recordings.push({ artist_name: artistName, recording_name: recordingName, ...(releaseName ? { release_name: releaseName } : {}) });
      }
      if (typeof tokenProvider !== 'function') return { kind: 'error', reason: 'listenbrainz_token_provider_missing' };
      let token;
      try { token = String(await tokenProvider()).trim(); } catch { token = ''; }
      if (!token) return { kind: 'error', reason: 'listenbrainz_token_unavailable' };
      let response;
      try {
        response = await fetchImpl(LISTENBRAINZ_LOOKUP_URL, {
          method: 'POST',
          headers: { Authorization: `Token ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ recordings }),
        });
      } catch {
        return { kind: 'retry', reason: 'listenbrainz_network_error', nextEligibleCheckAt: new Date(now() + 30 * 60 * 1000).toISOString() };
      }
      if (response.status === 429 || response.status === 503) {
        const resetIn = Number(response.headers?.get?.('x-ratelimit-reset-in'));
        const retryAt = Number.isFinite(resetIn) && resetIn >= 0
          ? new Date(now() + Math.ceil(resetIn * 1000)).toISOString()
          : retryAtFromHeaders(response, now());
        return { kind: 'retry', reason: `http_${response.status}`, nextEligibleCheckAt: retryAt };
      }
      if (!response.ok) return { kind: 'error', reason: `http_${response.status}` };
      const data = await safeJson(response);
      return Array.isArray(data) ? { kind: 'ok', data } : { kind: 'error', reason: 'listenbrainz_invalid_json' };
    },
  };
}

module.exports = {
  MUSICBRAINZ_RELEASE_BROWSE_LIMIT,
  MUSICBRAINZ_TRANSIENT_RETRY_MS,
  LISTENBRAINZ_LOOKUP_URL,
  MAX_LISTENBRAINZ_BATCH,
  SUPPORTED_SCOPES,
  catalogueScopeParam,
  createMusicBrainzCatalogueAdapter,
  createListenBrainzBatchAdapter,
};
