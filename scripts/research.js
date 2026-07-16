'use strict';
// Weekly research pipeline — run by .github/workflows/research.yml.
//
// For every band in bands.json:
//   1. Ask Ticketmaster for upcoming events (structured, trusted, cheap).
//   2. Only if Ticketmaster found nothing: fall back to a Tavily search +
//      Groq extraction for tour dates, discarding anything without an
//      explicit full date (mandatory-year policy — never guess).
//   3. One combined Tavily news search + Groq classification into the four
//      news categories, with the documented relaxed/strict sourcing rules.
// Then, once per run: check setlist.fm for any attended-past concert that
// doesn't have a setlist yet (see the "Setlists" section below) — this is
// what backfills the ~57 already-attended past shows the very first time
// this runs, and keeps picking up newly-past "going" shows every week after
// that. There is deliberately no manual/paste-a-link entry path anywhere in
// the app — setlist data only ever arrives through this automatic run.
//
// Every external call is gated through usageTracker so this can never
// exceed (self-imposed, below-free-tier) hard caps, and every provider
// call is paced to respect real-time rate limits. New concerts/news are
// APPENDED ONLY — nothing already in concerts.json/news.json is ever
// edited or removed by this script (setlist data is the one exception:
// it fills in `setlist`/`setlistCheckedAt` on an existing concert record
// in place, since there's nowhere else for it to live).

const worker = require('./lib/workerClient');
const { UsageTracker } = require('./lib/usageTracker');
const ticketmaster = require('./lib/ticketmaster');
const tavily = require('./lib/tavily');
const groq = require('./lib/groq');
const geocode = require('./lib/geocode');
const setlistfm = require('./lib/setlistfm');
const spotify = require('./lib/spotify');
const musicbrainz = require('./lib/musicbrainz');
const structured = require('./lib/structuredResearch');
const predictedSetlist = require('./lib/predictedSetlist');
const { slugify, isValidFullDate, daysAgo, truncate, todayIso } = require('./lib/util');
const config = require('./lib/config');

// How long to wait before re-checking a past-attended show that didn't have
// a setlist logged last time — setlist.fm is crowd-sourced, so a fan may
// submit one weeks after the actual show. Not a permanent give-up: cheap
// enough (one request) to just keep checking periodically forever.
const SETLIST_RECHECK_DAYS = 30;

const NEWS_CATEGORIES = new Set(['concert', 'album', 'ticket', 'hiatus']);

function musicbrainzEligible(band, now = Date.now()) {
  const mb = band.musicbrainz || {};
  if (['manual_confirmed', 'auto_confirmed', 'manual_rejected', 'needs_review'].includes(mb.status)) return false;
  return !(mb.status === 'no_match' && mb.lastAttemptedAt && now - new Date(mb.lastAttemptedAt).getTime() < config.MUSICBRAINZ.noMatchRetryDays * 86400000);
}

function mergeMusicbrainzResults(latestBands, updates) {
  const byId = new Map(updates.map((u) => [u.id, u.musicbrainz]));
  return latestBands.map((band) => {
    const update = byId.get(band.id);
    if (!update || ['manual_confirmed', 'manual_rejected'].includes(band.musicbrainz?.status)) return band;
    return { ...band, musicbrainz: update };
  });
}

// Isolated so disabled-mode behavior is testable without starting the full
// research workflow or touching its other providers.
async function processMusicbrainzIdentities({
  bands,
  usage,
  enabled = config.MUSICBRAINZ.enabled,
  perRunCap = config.MUSICBRAINZ.perRunCap,
  searchArtist = musicbrainz.searchArtist,
  identityResult = musicbrainz.identityResult,
  readBands = worker.readJson,
  writeBands = worker.writeJson,
  mergeResults = mergeMusicbrainzResults,
}) {
  if (!enabled) return { enabled: false, updates: 0 };
  const identityUpdates = [];
  let fatalError = null;
  for (const band of bands.filter(musicbrainzEligible).slice(0, perRunCap)) {
    const result = await searchArtist(band, usage);
    // A quota/cap skip made no provider request, so it must never be
    // translated into a no-match decision or written back to the band.
    if (result.kind === 'skipped') break;
    const identity = identityResult(band, result);
    if (identity) identityUpdates.push({ id: band.id, musicbrainz: identity });
    if (result.kind === 'fatal') {
      if (result.error) usage.note(result.error);
      fatalError = result.error || 'MusicBrainz provider failed';
      break;
    }
  }
  if (identityUpdates.length) {
    const latestBands = await readBands('bands.json', []);
    await writeBands('bands.json', mergeResults(latestBands, identityUpdates));
  }
  return fatalError ? { enabled: true, updates: identityUpdates.length, fatalError } : { enabled: true, updates: identityUpdates.length };
}

