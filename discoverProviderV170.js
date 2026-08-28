'use strict';

(function attachDiscoverProviderV170(root, factory) {
  const api = factory(root || globalThis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LiveVaultDiscoverProviderV170 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const LABS_ROOT = 'https://labs.api.listenbrainz.org';
  const API_ROOT = 'https://api.listenbrainz.org';
  const SIMILAR_ARTISTS_PATH = '/similar-artists/json';
  const ARTIST_METADATA_PATH = '/1/metadata/artist/';
  const SIMILARITY_ALGORITHM = 'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30';
  const MIN_REQUEST_GAP_MS = 1000;
  const REQUEST_TIMEOUT_MS = 12000;
  const MAX_METADATA_BATCH = 50;

  function wait(ms) { return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))); }
  function rateLimitDelay(response) {
    for (const name of ['X-RateLimit-Reset-In', 'Retry-After']) {
      const seconds = Number(response?.headers?.get?.(name));
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60000);
    }
    return null;
  }
  async function safeFetch(url, options = {}, { fetchImpl = root.fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(url, { ...options, ...(controller ? { signal: controller.signal } : {}) });
      if (response.status === 429) {
        const error = new Error('ListenBrainz rate limited');
        error.retryAfterMs = rateLimitDelay(response);
        throw error;
      }
      if (response.status >= 500) throw new Error(`ListenBrainz unavailable (${response.status})`);
      if (!response.ok) throw new Error(`ListenBrainz returned HTTP ${response.status}`);
      return response;
    } finally { if (timer) clearTimeout(timer); }
  }
  function parseSimilarRows(payload, seedMbid) {
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.similar_artists) ? payload.similar_artists : Array.isArray(payload?.payload) ? payload.payload : [];
    return rows.map((row) => ({
      artistMbid: row?.artist_mbid || row?.mbid,
      name: row?.name || row?.artist_name,
      similarityScore: Number(row?.score ?? row?.similarity ?? 0),
      referenceMbid: row?.reference_mbid || seedMbid,
    })).filter((row) => row.artistMbid && row.name && String(row.referenceMbid || '').toLowerCase() === String(seedMbid).toLowerCase());
  }
  async function fetchSimilarArtists(seedMbid, { fetchImpl = root.fetch } = {}) {
    const response = await safeFetch(`${LABS_ROOT}${SIMILAR_ARTISTS_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify([{ artist_mbids: [seedMbid], algorithm: SIMILARITY_ALGORITHM }]),
    }, { fetchImpl });
    let payload;
    try { payload = await response.json(); } catch (_) { throw new Error('ListenBrainz returned malformed similar-artist data'); }
    return parseSimilarRows(payload, seedMbid);
  }
  function metadataRows(payload) { return Array.isArray(payload) ? payload : Array.isArray(payload?.payload) ? payload.payload : []; }
  function metadataCandidate(row) {
    if (!row || typeof row !== 'object') return null;
    const tags = Array.isArray(row?.tag?.artist) ? [...row.tag.artist].sort((a, b) => Number(b?.count || 0) - Number(a?.count || 0)).map((item) => item?.tag) : [];
    return {
      artistMbid: row.artist_mbid || row.mbid,
      name: row.name,
      tags,
      area: row.area || null,
      beginYear: row.begin_year == null ? null : Number(row.begin_year),
    };
  }
  async function fetchArtistMetadata(mbids, { fetchImpl = root.fetch } = {}) {
    const unique = [...new Set((mbids || []).map((id) => String(id || '').trim().toLowerCase()).filter(Boolean))];
    const out = new Map();
    for (let offset = 0; offset < unique.length; offset += MAX_METADATA_BATCH) {
      const batch = unique.slice(offset, offset + MAX_METADATA_BATCH);
      if (offset > 0) await wait(MIN_REQUEST_GAP_MS);
      const url = new URL(`${API_ROOT}${ARTIST_METADATA_PATH}`);
      url.searchParams.set('artist_mbids', batch.join(','));
      url.searchParams.set('inc', 'tag');
      const response = await safeFetch(url.toString(), { headers: { Accept: 'application/json' } }, { fetchImpl });
      let payload;
      try { payload = await response.json(); } catch (_) { throw new Error('ListenBrainz returned malformed artist metadata'); }
      for (const row of metadataRows(payload)) {
        const candidate = metadataCandidate(row);
        if (candidate?.artistMbid) out.set(String(candidate.artistMbid).toLowerCase(), candidate);
      }
    }
    return out;
  }
  async function discoverForSeeds(seeds, { fetchImpl = root.fetch, paceMs = MIN_REQUEST_GAP_MS } = {}) {
    const results = [];
    const raw = [];
    for (let index = 0; index < Math.min(10, (seeds || []).length); index += 1) {
      if (index > 0) await wait(paceMs);
      const seed = seeds[index];
      const candidates = await fetchSimilarArtists(seed.seedMbid, { fetchImpl });
      raw.push({ ...seed, candidates });
    }
    const candidateMbids = [...new Set(raw.flatMap((result) => result.candidates.map((candidate) => String(candidate.artistMbid || '').toLowerCase())).filter(Boolean))];
    if (candidateMbids.length && raw.length) await wait(paceMs);
    const metadata = candidateMbids.length ? await fetchArtistMetadata(candidateMbids, { fetchImpl }) : new Map();
    for (const result of raw) {
      results.push({
        seedBandId: result.seedBandId,
        seedMbid: result.seedMbid,
        seedName: result.seedName,
        candidates: result.candidates.map((candidate) => ({ ...candidate, ...(metadata.get(String(candidate.artistMbid).toLowerCase()) || {}) })),
      });
    }
    return results;
  }

  return Object.freeze({ LABS_ROOT, API_ROOT, SIMILAR_ARTISTS_PATH, ARTIST_METADATA_PATH, SIMILARITY_ALGORITHM, MIN_REQUEST_GAP_MS, REQUEST_TIMEOUT_MS, parseSimilarRows, metadataCandidate, fetchSimilarArtists, fetchArtistMetadata, discoverForSeeds });
});
