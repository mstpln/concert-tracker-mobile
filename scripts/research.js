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
//
// Every external call is gated through usageTracker so this can never
// exceed (self-imposed, below-free-tier) hard caps, and every provider
// call is paced to respect real-time rate limits. New concerts/news are
// APPENDED ONLY — nothing already in concerts.json/news.json is ever
// edited or removed by this script.

const worker = require('./lib/workerClient');
const { UsageTracker } = require('./lib/usageTracker');
const ticketmaster = require('./lib/ticketmaster');
const tavily = require('./lib/tavily');
const groq = require('./lib/groq');
const geocode = require('./lib/geocode');
const { slugify, isValidFullDate, daysAgo, truncate, todayIso } = require('./lib/util');
const config = require('./lib/config');

const NEWS_CATEGORIES = new Set(['concert', 'album', 'ticket', 'hiatus']);

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

async function fetchTourDatesViaTavily(band, usage) {
  const searchResult = await tavily.search(`${band.name} tour dates concert announcement`, usage, {
    maxResults: TAVILY_TOUR_DATE_MAX_RESULTS,
  });
  if (!searchResult || searchResult.results.length === 0) return [];

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
    '- Only include shows for the exact band named by the user, not support acts, tribute bands, or unrelated artists.',
    '- Respond with a JSON object: {"shows": [{"venue": "", "city": "", "country": "", "date": "YYYY-MM-DD", "sourceUrl": ""}]}',
    '- If nothing qualifies, respond with {"shows": []}.',
  ].join('\n');

  const userPrompt = `Band: ${band.name}\nToday's date: ${today}\n\nSearch results:\n${snippets}`;

  const parsed = await groq.chatJson(systemPrompt, userPrompt, usage, {
    estimatedTokens: TOUR_DATE_ESTIMATED_TOKENS,
  });
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

async function fetchNewsForBand(band, usage) {
  const searchResult = await tavily.search(`${band.name} news`, usage, {
    maxResults: TAVILY_NEWS_MAX_RESULTS,
    topic: 'news',
    days: 21,
  });
  if (!searchResult || searchResult.results.length === 0) return [];

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

  const userPrompt = `Band: ${band.name}\nToday's date: ${new Date().toISOString().slice(0, 10)}\n\nSearch results:\n${snippets}`;

  const parsed = await groq.chatJson(systemPrompt, userPrompt, usage, {
    estimatedTokens: NEWS_ESTIMATED_TOKENS,
  });
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

async function main() {
  console.log('Concert Tracker research pipeline starting…');

  const [bands, concerts, news, usage] = await Promise.all([
    worker.readJson('bands.json', []),
    worker.readJson('concerts.json', []),
    worker.readJson('news.json', []),
    UsageTracker.load(),
  ]);

  const todayStr = todayIso();
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

  for (const band of orderedBands) {
    bandsProcessed += 1;

    // ---- Tour dates: Ticketmaster first ----
    let candidates = [];
    try {
      candidates = await ticketmaster.fetchUpcomingEvents(band, usage);
    } catch (e) {
      usage.note(`Ticketmaster lookup failed for "${band.name}": ${e.message}`);
    }

    if (candidates.length > 0) {
      ticketmasterHits += 1;
    } else if (usage.canCallTavily() && usage.canCallGroq(TOUR_DATE_ESTIMATED_TOKENS)) {
      // ---- Fallback: Tavily + Groq, only when Ticketmaster found nothing ----
      try {
        candidates = await fetchTourDatesViaTavily(band, usage);
        if (candidates.length > 0) tavilyFallbackUsed += 1;
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
      if (!c.date || c.date < todayStr) {
        usage.note(`Dropped past-dated candidate for "${c.bandName}": ${c.date} at ${c.venue} (source: ${c.ticketRetailerVerified ? 'Ticketmaster' : 'Tavily/Groq'})`);
        continue;
      }
      existingConcertIds.add(c.id);
      existingConcertKeys.add(concertKey(c));
      newConcerts.push(c);
    }

    // ---- News: one combined Tavily search + Groq classification ----
    if (usage.canCallTavily() && usage.canCallGroq(NEWS_ESTIMATED_TOKENS)) {
      newsAttemptCount += 1;
      try {
        const items = await fetchNewsForBand(band, usage);
        for (const n of items) {
          const key = newsKey(n);
          if (existingNewsKeys.has(key)) continue;
          existingNewsKeys.add(key);
          newNews.push(n);
        }
      } catch (e) {
        usage.note(`News research failed for "${band.name}": ${e.message}`);
      }
    } else if (!newsBudgetExhaustedNoted) {
      // Tavily/Groq budget for this run is used up — keep going so the
      // remaining bands still get their (free, cheap) Ticketmaster tour-date
      // check; they just won't get a news check until next week's run.
      usage.note('Tavily/Groq run budget exhausted — skipping news research for remaining bands this run');
      newsBudgetExhaustedNoted = true;
    }
  }

  // Drop anything that somehow ended up stale relative to the documented
  // ~14 day recency window before writing (belt-and-suspenders; foundAt is
  // always "now" so this should never trigger in practice).
  const freshNews = newNews.filter((n) => daysAgo(n.foundAt) <= config.NEWS_RECENCY_DAYS);

  if (newConcerts.length > 0) {
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
    status: 'ok',
  });
  await usage.save();

  console.log(
    `Done. Bands processed: ${bandsProcessed}, new concerts: ${newConcerts.length}, new news items: ${freshNews.length}, news attempted: ${newsAttemptCount}/${bands.length} (started at index ${rotationOffset}).`
  );
  console.log(
    `Usage this run — Ticketmaster: ${usage.state.ticketmaster.callsThisRun}, Tavily: ${usage.state.tavily.callsThisRun} (month total: ${usage.state.tavily.callsThisMonth}/${usage.state.tavily.monthlyCap}), Groq: ${usage.state.groq.callsThisRun} calls / ${usage.state.groq.tokensThisRun} tokens.`
  );
}

main().catch(async (e) => {
  console.error('Pipeline failed:', e);
  try {
    const usage = await UsageTracker.load();
    usage.finishRun({ status: 'error', error: e.message });
    await usage.save();
  } catch (saveErr) {
    console.error('Additionally failed to save error state to apiUsage.json:', saveErr);
  }
  process.exitCode = 1;
});