// Runs only behind STRUCTURED_RESEARCH.enabled.  It refreshes compact,
// additive provider identity/release state and performs safe full-document
// merges by stable band id.  It intentionally does not touch concerts and
// never stores provider payloads.
async function processStructuredResearch({
  bands, news, usage, enabled = config.STRUCTURED_RESEARCH.enabled,
  readBands = worker.readJson, writeBands = worker.writeJson, readNews = worker.readJson, writeNews = worker.writeJson,
  fetchArtistMetadata = musicbrainz.fetchArtistMetadata, fetchReleaseGroups = musicbrainz.fetchReleaseGroups,
  resolveSpotify = spotify.resolveArtistIdentity, resolveTicketmaster = ticketmaster.resolveAttractionIdentity,
  listSpotifyReleases = spotify.listArtistReleases, getSpotifyTracks = spotify.getReleaseTracks, now = new Date().toISOString(),
}) {
  if (!enabled) return { enabled: false, bands, news, updates: 0, alerts: 0 };
  const updates = [];
  const alerts = [];
  for (const band of bands) {
    const mb = band.musicbrainz;
    if (!mb?.mbid || !['manual_confirmed', 'auto_confirmed'].includes(mb.status)) continue;
    const metadataFresh = mb.metadata?.lastSuccessfulAt && Date.parse(mb.metadata.lastSuccessfulAt) + config.STRUCTURED_RESEARCH.artistMetadataRefreshDays * 86400000 > Date.parse(now);
    let metadata = mb.metadata?.artistName ? mb.metadata : null;
    if (!metadataFresh) {
      const result = await fetchArtistMetadata(mb.mbid, usage);
      if (result.kind === 'ok') metadata = { ...result.metadata, lastAttemptedAt: now, lastSuccessfulAt: now, nextEligibleCheckAt: null, errorCategory: null };
      else if (result.kind !== 'skipped') metadata = { ...(metadata || {}), lastAttemptedAt: now, nextEligibleCheckAt: new Date(Date.parse(now) + config.STRUCTURED_RESEARCH.temporaryErrorRetryHours * 3600000).toISOString(), errorCategory: result.error || 'request_failed' };
    }
    const nextMb = { ...mb, ...(metadata ? { metadata } : {}) };
    if (config.STRUCTURED_RESEARCH.providerIdentityResolutionEnabled && metadata) {
      const spotifyResult = await resolveSpotify({ band: { ...band, musicbrainz: nextMb }, metadata, usage, now });
      if (spotifyResult.identity) nextMb.spotify = spotifyResult.identity;
      const ticketmasterResult = await resolveTicketmaster({ band: { ...band, musicbrainz: nextMb }, metadata, usage, now });
      if (ticketmasterResult.identity) nextMb.ticketmaster = ticketmasterResult.identity;
    }
    let releases = structured.releaseState(band);
    if (config.STRUCTURED_RESEARCH.structuredReleaseMonitoringEnabled) {
      const observed = [];
      const priorMbBaseline = structured.providerBaseline(releases, 'musicbrainz');
      if (!priorMbBaseline.nextEligibleCheckAt || Date.parse(priorMbBaseline.nextEligibleCheckAt) <= Date.parse(now)) {
        const result = await fetchReleaseGroups(mb.mbid, usage, { offset: priorMbBaseline.continuation?.offset || 0 });
        if (result.kind === 'ok') {
          const values = result.releaseGroups.map((raw) => structured.musicbrainzRelease(raw, mb.mbid)).filter(Boolean);
          observed.push(...values);
          const complete = result.offset + result.releaseGroups.length >= result.count || result.releaseGroups.length === 0;
          const newItems = structured.newReleasesAfterBaseline(priorMbBaseline, values);
          releases = { ...releases, musicbrainz: structured.updateProviderBaseline(priorMbBaseline, values, { complete, now, continuation: complete ? null : { offset: result.offset + result.releaseGroups.length } }), observations: structured.mergeReleaseList([...(releases.observations || []), ...values]).slice(-500) };
          for (const release of newItems) if (!structured.newsHasRelease(news, band.id, release)) alerts.push(structured.structuredNewsItem(band, release, now));
        } else if (result.kind !== 'skipped') releases = { ...releases, musicbrainz: structured.updateProviderBaseline(priorMbBaseline, [], { complete: false, now, errorCategory: result.kind === 'unavailable' ? 'unavailable' : 'error', continuation: priorMbBaseline.continuation }) };
      }
      const spotifyId = nextMb.spotify?.status === 'confirmed' ? nextMb.spotify.id : null;
      const priorSpotifyBaseline = structured.providerBaseline(releases, 'spotify');
      if (spotifyId && (!priorSpotifyBaseline.nextEligibleCheckAt || Date.parse(priorSpotifyBaseline.nextEligibleCheckAt) <= Date.parse(now))) {
        const result = await listSpotifyReleases(spotifyId, usage, { offset: priorSpotifyBaseline.continuation?.offset || 0 });
        if (result.kind === 'ok') {
          const values = result.items.map((raw) => structured.spotifyRelease(raw, spotifyId)).filter(Boolean);
          const complete = result.offset + result.items.length >= result.total || result.items.length === 0;
          const newItems = structured.newReleasesAfterBaseline(priorSpotifyBaseline, values);
          // Track data is intentionally narrow: only a genuinely new,
          // eligible Spotify single receives one compact track-list request.
          // Baselines and unchanged catalogue entries never fan out.
          for (const release of newItems.filter((release) => release.type === 'Single' && release.spotifyReleaseId)) {
            const tracks = await getSpotifyTracks(release.spotifyReleaseId, usage);
            if (tracks.kind === 'ok') release.tracks = (tracks.data?.items || []).map((track) => track?.name).filter(Boolean).slice(0, 50);
          }
          releases = { ...releases, spotify: structured.updateProviderBaseline(priorSpotifyBaseline, values, { complete, now, continuation: complete ? null : { offset: result.offset + result.items.length } }), observations: structured.mergeReleaseList([...(releases.observations || []), ...values]).slice(-500) };
          for (const release of newItems) if (!structured.newsHasRelease(news, band.id, release)) alerts.push(structured.structuredNewsItem(band, release, now));
        } else if (result.kind !== 'skipped') releases = { ...releases, spotify: structured.updateProviderBaseline(priorSpotifyBaseline, [], { complete: false, now, errorCategory: result.kind === 'unavailable' ? 'unavailable' : 'error', continuation: priorSpotifyBaseline.continuation }) };
      }
    }
    updates.push({ id: band.id, musicbrainz: nextMb, structuredResearch: { ...(band.structuredResearch || {}), releases } });
  }
  const meaningful = updates.filter((update) => {
    const before = bands.find((band) => band.id === update.id);
    return JSON.stringify(before?.musicbrainz) !== JSON.stringify(update.musicbrainz) || JSON.stringify(before?.structuredResearch) !== JSON.stringify(update.structuredResearch);
  });
  let mergedBands = bands;
  if (meaningful.length) {
    const latest = await readBands('bands.json', []);
    mergedBands = structured.mergeStructuredBandUpdates(latest, meaningful);
    await writeBands('bands.json', mergedBands);
  }
  const validAlerts = alerts.filter(Boolean);
  let mergedNews = news;
  if (validAlerts.length) {
    const latestNews = await readNews('news.json', []);
    mergedNews = [...latestNews];
    for (const alert of validAlerts) if (!structured.newsHasRelease(mergedNews, alert.bandId, alert)) mergedNews.push(alert);
    if (mergedNews.length !== latestNews.length) await writeNews('news.json', mergedNews);
  }
  return { enabled: true, bands: mergedBands, news: mergedNews, updates: meaningful.length, alerts: validAlerts.length };
}

