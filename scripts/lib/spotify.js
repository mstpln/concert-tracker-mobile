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

async function getAppToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.accessToken;
  const res = await fetch(config.SPOTIFY.tokenUrl, {
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
function artistMatches(candidateArtists, bandName) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const target = norm(bandName);
  if (!target) return true;
  return (candidateArtists || []).some((a) => {
    const n = norm(a?.name);
    return !!n && (n === target || n.includes(target) || target.includes(n));
  });
}

async function searchTrack(songTitle, bandName, usage) {
  if (!usage.canCallSpotify()) return null;
  const token = await getAppToken();
  const q = `track:"${songTitle.replace(/"/g, '')}" artist:"${bandName.replace(/"/g, '')}"`;
  const url = `${config.SPOTIFY.searchUrl}?type=track&limit=5&q=${encodeURIComponent(q)}`;

  await usage.recordSpotifyCall();
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    usage.note(`Spotify search failed for "${songTitle}" / "${bandName}": ${e.message}`);
    return null;
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after')) || 2;
    usage.note(`Spotify rate-limited — waiting ${retryAfter}s`);
    await sleep((retryAfter + 1) * 1000);
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
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
  const candidates = items.filter((t) => artistMatches(t.artists, bandName));
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
async function resolveSongLinks(songs, bandName, usage) {
  let added = 0;
  for (const song of songs) {
    if (song.isCover || song.spotifyChecked) continue;
    if (!usage.canCallSpotify()) break;
    try {
      const url = await searchTrack(song.name, bandName, usage);
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

module.exports = { resolveSongLinks };
