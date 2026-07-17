'use strict';
// setlist.fm REST API client — a separate, structured, free (non-commercial)
// API for real per-show setlists (song list, encore markers, cover-song
// tags). Unlike the Ticketmaster/Tavily/Groq tour-date and news pipeline,
// this needs no search step or LLM extraction at all: setlist.fm returns
// the setlist directly as JSON for a given artist+date, so a match is
// either found or it isn't — the whole lookup is a single request.
//
// Coverage is crowd-sourced (fans submit setlists after a show), so older
// or smaller/obscure shows may simply have nothing logged yet. A "not
// found" is expected and not an error — see research.js's
// setlistCheckedAt/re-check-window handling, which re-tries periodically
// rather than either giving up permanently or hammering the API on every
// run for a show that's unlikely to ever get one.

const config = require('./config');

function apiKey() {
  const k = process.env[config.SETLISTFM.apiKeyEnv];
  if (!k) throw new Error(`Missing required environment variable: ${config.SETLISTFM.apiKeyEnv}`);
  return k;
}

// setlist.fm's search API wants dd-MM-yyyy, not this app's own YYYY-MM-DD.
function toSetlistFmDate(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}-${m}-${y}`;
}

// Provider dates are dd-MM-yyyy. Never delegate this ambiguous format to
// Date.parse; internal consumers receive validated YYYY-MM-DD only.
function normalizeEventDate(value) {
  const text = String(value || ''); let match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
  let year; let month; let day;
  if (match) { [, day, month, year] = match; } else { match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text); if (!match) return null; [, year, month, day] = match; }
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day) ? `${year}-${month}-${day}` : null;
}

// Flattens setlist.fm's nested sets.set[].song[] shape into the flat
// { name, isEncore, isCover } array the app's setlistBlockHtml (app.js)
// already renders.
function normalizeSetlist(raw) {
  const setBlocks = raw?.sets?.set || [];
  const songs = [];
  for (const block of setBlocks) {
    const isEncore = !!block.encore;
    for (const song of block.song || []) {
      if (!song?.name) continue;
      songs.push({
        name: song.name,
        isEncore,
        isCover: !!song.cover,
      });
    }
  }
  return {
    songs,
    tourName: raw?.tour?.name || null,
    url: raw?.url || null,
    artistUrl: raw?.artist?.url || null,
  };
}

// Safety net, not the primary lookup key: setlist.fm's artist+date search
// can occasionally return more than one result if a band played twice in
// one day (rare, but real — festival sets across two stages). Loose
// substring match against the venue name already on file for this concert;
// falls back to "don't reject" if either side is missing, since a false
// negative here (discarding a real match) is worse than a rare false
// positive.
function venueMatches(setlistVenueName, expectedVenue) {
  if (!expectedVenue) return true;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const a = norm(setlistVenueName);
  const b = norm(expectedVenue);
  if (!a || !b) return true;
  return a === b || a.includes(b) || b.includes(a);
}

// Artist history is deliberately MBID-only.  The result is compacted before
// returning so callers never persist a provider payload.
async function findRecentSetlistsForArtist(artistMbid, usage, { fetchImpl = fetch } = {}) {
  if (!artistMbid || !usage.canCallSetlistfm()) return { kind: 'skipped' };
  await usage.recordSetlistfmCall();
  const url = `${config.SETLISTFM.baseUrl}/artist/${encodeURIComponent(artistMbid)}/setlists?p=1`;
  let res;
  try { res = await fetchImpl(url, { headers: { 'x-api-key': apiKey(), Accept: 'application/json' } }); }
  catch (error) { usage.note(`setlist.fm artist history failed: ${error.message}`); return { kind: 'error', error: error.message }; }
  if (res.status === 404) return { kind: 'ok', setlists: [] };
  if (!res.ok) return { kind: 'error', status: res.status };
  try {
    const data = await res.json();
    if (!Array.isArray(data?.setlist)) return { kind: 'error', error: 'Invalid setlist.fm artist history response' };
    return { kind: 'ok', setlists: data.setlist.slice(0, config.PREDICTED_SETLIST.historyMaxSetlists).map((raw) => ({ id: raw.id || null, eventDate: normalizeEventDate(raw.eventDate), venue: { id: raw.venue?.id || null, name: raw.venue?.name || null }, songs: normalizeSetlist(raw).songs })) };
  } catch (error) { return { kind: 'error', error: 'Invalid setlist.fm artist history JSON' }; }
}

// Bounded MBID-only pagination for actual-setlist context. Returned entries
// are compact normalized records; raw provider payloads are never persisted.
async function findHistoricalSetlistsForArtist(artistMbid, usage, { beforeDate, pageLimit = config.SETLIST_INSIGHTS.historyPageLimit, fetchImpl = fetch } = {}) {
  if (!artistMbid) return { kind: 'skipped', setlists: [] };
  const setlists = []; let reachedBeforeDate = false;
  for (let page = 1; page <= pageLimit; page++) {
    if (!usage.canCallSetlistfm()) return { kind: 'skipped', setlists, reachedBeforeDate };
    await usage.recordSetlistfmCall();
    let res;
    try { res = await fetchImpl(`${config.SETLISTFM.baseUrl}/artist/${encodeURIComponent(artistMbid)}/setlists?p=${page}`, { headers: { 'x-api-key': apiKey(), Accept: 'application/json' } }); }
    catch (error) { usage.note(`setlist.fm insight history failed: ${error.message}`); return { kind: 'error', setlists, reachedBeforeDate }; }
    if (res.status === 404) return { kind: 'ok', setlists, reachedBeforeDate: true };
    if (!res.ok) return { kind: 'error', status: res.status, setlists, reachedBeforeDate };
    let data; try { data = await res.json(); } catch { return { kind: 'error', setlists, reachedBeforeDate }; }
    if (!Array.isArray(data?.setlist)) return { kind: 'error', setlists, reachedBeforeDate };
    const compact = data.setlist.map((raw) => ({ id: raw.id || null, eventDate: normalizeEventDate(raw.eventDate), venue: { id: raw.venue?.id || null, name: raw.venue?.name || null }, tourName: raw.tour?.name || null, songs: normalizeSetlist(raw).songs }));
    setlists.push(...compact);
    if (compact.some((item) => item.eventDate && item.eventDate < beforeDate)) reachedBeforeDate = true;
    if (!compact.length || (reachedBeforeDate && setlists.filter((item) => item.eventDate && item.eventDate < beforeDate).length >= config.SETLIST_INSIGHTS.comparisonSetlistLimit)) break;
  }
  return { kind: 'ok', setlists, reachedBeforeDate };
}

// Returns a normalized { songs, tourName, url } object for the given
// concert, or null if no setlist is on file yet (or the lookup failed/was
// skipped) — callers treat null as "nothing to add this time", never as
// an error to surface to the user.
async function findSetlistForShow(concert, usage, { artistMbid = null, fetchImpl = fetch } = {}) {
  if (!usage.canCallSetlistfm()) {
    usage.note(`setlist.fm per-run/daily cap reached — skipping "${concert.bandName}" (${concert.date})`);
    return null;
  }
  await usage.recordSetlistfmCall();

  const url = new URL(`${config.SETLISTFM.baseUrl}/search/setlists`);
  if (artistMbid) url.searchParams.set('artistMbid', artistMbid);
  else url.searchParams.set('artistName', concert.bandName);
  url.searchParams.set('date', toSetlistFmDate(concert.date));
  url.searchParams.set('p', '1');

  let res;
  try {
    res = await fetchImpl(url.toString(), {
      headers: { 'x-api-key': apiKey(), Accept: 'application/json' },
    });
  } catch (e) {
    usage.note(`setlist.fm request failed for "${concert.bandName}" (${concert.date}): ${e.message}`);
    return null;
  }
  if (res.status === 404) return null; // setlist.fm's documented "no results" response
  if (!res.ok) {
    usage.note(`setlist.fm returned ${res.status} for "${concert.bandName}" (${concert.date})`);
    return null;
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    usage.note(`setlist.fm returned unparseable JSON for "${concert.bandName}" (${concert.date}): ${e.message}`);
    return null;
  }
  const candidates = data?.setlist || [];
  if (candidates.length === 0) return null;

  // An MBID lookup is only trustworthy when setlist.fm returns that same
  // artist.  Never fall back to a different artist from this response.
  const identityCandidates = artistMbid ? candidates.filter((s) => s?.artist?.mbid === artistMbid) : candidates;
  const match = identityCandidates.find((s) => venueMatches(s?.venue?.name, concert.venue)) || identityCandidates[0];
  if (!match) return null;
  const normalized = normalizeSetlist(match);
  return normalized.songs.length > 0 ? normalized : null;
}

module.exports = { findSetlistForShow, findRecentSetlistsForArtist, findHistoricalSetlistsForArtist, normalizeEventDate, normalizeSetlist, venueMatches };