function confirmedMbid(band) {
  const mb = band?.musicbrainz;
  return !!(mb?.mbid && ['manual_confirmed', 'auto_confirmed'].includes(mb.status));
}

function predictedSetlistEligible(concert, band, now = new Date()) {
  return !!(concert?.attending && concert.date && concert.date >= now.toISOString().slice(0, 10) && confirmedMbid(band));
}

function predictionDue(prediction, now = new Date()) {
  if (!prediction || prediction.status !== 'ready' || !prediction.generatedAt) return true;
  return Date.parse(prediction.generatedAt) + config.PREDICTED_SETLIST.refreshDays * 86400000 <= now.getTime();
}

function mergePredictedSetlistResults(latestConcerts, updates) {
  const byId = new Map(updates.map((update) => [update.id, update.predictedSetlist]));
  return latestConcerts.map((concert) => byId.has(concert.id) ? { ...concert, predictedSetlist: byId.get(concert.id) } : concert);
}

// MBID histories are shared by a band's upcoming concerts.  The latest
// document is fetched only at write time and only predictedSetlist changes.
async function processPredictedSetlists({
  concerts, bands, usage, enabled = config.PREDICTED_SETLIST.enabled, now = new Date(),
  findHistory = setlistfm.findRecentSetlistsForArtist, generate = predictedSetlist.generatePrediction,
  matchSong = spotify.matchPredictedSong, readConcerts = worker.readJson, writeConcerts = worker.writeJson,
}) {
  if (!enabled) return { enabled: false, updates: 0 };
  const bandsById = new Map(bands.map((band) => [band.id, band]));
  const historyByMbid = new Map(); const updates = [];
  const eligible = concerts.filter((concert) => predictedSetlistEligible(concert, bandsById.get(concert.bandId), now) && predictionDue(concert.predictedSetlist, now)).sort((a, b) => a.date.localeCompare(b.date));
  for (const concert of eligible) {
    const band = bandsById.get(concert.bandId); const mbid = band.musicbrainz.mbid;
    let history = historyByMbid.get(mbid);
    if (!history) { history = await findHistory(mbid, usage); historyByMbid.set(mbid, history); }
    if (history.kind === 'skipped') break;
    if (history.kind !== 'ok') {
      if (concert.predictedSetlist?.status === 'ready') continue; // never replace a useful result with transient failure
      updates.push({ id: concert.id, predictedSetlist: { ...(concert.predictedSetlist || {}), status: 'error', lastAttemptedAt: now.toISOString(), songs: concert.predictedSetlist?.songs || [] } });
      continue;
    }
    const next = generate(history.setlists, { now });
    next.generatedAt = next.status === 'ready' ? now.toISOString() : null;
    next.lastAttemptedAt = now.toISOString(); next.sourceArtistMbid = mbid;
    next.spotifyMatchedCount = 0;
    const spotifyId = band.musicbrainz?.spotify?.status === 'confirmed' ? band.musicbrainz.spotify.id : null;
    if (next.status === 'ready' && spotifyId) {
      for (const song of next.songs) {
        const result = await matchSong(song, spotifyId, usage);
        if (result.kind === 'ok') Object.assign(song, result.track);
        if (result.kind === 'skipped' || result.kind === 'error') break;
      }
      next.spotifyMatchedCount = next.songs.filter((song) => song.spotifyMatched).length;
    }
    const prior = concert.predictedSetlist;
    if (prior?.status === next.status && prior?.fingerprint === next.fingerprint) continue;
    updates.push({ id: concert.id, predictedSetlist: next });
  }
  if (!updates.length) return { enabled: true, updates: 0 };
  const latest = await readConcerts('concerts.json', []);
  const merged = mergePredictedSetlistResults(latest, updates);
  if (JSON.stringify(latest) !== JSON.stringify(merged)) await writeConcerts('concerts.json', merged);
  return { enabled: true, updates: updates.length };
}

function concertKey(c) {
  return `${c.bandId}|${c.date}|${slugify(c.venue || '')}`;
}

