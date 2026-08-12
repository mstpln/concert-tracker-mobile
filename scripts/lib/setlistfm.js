'use strict';
// setlist.fm REST API client — a separate, structured, free (non-commercial)
// API for real per-show setlists (song list, encore markers, cover-song
// tags). Unlike the Ticketmaster/Tavily/Groq tour-date and news pipeline,
// this needs no search step or LLM extraction at all: setlist.fm returns
// the setlist directly as JSON for a given artist+date.
//
// Coverage is crowd-sourced (fans submit setlists after a show), so older
// or smaller/obscure shows may simply have nothing logged yet. DAB4 keeps
// genuine no-result outcomes distinct from provider/transport failure so
// callers only advance the 30-day checked marker after a trustworthy result.

const config = require('./config');
const { usefulEarlierSetlists } = require('./setlistInsights');

const TRUSTED_NO_MATCH_REASONS = new Set(['empty_results', 'empty_setlist']);

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

function normalizeIdentityText(value) {
  return String(value || '')
    .toLocaleLowerCase('en')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
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

// Historical helper contract used by prediction/insight callers: venue is a
// safety net, not the primary identity key, so missing provider venue text
// does not reject an otherwise usable record.
function venueMatches(setlistVenueName, expectedVenue) {
  if (!expectedVenue) return true;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const a = norm(setlistVenueName);
  const b = norm(expectedVenue);
  if (!a || !b) return true;
  return a === b || a.includes(b) || b.includes(a);
}

// The DAB4 per-show write path is deliberately stricter than the legacy
// helper above. A persisted actual setlist must have affirmative venue
// evidence whenever this concert already has a venue.
function strictVenueMatches(setlistVenueName, expectedVenue) {
  if (!expectedVenue) return true;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const a = norm(setlistVenueName);
  const b = norm(expectedVenue);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function candidateMatchesShow(candidate, concert, artistMbid = null) {
  if (!candidate || !concert) return false;
  if (normalizeEventDate(candidate.eventDate) !== concert.date) return false;
  if (artistMbid) {
    if (candidate?.artist?.mbid !== artistMbid) return false;
  } else if (normalizeIdentityText(candidate?.artist?.name) !== normalizeIdentityText(concert.bandName)) {
    return false;
  }
  return strictVenueMatches(candidate?.venue?.name, concert.venue);
}

// Artist history is deliberately MBID-only. The result is compacted before
// returning so callers never persist a provider payload. Preserve the
// established history contract where provider 404 means an exhausted/empty
// history; DAB4's stricter 404 treatment applies only to the actual-show
// search path below.
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
function usefulEarlierCount(setlists, beforeDate) { return usefulEarlierSetlists(setlists, beforeDate, Number.MAX_SAFE_INTEGER).length; }
async function findHistoricalSetlistsForArtist(artistMbid, usage, { beforeDate, pageLimit = config.SETLIST_INSIGHTS.historyPageLimit, fetchImpl = fetch } = {}) {
  if (!artistMbid) return { kind: 'skipped', setlists: [] };
  const setlists = []; let reachedBeforeDate = false; let providerExhausted = false; let pagesFetched = 0;
  for (let page = 1; page <= pageLimit; page++) {
    if (!usage.canCallSetlistfm()) return { kind: 'skipped', setlists, reachedBeforeDate, providerExhausted, historyComplete: false, usefulEarlierCount: usefulEarlierCount(setlists, beforeDate), pagesFetched };
    await usage.recordSetlistfmCall();
    let res; pagesFetched++;
    try { res = await fetchImpl(`${config.SETLISTFM.baseUrl}/artist/${encodeURIComponent(artistMbid)}/setlists?p=${page}`, { headers: { 'x-api-key': apiKey(), Accept: 'application/json' } }); }
    catch (error) { usage.note(`setlist.fm insight history failed: ${error.message}`); return { kind: 'error', setlists, reachedBeforeDate, pagesFetched }; }
    if (res.status === 404) return { kind: 'ok', setlists, reachedBeforeDate, providerExhausted: true, historyComplete: true, usefulEarlierCount: usefulEarlierCount(setlists, beforeDate), pagesFetched };
    if (!res.ok) return { kind: 'error', status: res.status, setlists, reachedBeforeDate, pagesFetched };
    let data; try { data = await res.json(); } catch { return { kind: 'error', setlists, reachedBeforeDate, pagesFetched }; }
    if (!Array.isArray(data?.setlist)) return { kind: 'error', setlists, reachedBeforeDate, pagesFetched };
    const compact = data.setlist.map((raw) => ({ id: raw.id || null, eventDate: normalizeEventDate(raw.eventDate), venue: { id: raw.venue?.id || null, name: raw.venue?.name || null }, tourName: raw.tour?.name || null, songs: normalizeSetlist(raw).songs }));
    setlists.push(...compact);
    if (compact.some((item) => item.eventDate && item.eventDate < beforeDate)) reachedBeforeDate = true;
    const total = Number(data.total); const itemsPerPage = Number(data.itemsPerPage); const providerPage = Number(data.page || page);
    providerExhausted = !compact.length || (Number.isFinite(total) && Number.isFinite(itemsPerPage) && providerPage * itemsPerPage >= total);
    if (providerExhausted || usefulEarlierCount(setlists, beforeDate) >= config.SETLIST_INSIGHTS.minimumUsefulPriorSetlists) break;
  }
  const usefulCount = usefulEarlierCount(setlists, beforeDate);
  return { kind: 'ok', setlists, reachedBeforeDate, providerExhausted, historyComplete: providerExhausted || usefulCount >= config.SETLIST_INSIGHTS.minimumUsefulPriorSetlists, usefulEarlierCount: usefulCount, pagesFetched };
}

// Returns a structured outcome. Only `found` and `no_match` are trustworthy
// provider outcomes that may advance the caller's recheck marker. `error` and
// `skipped` remain retryable and must not be persisted as absence.
async function findSetlistOutcomeForShow(concert, usage, { artistMbid = null, fetchImpl = fetch } = {}) {
  if (!usage.canCallSetlistfm()) {
    usage.note(`setlist.fm per-run/daily cap reached — skipping "${concert.bandName}" (${concert.date})`);
    return { kind: 'skipped', reason: 'usage_cap' };
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
    return { kind: 'error', error: e.message || 'network_error' };
  }
  // setlist.fm does not document this search-path 404 as a definitive
  // no-setlist signal, so treat it like every other HTTP failure and retry
  // on a later scheduled run rather than advancing the 30-day marker.
  if (!res.ok) {
    usage.note(`setlist.fm returned ${res.status} for "${concert.bandName}" (${concert.date})`);
    return { kind: 'error', status: res.status };
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    usage.note(`setlist.fm returned unparseable JSON for "${concert.bandName}" (${concert.date}): ${e.message}`);
    return { kind: 'error', error: 'invalid_json' };
  }
  if (!Array.isArray(data?.setlist)) return { kind: 'error', error: 'invalid_response' };
  const candidates = data.setlist;
  if (candidates.length === 0) return { kind: 'no_match', reason: 'empty_results' };

  const matching = candidates.filter((candidate) => candidateMatchesShow(candidate, concert, artistMbid));
  if (matching.length === 0) return { kind: 'error', error: 'show_identity_conflict' };
  if (matching.length > 1) return { kind: 'error', error: 'ambiguous_show_match' };
  const normalized = normalizeSetlist(matching[0]);
  return normalized.songs.length > 0
    ? { kind: 'found', setlist: normalized }
    : { kind: 'no_match', reason: 'empty_setlist' };
}

function applySetlistOutcome(concert, outcome, checkedAt = new Date().toISOString()) {
  if (!concert || !outcome) return { changed: false, found: false };
  if (outcome.kind === 'found') {
    if (!outcome.setlist || !Array.isArray(outcome.setlist.songs) || outcome.setlist.songs.length === 0) return { changed: false, found: false };
    concert.setlist = outcome.setlist;
    concert.setlistCheckedAt = checkedAt;
    return { changed: true, found: true };
  }
  if (outcome.kind !== 'no_match' || !TRUSTED_NO_MATCH_REASONS.has(outcome.reason)) return { changed: false, found: false };
  concert.setlistCheckedAt = checkedAt;
  return { changed: true, found: false };
}

// Keep the historical object-or-null contract for unrelated callers/tests.
// DAB4's scheduled enrichment path uses findSetlistOutcomeForShow directly.
async function findSetlistForShow(concert, usage, options = {}) {
  const outcome = await findSetlistOutcomeForShow(concert, usage, options);
  return outcome.kind === 'found' ? outcome.setlist : null;
}

module.exports = { findSetlistForShow, findSetlistOutcomeForShow, applySetlistOutcome, findRecentSetlistsForArtist, findHistoricalSetlistsForArtist, usefulEarlierCount, normalizeEventDate, normalizeSetlist, venueMatches, candidateMatchesShow };
