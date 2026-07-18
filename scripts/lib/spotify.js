'use strict';
// Spotify Web API client (Client Credentials flow — app-only, no user
// login) used to resolve a real track link for each ORIGINAL (non-cover)
// song in a setlist.fm setlist. Cover songs are deliberately never looked
// up here — setlist.fm only tells us a song IS a cover, not who the
// original artist is, and the user only wants links for the band's own
// songs anyway.
//
// Unlike Ticketmaster/Tavily/Groq/setlist.fm, Spotify's Client Credentials
// flow doesn't publish a fixed free-tier request cap — it throttles
// dynamically, returning 429 with a Retry-After header when a caller is
// going too fast. usageTracker's spotify caps (config.js) are a defensive
// safety valve, not a documented ceiling; the 429 handling below is the
// real enforcement mechanism.

const config = require('./config');
const { sleep } = require('./util');
const { normalizeTitle } = require('./predictedSetlist');

function basicAuthHeader() {
  const id = process.env[config.SPOTIFY.clientIdEnv];
  const secret = process.env[config.SPOTIFY.clientSecretEnv];
  if (!id || !secret) {
    throw new Error(`Missing required environment variable(s): ${config.SPOTIFY.clientIdEnv}/${config.SPOTIFY.clientSecretEnv}`);
  }
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

// Cached for the lifetime of this process (one pipeline run) — a Client
// Credentials token lasts ~1 hour, far longer than a single run needs, so
// there's no reason to fetch a new one per song.
let cachedToken = null; // { accessToken, expiresAt }

async function getAppToken(usage = null, fetchImpl = fetch) {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.accessToken;
  if (usage && !usage.canCallSpotify()) throw new Error('Spotify usage cap reached before token request');
  if (usage) await usage.recordSpotifyCall();
  const res = await fetchImpl(config.SPOTIFY.tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify token request failed: HTTP ${res.status}`);
  const data = await res.json();
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.accessToken;
}

// Same normalize-and-loosely-compare approach as setlistfm.js's venueMatches
// — a false negative here throws away a perfectly good link, so it's
// deliberately forgiving. A false positive is guarded against separately by
// only ever trusting Spotify's own top-ranked, popularity-sorted result
// among artist-matched candidates, never just the literal first hit.
function artistMatches(candidateArtists, bandName, spotifyArtistId = null) {
  if (spotifyArtistId) return (candidateArtists || []).some((artist) => artist?.id === spotifyArtistId);
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const target = norm(bandName);
  if (!target) return true;
  return (candidateArtists || []).some((a) => {
    const n = norm(a?.name);
    return !!n && (n === target || n.includes(target) || target.includes(n));
  });
}

async function searchTrack(songTitle, bandName, usage, { spotifyArtistId = null, fetchImpl = fetch, getToken = getAppToken } = {}) {
  if (!usage.canCallSpotify()) return null;
  const token = await getToken(usage, fetchImpl);
  const q = `track:"${songTitle.replace(/"/g, '')}" artist:"${bandName.replace(/"/g, '')}"`;
  const url = `${config.SPOTIFY.searchUrl}?type=track&limit=5&q=${encodeURIComponent(q)}`;

  await usage.recordSpotifyCall();
  let res;
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    usage.note(`Spotify search failed for "${songTitle}" / "${bandName}": ${e.message}`);
    return null;
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after')) || 2;
    usage.note(`Spotify rate-limited — waiting ${retryAfter}s`);
    await sleep((retryAfter + 1) * 1000);
    try {
      if (!usage.canCallSpotify()) return null;
      await usage.recordSpotifyCall();
      res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
      usage.note(`Spotify search retry failed for "${songTitle}": ${e.message}`);
      return null;
    }
  }
  if (!res.ok) {
    usage.note(`Spotify search returned ${res.status} for "${songTitle}" / "${bandName}"`);
    return null;
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    return null;
  }
  const items = data?.tracks?.items || [];
  const candidates = items.filter((t) => artistMatches(t.artists, bandName, spotifyArtistId));
  if (candidates.length === 0) return null;

  // Most-popular version wins — the agreed default when a song has multiple
  // Spotify recordings (studio, live, remaster), rather than always
  // preferring the studio original.
  candidates.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  return candidates[0]?.external_urls?.spotify || null;
}

// Mutates each non-cover, not-yet-checked song in `songs` in place, setting
// spotifyUrl when a confident match is found. Always sets spotifyChecked —
// success or not — so a song with genuinely no good match isn't re-queried
// forever; same "attempt once, don't retry endlessly" shape as setlist.fm's
// per-concert setlistCheckedAt. Returns how many links were newly added.
async function resolveSongLinks(songs, bandName, usage, { spotifyArtistId = null } = {}) {
  let added = 0;
  for (const song of songs) {
    if (song.isCover || song.spotifyChecked) continue;
    if (!usage.canCallSpotify()) break;
    try {
      const url = await searchTrack(song.name, bandName, usage, { spotifyArtistId });
      song.spotifyChecked = true;
      if (url) {
        song.spotifyUrl = url;
        added += 1;
      }
    } catch (e) {
      usage.note(`Spotify lookup failed for "${song.name}" (${bandName}): ${e.message}`);
      song.spotifyChecked = true;
    }
  }
  return added;
}

const IMPERSONATOR = /\b(tribute|cover|karaoke|parody|experience|impersonat|ultimate|revival|homage|salute)\b/i;
const norm = (value) => String(value || '').toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/^the\s+/u, '').replace(/\s+/g, ' ');

function spotifyIdentity(mbidMetadata, candidate, now = new Date().toISOString(), method = 'search_exact') {
  return {
    id: candidate.id, url: candidate.url || candidate.external_urls?.spotify || `https://open.spotify.com/artist/${candidate.id}`,
    artistName: candidate.name || null, status: 'confirmed', matchMethod: method, confidence: 100,
    matchedAt: now, lastAttemptedAt: now, lastCheckedAt: now, lastSuccessfulAt: now, nextEligibleCheckAt: null, errorCategory: null,
  };
}

function retryableIdentity(prior, status, now, errorCategory = null) {
  const retryDays = config.STRUCTURED_RESEARCH.unresolvedIdentityRetryDays;
  const retryHours = config.STRUCTURED_RESEARCH.temporaryErrorRetryHours;
  return { ...prior, id: null, url: null, artistName: null, status, matchMethod: null, confidence: null,
    matchedAt: null, lastAttemptedAt: now, lastCheckedAt: now, lastSuccessfulAt: prior?.lastSuccessfulAt || null,
    nextEligibleCheckAt: new Date(Date.parse(now) + (status === 'error' ? retryHours * 3600000 : retryDays * 86400000)).toISOString(), errorCategory };
}

async function resolveArtistIdentity({ band, metadata, usage, fetchImpl = fetch, getToken = getAppToken, now = new Date().toISOString() }) {
  const prior = band.musicbrainz?.spotify;
  if (['confirmed', 'manual_confirmed'].includes(prior?.status) && prior.id) return { kind: 'reused', identity: prior };
  if (prior?.status === 'manual_rejected') return { kind: 'skipped', identity: prior };
  if (prior?.nextEligibleCheckAt && Date.parse(prior.nextEligibleCheckAt) > Date.parse(now)) return { kind: 'skipped', identity: prior };
  const direct = metadata?.spotify;
  if (direct?.id) return { kind: 'confirmed', identity: spotifyIdentity(metadata, { id: direct.id, url: direct.url, name: metadata.artistName }, now, 'musicbrainz_url_relation') };
  if (!usage.canCallSpotify()) return { kind: 'skipped', identity: prior || null };
  try {
    const token = await getToken(usage, fetchImpl);
    if (!usage.canCallSpotify()) return { kind: 'skipped', identity: prior || null };
    const url = `${config.SPOTIFY.searchUrl}?type=artist&limit=10&q=${encodeURIComponent(band.name)}`;
    await usage.recordSpotifyCall();
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 403) return { kind: 'unavailable', identity: retryableIdentity(prior, 'unavailable', now, 'capability_403') };
    if (res.status === 429 || res.status >= 500) return { kind: 'error', identity: retryableIdentity(prior, 'error', now, `http_${res.status}`) };
    if (!res.ok) return { kind: 'error', identity: retryableIdentity(prior, 'error', now, `http_${res.status}`) };
    const data = await res.json();
    const acceptedNames = new Set([band.name, metadata?.artistName, ...(metadata?.aliases || [])].map(norm).filter(Boolean));
    const candidates = (data?.artists?.items || []).filter((artist) => acceptedNames.has(norm(artist.name)) && !IMPERSONATOR.test(`${artist.name} ${artist.description || ''}`));
    if (candidates.length === 1) return { kind: 'confirmed', identity: spotifyIdentity(metadata, candidates[0], now) };
    return { kind: candidates.length ? 'needs_review' : 'no_match', identity: retryableIdentity(prior, candidates.length ? 'needs_review' : 'no_match', now) };
  } catch (error) {
    return { kind: 'error', identity: retryableIdentity(prior, 'error', now, error.message || 'request_failed') };
  }
}