function newsKey(n) {
  return `${n.bandId}|${n.category}|${(n.headline || '').toLowerCase().trim()}`;
}

// Result count and per-snippet length are both deliberately small — Groq's
// free tier is bounded by total tokens/DAY (200k), which is the real
// constraint for a ~150-call weekly run, not tokens/minute. Trimming input
// size here is what makes covering every band each week affordable.
const TAVILY_TOUR_DATE_MAX_RESULTS = 3;
const TAVILY_NEWS_MAX_RESULTS = 4;
const SNIPPET_MAX_CHARS = 300;
const TOUR_DATE_ESTIMATED_TOKENS = 900;
const NEWS_ESTIMATED_TOKENS = 1100;

function promisingTavilyResults(results) {
  return results.some((result) => /\d{4}|tour|concert|festival|tickets?/i.test(`${result?.title || ''} ${result?.content || ''}`));
}

async function fetchTourDatesViaTavily(band, usage, { allowGroq = true, seenFingerprints = new Set(), onFingerprints = null } = {}) {
  const searchResult = await tavily.search(`${band.name} tour dates concert announcement`, usage, {
    maxResults: TAVILY_TOUR_DATE_MAX_RESULTS,
  });
  if (!searchResult || searchResult.results.length === 0 || !allowGroq || !promisingTavilyResults(searchResult.results)) return [];
  const fingerprints = searchResult.results.map((result) => structured.resultFingerprint(result, 'tour'));
  if (fingerprints.every((fingerprint) => seenFingerprints.has(fingerprint))) return [];

  const snippets = searchResult.results
    .map((r, i) => `[${i}] ${r.title}\nURL: ${r.url}\n${truncate(r.content, SNIPPET_MAX_CHARS)}`)
    .join('\n\n');

  const today = todayIso();
  const systemPrompt = [
    'You extract confirmed UPCOMING (not past) concert dates for a specific band from search-result snippets.',
    `Today's date is ${today}. This is critical: search results often describe shows that have ALREADY HAPPENED (tour recaps, reviews, "last night" reporting) — only include a show if its date is on or after today's date. When in doubt about whether a show is in the past, leave it out.`,
    'Rules:',
    '- Only include a show if the source explicitly states a full calendar date including the YEAR.',
    '- If a date has no explicit year stated anywhere in the text, DO NOT GUESS OR INFER a year — omit that show entirely.',
    `- If the date is before ${today}, omit it — this tool only tracks upcoming shows, never past ones.`,
    '- Only include shows for the exact band named by the user, not support acts, or unrelated artists. Watch especially for tribute/cover/parody acts that reuse the real band\'s name with an extra qualifier word — e.g. "Ultimate <band>", "<band> Tribute", "Not <band>", "The <band> Experience" — these are impersonator acts, not the real band, even though the name looks similar. If the billing includes any such qualifier, or the event is part of an obvious multi-act tribute/nostalgia festival, leave it out.',
    '- Respond with a JSON object: {"shows": [{"venue": "", "city": "", "country": "", "date": "YYYY-MM-DD", "sourceUrl": ""}]}',
    '- If nothing qualifies, respond with {"shows": []}.',
  ].join('\n');

  const userPrompt = `Band: ${band.name}\nToday's date: ${today}\n\nSearch results:\n${snippets}`;

  const parsed = await groq.chatJson(systemPrompt, userPrompt, usage, {
    estimatedTokens: TOUR_DATE_ESTIMATED_TOKENS,
  });
  if (parsed) onFingerprints?.(fingerprints);
  const shows = Array.isArray(parsed?.shows) ? parsed.shows : [];
  // Defensive filter, independent of what the model was told: never trust
  // the LLM alone to enforce "upcoming only" — this is the second layer of
  // whatever the merge-time check in main() also does.
  const valid = shows.filter((s) => isValidFullDate(s.date) && s.venue && s.date >= today);

  // Sequential, not Promise.all — geocode.js rate-limits itself to 1
  // req/sec per Nominatim's usage policy, so concurrent calls would just
  // queue up behind the same limiter anyway.
  const results = [];
  for (const s of valid) {
    let distanceKm = null;
    try {
      distanceKm = await geocode.distanceKmForCity(s.city, s.country);
    } catch (e) {
      usage.note(`Geocoding failed for "${s.city}, ${s.country}": ${e.message}`);
    }
    results.push({
      id: `${band.id}-${s.date}-${slugify(s.city || s.venue)}`,
      bandId: band.id,
      bandName: band.name,
      venue: s.venue,
      city: s.city || '',
      country: s.country || '',
      date: s.date,
      time: null,
      distanceKm, // geocoded via Nominatim when possible; left null rather than guessed if not
      articleUrl: s.sourceUrl || null,
      ticketUrl: null,
      ticketRetailerVerified: false,
      isNew: true,
      foundAt: new Date().toISOString(),
      venueAddress: null,
    });
  }
  return results;
}

