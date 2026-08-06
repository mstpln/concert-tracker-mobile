'use strict';

const config = require('./config');

let cachedToken = null;

function normalizeName(value) {
  return String(value || '')
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^the\s+/u, '')
    .replace(/\s+/g, ' ');
}

const IMPERSONATOR = /\b(tribute|cover|karaoke|parody|experience|impersonat|ultimate|revival|homage|salute)\b/i;

function basicAuthHeader() {
  const id = process.env[config.SPOTIFY.clientIdEnv];
  const secret = process.env[config.SPOTIFY.clientSecretEnv];
  if (!id || !secret) {
    throw new Error(`Missing required environment variable(s): ${config.SPOTIFY.clientIdEnv}/${config.SPOTIFY.clientSecretEnv}`);
  }
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

async function getToken(usage, fetchImpl = fetch) {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.accessToken;
  if (!usage.canCallSpotify()) return null;
  await usage.recordSpotifyCall();
  const response = await fetchImpl(config.SPOTIFY.tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw new Error(`Spotify token request failed: HTTP ${response.status}`);
  const payload = await response.json();
  cachedToken = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in || 3600) * 1000,
  };
  return cachedToken.accessToken;
}

function acceptedNamesForBand(band, metadata) {
  return new Set([
    band?.name,
    metadata?.artistName,
    ...(Array.isArray(metadata?.aliases) ? metadata.aliases : []),
  ].map(normalizeName).filter(Boolean));
}

function normalizeCandidate(candidate) {
  if (!candidate?.id) return null;
  return {
    id: String(candidate.id),
    artistName: candidate.name || null,
    url: candidate.external_urls?.spotify || `https://open.spotify.com/artist/${candidate.id}`,
    genres: Array.isArray(candidate.genres) ? [...candidate.genres] : [],
    images: Array.isArray(candidate.images) ? candidate.images.map((image) => ({ ...image })) : [],
    followers: Number.isFinite(candidate.followers?.total) ? candidate.followers.total : null,
    popularity: Number.isFinite(candidate.popularity) ? candidate.popularity : null,
  };
}

function candidateSort(left, right) {
  return (Number(right.followers || 0) - Number(left.followers || 0))
    || (Number(right.popularity || 0) - Number(left.popularity || 0))
    || String(left.artistName || '').localeCompare(String(right.artistName || ''))
    || left.id.localeCompare(right.id);
}

async function searchArtistCandidates({ band, metadata, usage, fetchImpl = fetch, tokenProvider = getToken }) {
  if (!usage.canCallSpotify()) return { kind: 'skipped', candidates: [] };
  try {
    const token = await tokenProvider(usage, fetchImpl);
    if (!token || !usage.canCallSpotify()) return { kind: 'skipped', candidates: [] };
    await usage.recordSpotifyCall();
    const query = String(band?.name || metadata?.artistName || '').trim();
    const url = `${config.SPOTIFY.searchUrl}?type=artist&limit=10&q=${encodeURIComponent(query)}`;
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 403) return { kind: 'unavailable', status: 403, candidates: [] };
    if (response.status === 429 || response.status >= 500) return { kind: 'error', status: response.status, candidates: [] };
    if (!response.ok) return { kind: 'error', status: response.status, candidates: [] };
    const payload = await response.json();
    const acceptedNames = acceptedNamesForBand(band, metadata);
    const seen = new Set();
    const candidates = [];
    for (const artist of payload?.artists?.items || []) {
      if (!artist?.id || seen.has(artist.id)) continue;
      if (!acceptedNames.has(normalizeName(artist.name))) continue;
      if (IMPERSONATOR.test(`${artist.name || ''} ${artist.description || ''}`)) continue;
      const normalized = normalizeCandidate(artist);
      if (!normalized) continue;
      seen.add(normalized.id);
      candidates.push(normalized);
    }
    candidates.sort(candidateSort);
    return { kind: candidates.length ? 'ok' : 'no_match', candidates: candidates.slice(0, 5) };
  } catch (error) {
    return { kind: 'error', error: error.message || 'request_failed', candidates: [] };
  }
}

function resetTokenCache() {
  cachedToken = null;
}

module.exports = {
  normalizeName,
  acceptedNamesForBand,
  normalizeCandidate,
  candidateSort,
  searchArtistCandidates,
  resetTokenCache,
};