async function spotifyRequest(url, usage, { fetchImpl = fetch, getToken = getAppToken } = {}) {
  if (!usage.canCallSpotify()) return { kind: 'skipped' };
  try {
    const token = await getToken(usage, fetchImpl);
    if (!usage.canCallSpotify()) return { kind: 'skipped' };
    await usage.recordSpotifyCall();
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return { kind: res.status === 403 ? 'unavailable' : 'error', status: res.status, retryAfter: res.headers?.get?.('retry-after') || null };
    return { kind: 'ok', data: await res.json() };
  } catch (error) { return { kind: 'error', error: error.message || 'request_failed' }; }
}

async function listArtistReleases(artistId, usage, { offset = 0, limit = 50, fetchImpl = fetch, getToken = getAppToken } = {}) {
  const url = `https://api.spotify.com/v1/artists/${encodeURIComponent(artistId)}/albums?include_groups=album,single&market=SE&limit=${limit}&offset=${offset}`;
  const result = await spotifyRequest(url, usage, { fetchImpl, getToken });
  if (result.kind !== 'ok') return result;
  if (!Array.isArray(result.data?.items)) return { kind: 'error', error: 'Invalid Spotify albums response' };
  return { kind: 'ok', items: result.data.items, total: result.data.total || 0, offset };
}