async function fetchNewsForBand(band, usage, { category = 'legacy', allowGroq = true, seenFingerprints = new Set(), onFingerprints = null } = {}) {
  const query = category === 'status'
    ? `${band.name} hiatus breakup reunion lineup announcement`
    : category === 'release'
      ? `${band.name} new album EP single announcement`
      : `${band.name} news`;
  const searchResult = await tavily.search(query, usage, {
    maxResults: TAVILY_NEWS_MAX_RESULTS,
    topic: 'news',
    days: 21,
  });
  if (!searchResult || searchResult.results.length === 0 || !allowGroq || !promisingTavilyResults(searchResult.results)) return [];
  const fingerprints = searchResult.results.map((result) => structured.resultFingerprint(result, category));
  if (fingerprints.every((fingerprint) => seenFingerprints.has(fingerprint))) return [];

  const snippets = searchResult.results
    .map(
      (r, i) =>
        `[${i}] ${r.title}\nURL: ${r.url}\nPublished: ${r.publishedDate || 'unknown'}\n${truncate(r.content, SNIPPET_MAX_CHARS)}`
    )
    .join('\n\n');

  const systemPrompt = [
    'You classify recent news search results about a music band into a strict JSON schema, for a fan tracking app.',
    'Categories (a result may fit zero, one, or in rare cases more than one):',
    '- "concert": a specific new show/tour has been announced (need a checkable fact — a date and/or venue).',
    '- "album": a new album/EP/single has been announced or released (need the specific title).',
    '- "ticket": tickets for a show just went on sale, or an on-sale date was announced (need a checkable date or link).',
    '- "hiatus": band status news — breakup, hiatus, reunion, lineup change, etc.',
    'Sourcing rules:',
    '- concert/album/ticket: relaxed — include if there is one concrete, specific, checkable fact in the snippet, regardless of how obscure the outlet is.',
    '- hiatus: STRICT — only include if backed by a direct quote/statement from the band or label, OR the same claim appears independently in 2+ of the provided results. A single unconfirmed/rumor-style mention must be dropped.',
    '- Ignore anything that is not genuinely about this specific band, or that is older than ~21 days with no update.',
    'Respond with a JSON object: {"items": [{"category": "concert|album|ticket|hiatus", "headline": "", "sourceUrl": "", "sourceName": "", "date": "YYYY-MM-DD or null if not applicable"}]}',
    'If nothing qualifies, respond with {"items": []}.',
  ].join('\n');

  const userPrompt = `Band: ${band.name}\nToday's date: ${todayIso()}\n\nSearch results:\n${snippets}`;

  const parsed = await groq.chatJson(systemPrompt, userPrompt, usage, {
    estimatedTokens: NEWS_ESTIMATED_TOKENS,
  });
  if (parsed) onFingerprints?.(fingerprints);
  const items = Array.isArray(parsed?.items) ? parsed.items : [];

  return items
    .filter((n) => NEWS_CATEGORIES.has(n.category) && n.headline)
    .map((n) => ({
      id: `${band.id}-${n.category}-${slugify(n.headline).slice(0, 60)}`,
      bandId: band.id,
      bandName: band.name,
      category: n.category,
      headline: n.headline,
      sourceUrl: n.sourceUrl || null,
      sourceName: n.sourceName || null,
      date: isValidFullDate(n.date) ? n.date : null,
      foundAt: new Date().toISOString(),
    }));
}

// Shared with the top-level .catch() below so a failed run's real,
// already-recorded API usage doesn't get lost — see the comment there.
let sharedUsage = null;

async function main() {
  console.log('Concert Tracker research pipeline starting…');

  let [bands, concerts, news, usage] = await Promise.all([
    worker.readJson('bands.json', []),
    worker.readJson('concerts.json', []),
    worker.readJson('news.json', []),
    UsageTracker.load(),
  ]);
  sharedUsage = usage;

  // Disabled by default; this cannot alter existing concert/news lookups.
  await processMusicbrainzIdentities({ bands, usage });

  // Keep the legacy flow byte-for-byte in effect while the master flag is
  // off.  When later enabled, confirmed MBIDs can seed provider IDs and
  // silent release baselines without a separate migration or data file.
  const structuredRun = await processStructuredResearch({ bands, news, usage });
  bands = structuredRun.bands;
  news = structuredRun.news;
  await processPredictedSetlists({ concerts, bands, usage });

  const existingConcertIds = new Set(concerts.map((c) => c.id));
  const existingConcertKeys = new Set(concerts.map(concertKey));
  const existingNewsKeys = new Set(news.map(newsKey));

  // Rotate the starting point each run — see the comment on `rotation` in
  // usageTracker.js. Ticketmaster is cheap and always covers every band
  // regardless of order, but the Tavily/Groq-gated news step can run out
  // of budget partway through; rotating means that cutoff lands somewhere
  // different each week instead of always excluding the same tail-end
  // bands.
  const rotationOffset = bands.length > 0 ? usage.state.rotation.nextBandIndex % bands.length : 0;
  const orderedBands = [...bands.slice(rotationOffset), ...bands.slice(0, rotationOffset)];

  const newConcerts = [];
  const newNews = [];
  let bandsProcessed = 0;
  let ticketmasterHits = 0;
  let tavilyFallbackUsed = 0;
  let newsAttemptCount = 0;
  let newsBudgetExhaustedNoted = false;
  const routingUpdates = new Map();
  const structuredEnabled = config.STRUCTURED_RESEARCH.enabled;

  for (const band of orderedBands) {
    bandsProcessed += 1;

    // ---- Tour dates: Ticketmaster first ----
    let candidates = [];
    try {
      candidates = await ticketmaster.fetchUpcomingEvents(band, usage);
    } catch (e) {
      usage.note(`Ticketmaster lookup failed for "${band.name}": ${e.message}`);
    }

    if (candidates.length > 0) ticketmasterHits += 1;

    // Legacy runs retain the broad supplement.  Structured runs instead use
    // the due-only cadence and record why a call was made or skipped.
    //
    // Used to be an `else if` — only run when Ticketmaster found literally
    // nothing for the band. Changed 2026-07-13 after a real gap: a band on
    // a genuine world tour (The Strokes, 2026) had Ticketmaster return a
    // full page of North American dates (so candidates.length > 0), which
    // skipped this fallback entirely — silently dropping 11 real shows that
    // were sold through non-Ticketmaster channels Ticketmaster's own
    // Discovery API doesn't cover for this act (Japanese festival dates
    // sold via local promoters, several European arena dates). Ticketmaster
    // returning *some* results for a band is no guarantee it returned *all*
    // of them, so this now always runs as a supplement, not a replacement —
    // dedup below (existingConcertIds/existingConcertKeys) already makes it
    // safe to run both sources and merge, since anything Ticketmaster
    // already found here gets skipped as a duplicate rather than double
    // counted. This does mean Tavily/Groq budget gets spent on every band
    // with tour-date activity instead of only the ones Ticketmaster missed
    // entirely — acceptable, since the per-run/monthly caps already bound
    // the worst case, and the existing "budget exhausted" path below simply
    // means some bands go without a news check that particular week rather
    // than anything ever exceeding a free-tier limit.
    const tourReason = structuredEnabled ? (config.STRUCTURED_RESEARCH.targetedTavilyRoutingEnabled ? structured.tavilyEligibility(band, 'tour', { ticketmasterFound: candidates.length > 0 }) : null) : 'legacy_tour_search';
    if (!tourReason && structuredEnabled) usage.recordStructured('skips', 'category_not_due');
    if (tourReason && usage.canCallTavily() && (!structuredEnabled || usage.canCallGroq(TOUR_DATE_ESTIMATED_TOKENS))) {
      try {
        if (structuredEnabled) usage.recordStructured('tavilyByReason', tourReason);
        const remembered = new Set(band.structuredResearch?.routing?.groqFingerprints || []);
        const remember = (fingerprints) => {
          const previous = routingUpdates.get(band.id) || band.structuredResearch?.routing || {};
          routingUpdates.set(band.id, { ...previous, groqFingerprints: [...new Set([...(previous.groqFingerprints || []), ...fingerprints])].slice(-100) });
        };
        const supplemental = await fetchTourDatesViaTavily(band, usage, { allowGroq: !structuredEnabled || config.STRUCTURED_RESEARCH.groqFallbackEnabled, seenFingerprints: remembered, onFingerprints: structuredEnabled ? remember : null });
        if (structuredEnabled) routingUpdates.set(band.id, { ...(routingUpdates.get(band.id) || band.structuredResearch?.routing || {}), lastTavilyTourAt: new Date().toISOString(), lastTavilyTourReason: tourReason });
        if (supplemental.length > 0) {
          tavilyFallbackUsed += 1;
          candidates = candidates.concat(supplemental);
        }
      } catch (e) {
        usage.note(`Tavily/Groq tour-date fallback failed for "${band.name}": ${e.message}`);
      }
    }

    for (const c of candidates) {
      if (existingConcertIds.has(c.id) || existingConcertKeys.has(concertKey(c))) continue;
      // Third, final layer of the upcoming-only guarantee — independent of
      // Ticketmaster's own filtering and of what the Tavily/Groq fallback
      // was told. Nothing with a past date is ever written, regardless of
      // where it came from or what bug either upstream source might have.
      // Recomputed fresh on every candidate rather than once at the top of
      // main(): a full run can take hours (see research.yml's 300-minute
      // timeout and the deliberate Groq TPM throttling), so a date snapshot
      // taken at run-start could be stale by the time later bands are
      // processed, right on a UTC-midnight boundary.
      if (!c.date || c.date < todayIso()) {
        usage.note(`Dropped past-dated candidate for "${c.bandName}": ${c.date} at ${c.venue} (source: ${c.ticketRetailerVerified ? 'Ticketmaster' : 'Tavily/Groq'})`);
        continue;
      }
      existingConcertIds.add(c.id);
      existingConcertKeys.add(concertKey(c));
      newConcerts.push(c);
    }

    // Legacy mode retains the combined broad search.  Structured mode only
    // asks about specific status changes; release announcements are a
    // fallback category and never replace structured release monitoring.
    const statusReason = structuredEnabled ? (config.STRUCTURED_RESEARCH.targetedTavilyRoutingEnabled ? structured.tavilyEligibility(band, 'status') : null) : 'legacy_news_search';
    if (statusReason && usage.canCallTavily() && (!structuredEnabled || usage.canCallGroq(NEWS_ESTIMATED_TOKENS))) {
      newsAttemptCount += 1;
      try {
        if (structuredEnabled) usage.recordStructured('tavilyByReason', statusReason);
        const remembered = new Set(band.structuredResearch?.routing?.groqFingerprints || []);
        const remember = (fingerprints) => { const previous = routingUpdates.get(band.id) || band.structuredResearch?.routing || {}; routingUpdates.set(band.id, { ...previous, groqFingerprints: [...new Set([...(previous.groqFingerprints || []), ...fingerprints])].slice(-100) }); };
        const items = await fetchNewsForBand(band, usage, { category: structuredEnabled ? 'status' : 'legacy', allowGroq: !structuredEnabled || config.STRUCTURED_RESEARCH.groqFallbackEnabled, seenFingerprints: remembered, onFingerprints: structuredEnabled ? remember : null });
        if (structuredEnabled) routingUpdates.set(band.id, { ...(routingUpdates.get(band.id) || band.structuredResearch?.routing || {}), lastTavilyStatusAt: new Date().toISOString(), lastTavilyStatusReason: statusReason });
        for (const n of items) {
          const key = newsKey(n);
          if (existingNewsKeys.has(key)) continue;
          existingNewsKeys.add(key);
          newNews.push(n);
        }
      } catch (e) {
        usage.note(`News research failed for "${band.name}": ${e.message}`);
      }
    } else if (!newsBudgetExhaustedNoted && !structuredEnabled) {
      // Tavily/Groq budget for this run is used up — keep going so the
      // remaining bands still get their (free, cheap) Ticketmaster tour-date
      // check; they just won't get a news check until next week's run.
      usage.note('Tavily/Groq run budget exhausted — skipping news research for remaining bands this run');
      newsBudgetExhaustedNoted = true;
    }

    // Only fill a structured-provider gap; do not use Tavily to rediscover
    // ordinary catalogue releases already covered by MusicBrainz/Spotify.
    const releaseState = band.structuredResearch?.releases || {};
    const structuredReleaseSufficient = releaseState.musicbrainz?.status === 'complete' || releaseState.spotify?.status === 'complete';
    const releaseReason = structuredEnabled && config.STRUCTURED_RESEARCH.targetedTavilyRoutingEnabled && !structuredReleaseSufficient ? structured.tavilyEligibility(band, 'release') : null;
    if (releaseReason && usage.canCallTavily() && usage.canCallGroq(NEWS_ESTIMATED_TOKENS)) {
      try {
        usage.recordStructured('tavilyByReason', releaseReason);
        const remembered = new Set(band.structuredResearch?.routing?.groqFingerprints || []);
        const remember = (fingerprints) => { const previous = routingUpdates.get(band.id) || band.structuredResearch?.routing || {}; routingUpdates.set(band.id, { ...previous, groqFingerprints: [...new Set([...(previous.groqFingerprints || []), ...fingerprints])].slice(-100) }); };
        const items = await fetchNewsForBand(band, usage, { category: 'release', allowGroq: config.STRUCTURED_RESEARCH.groqFallbackEnabled, seenFingerprints: remembered, onFingerprints: remember });
        routingUpdates.set(band.id, { ...(routingUpdates.get(band.id) || band.structuredResearch?.routing || {}), lastTavilyReleaseAt: new Date().toISOString(), lastTavilyReleaseReason: releaseReason });
        for (const item of items.filter((item) => item.category === 'album')) {
          const key = newsKey(item); if (!existingNewsKeys.has(key)) { existingNewsKeys.add(key); newNews.push(item); }
        }
      } catch (error) { usage.note(`Release fallback failed for "${band.name}": ${error.message}`); }
    }
  }

  if (structuredEnabled && routingUpdates.size) {
    const latestBands = await worker.readJson('bands.json', []);
    const updates = [...routingUpdates].map(([id, routing]) => ({ id, structuredResearch: { routing } }));
    await worker.writeJson('bands.json', structured.mergeStructuredBandUpdates(latestBands, updates));
  }

  // Drop anything whose own reported event date is older than the
  // documented recency window — a belt-and-suspenders backstop behind the
  // classification prompt's "ignore anything older than ~21 days"
  // instruction. This used to compare against `n.foundAt` instead of
  // `n.date`, which is always "now" (set at creation, a few lines above) —
  // so the check could never actually drop anything; found during a QA
  // pass. Items with no explicit date (n.date === null) are left as-is,
  // since there's nothing to judge staleness against and the mandatory-date
  // policy already means "no date" was a deliberate, not accidental, gap.
  const freshNews = newNews.filter((n) => !n.date || daysAgo(n.date) <= config.NEWS_RECENCY_DAYS);

  // ---- Setlists: setlist.fm, past-attended shows only ----
  //
  // Runs once per pipeline run, over the existing `concerts` array (never
  // over newConcerts — everything research.js discovers is upcoming by
  // definition, so nothing newly added this run could qualify anyway).
  // Scope is exactly "attended + already happened + no setlist yet, or not
  // checked in the last SETLIST_RECHECK_DAYS" — the same 57-ish shows this
  // was originally scoped to cover, re-derived fresh every run rather than
  // hardcoded, since that count only grows as more shows get attended and
  // move into the past. This is also the entire backfill mechanism: the
  // first run after this ships simply finds every qualifying past show at
  // once (perRunCap is sized generously enough to cover them all in one
  // pass) rather than needing a separate one-off script.
  const today = todayIso();
  const needsSetlistCheck = concerts.filter((c) => {
    if (!c.attending || !c.date || c.date >= today) return false;
    if (c.setlist) return false;
    if (c.setlistCheckedAt && daysAgo(c.setlistCheckedAt) < SETLIST_RECHECK_DAYS) return false;
    return true;
  });

  let setlistChecksAttempted = 0;
  let setlistsAdded = 0;
  const bandsById = new Map(bands.map((band) => [band.id, band]));
  for (const c of needsSetlistCheck) {
    if (!usage.canCallSetlistfm()) break;
    setlistChecksAttempted += 1;
    try {
      const band = bandsById.get(c.bandId);
      const artistMbid = structuredEnabled && band?.musicbrainz?.mbid && ['manual_confirmed', 'auto_confirmed'].includes(band.musicbrainz?.status) ? band.musicbrainz.mbid : null;
      const result = await setlistfm.findSetlistForShow(c, usage, { artistMbid });
      c.setlistCheckedAt = new Date().toISOString();
      if (result) {
        c.setlist = result;
        setlistsAdded += 1;
      }
    } catch (e) {
      usage.note(`setlist.fm lookup failed for "${c.bandName}" (${c.date}): ${e.message}`);
      c.setlistCheckedAt = new Date().toISOString();
    }
  }

  // ---- Spotify links: one track link per original (non-cover) setlist song ----
  //
  // Scans every concert (not just ones touched this run) that has a setlist
  // with at least one non-cover song not yet checked — this is deliberately
  // the SAME mechanism for ongoing weekly maintenance and the one-time
  // historical backfill: the first run after this ships finds every
  // already-attended show's setlist at once, and every run after that only
  // finds the handful of newly-added setlists. Covers are never looked up —
  // the user only wants links for a band's own songs.
  let spotifyConcertsProcessed = 0;
  let spotifyLinksAdded = 0;
  const needsSpotifyCheck = concerts.filter(
    (c) => c.setlist && Array.isArray(c.setlist.songs) && c.setlist.songs.some((s) => !s.isCover && !s.spotifyChecked)
  );
  for (const c of needsSpotifyCheck) {
    if (!usage.canCallSpotify()) break;
    spotifyConcertsProcessed += 1;
    try {
      const band = bandsById.get(c.bandId);
      const spotifyArtistId = structuredEnabled && band?.musicbrainz?.spotify?.status === 'confirmed' ? band.musicbrainz.spotify.id : null;
      spotifyLinksAdded += await spotify.resolveSongLinks(c.setlist.songs, c.bandName, usage, { spotifyArtistId });
    } catch (e) {
      usage.note(`Spotify song-link resolution failed for "${c.bandName}" (${c.date}): ${e.message}`);
    }
  }

  // One combined write covers this run's new upcoming concerts
  // (newConcerts), any setlist/setlistCheckedAt fields just filled in on
  // existing records, and any spotifyUrl/spotifyChecked fields just filled
  // in on setlist songs — a single PUT rather than three separate ones.
  if (newConcerts.length > 0 || setlistChecksAttempted > 0 || spotifyConcertsProcessed > 0) {
    await worker.writeJson('concerts.json', [...concerts, ...newConcerts]);
  }
  if (freshNews.length > 0) {
    await worker.writeJson('news.json', [...news, ...freshNews]);
  }

  // Advance the rotation by exactly how many bands actually got a news
  // attempt this run — if the budget ran out early, that's fewer than
  // bands.length, so next week picks up right where this run left off
  // instead of restarting from the same spot.
  if (bands.length > 0) {
    usage.state.rotation.nextBandIndex = (rotationOffset + newsAttemptCount) % bands.length;
  }

  usage.finishRun({
    bandsProcessed,
    ticketmasterHits,
    tavilyFallbackUsed,
    newsAttemptCount,
    rotationOffset,
    concertsAdded: newConcerts.length,
    newsAdded: freshNews.length,
    setlistChecksAttempted,
    setlistsAdded,
    spotifyConcertsProcessed,
    spotifyLinksAdded,
    status: 'ok',
  });
  await usage.save();

  console.log(
    `Done. Bands processed: ${bandsProcessed}, new concerts: ${newConcerts.length}, new news items: ${freshNews.length}, news attempted: ${newsAttemptCount}/${bands.length} (started at index ${rotationOffset}).`
  );
  console.log(
    `Setlists: checked ${setlistChecksAttempted}/${needsSetlistCheck.length} eligible past shows, found ${setlistsAdded} new setlist(s).`
  );
  console.log(
    `Spotify: processed ${spotifyConcertsProcessed}/${needsSpotifyCheck.length} eligible concerts, added ${spotifyLinksAdded} new song link(s).`
  );
  console.log(
    `Usage this run — Ticketmaster: ${usage.state.ticketmaster.callsThisRun}, Tavily: ${usage.state.tavily.callsThisRun} (month total: ${usage.state.tavily.callsThisMonth}/${usage.state.tavily.monthlyCap}), Groq: ${usage.state.groq.callsThisRun} calls / ${usage.state.groq.tokensThisRun} tokens, setlist.fm: ${usage.state.setlistfm.callsThisRun} calls, Spotify: ${usage.state.spotify.callsThisRun} calls.`
  );
}