async function getReleaseTracks(releaseId, usage, options = {}) {
  return spotifyRequest(`https://api.spotify.com/v1/albums/${encodeURIComponent(releaseId)}/tracks?market=SE&limit=50`, usage, options);
}

const UNSUITABLE_TRACK = /\b(live|acoustic|remix|demo|karaoke|tribute|cover|instrumental)\b/i;

// This is intentionally stricter than the legacy historical-setlist linker:
// predictions already have a confirmed Spotify artist ID, so accepting a
// merely similar title would create an unsafe future playlist candidate.
function predictedTrackCandidate(track, song, spotifyArtistId) {
  if (!track || !artistMatches(track.artists, '', spotifyArtistId)) return false;
  if (normalizeTitle(track.name) !== normalizeTitle(song.name)) return false;
  return !/\b(karaoke|tribute|cover)\b/i.test(`${track.name || ''} ${track.album?.name || ''}`);
}

function predictedTrackFields(track) {
  return { spotifyTrackId: track.id, spotifyUri: track.uri || `spotify:track:${track.id}`, spotifyUrl: track.external_urls?.spotify || null, spotifyMatched: true };
}

async function matchPredictedSong(song, spotifyArtistId, usage, { bandName = '', fetchImpl = fetch, getToken = getAppToken } = {}) {
  if (!spotifyArtistId || !usage.canCallSpotify()) return { kind: 'skipped' };
  let token;
  try { token = await getToken(usage, fetchImpl); } catch (error) { return { kind: 'error', error: error.message }; }
  const cleanTitle = String(song.name || '').replace(/"/g, ''); const cleanBand = String(bandName || '').replace(/"/g, '');
  const queries = [cleanBand ? `track:"${cleanTitle}" artist:"${cleanBand}"` : `track:"${cleanTitle}"`, `track:"${cleanTitle}"`].filter((query, index, all) => all.indexOf(query) === index);
  for (const q of queries) {
    if (!usage.canCallSpotify()) return { kind: 'skipped' };
    const url = `${config.SPOTIFY.searchUrl}?type=track&limit=10&q=${encodeURIComponent(q)}`;
    let res;
    try { await usage.recordSpotifyCall(); res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } }); } catch (error) { return { kind: 'error', error: error.message }; }
    if (res.status === 429) return { kind: 'error', status: 429 };
    if (!res.ok) return { kind: 'error', status: res.status };
    let data; try { data = await res.json(); } catch (error) { return { kind: 'error', error: 'Invalid Spotify track JSON' }; }
    const candidates = (data?.tracks?.items || []).filter((track) => predictedTrackCandidate(track, song, spotifyArtistId));
    candidates.sort((a, b) => Number(UNSUITABLE_TRACK.test(`${a.name} ${a.album?.name || ''}`)) - Number(UNSUITABLE_TRACK.test(`${b.name} ${b.album?.name || ''}`)) || (b.popularity || 0) - (a.popularity || 0) || String(a.id).localeCompare(String(b.id)));
    if (candidates[0]) return { kind: 'ok', track: predictedTrackFields(candidates[0]) };
  }
  return { kind: 'no_match' };
}

module.exports = { resolveSongLinks, searchTrack, resolveArtistIdentity, listArtistReleases, getReleaseTracks, spotifyIdentity, retryableIdentity, artistMatches, predictedTrackCandidate, predictedTrackFields, matchPredictedSong };