if (require.main === module) main().catch(async (e) => {
  console.error('Pipeline failed:', e);
  try {
    // Reuse the same UsageTracker instance main() was mutating, if it got
    // far enough to create one — NOT a fresh UsageTracker.load(). Reloading
    // here used to silently discard every real Ticketmaster/Tavily/Groq
    // call the failed run had already made: the freshly-reloaded instance
    // has callsThisRun zeroed and callsToday/callsThisMonth/tokensToday
    // exactly as they were before this run started, so the saved lastRun
    // summary for an errored run would show 0 calls no matter how far the
    // pipeline actually got — and, worse, next week's run would believe it
    // has more free-tier budget left than it actually does, since the real
    // usage from this run was never persisted. Only fall back to a fresh
    // load if main() crashed before it even got as far as creating one.
    const usage = sharedUsage || (await UsageTracker.load());
    usage.finishRun({ status: 'error', error: e.message });
    await usage.save();
  } catch (saveErr) {
    console.error('Additionally failed to save error state to apiUsage.json:', saveErr);
  }
  process.exitCode = 1;
});

module.exports = { musicbrainzEligible, mergeMusicbrainzResults, processMusicbrainzIdentities, processStructuredResearch, predictedSetlistEligible, predictionDue, mergePredictedSetlistResults, processPredictedSetlists, newsKey, fetchTourDatesViaTavily, fetchNewsForBand, promisingTavilyResults };
