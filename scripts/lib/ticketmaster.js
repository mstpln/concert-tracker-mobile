'use strict';
// Ticketmaster Discovery API client — the primary, structured source for
// tour dates. Because every event Ticketmaster returns already carries a
// full explicit date, results from here automatically satisfy the
// mandatory-year policy; the only filtering needed is making sure the
// event is actually by the band we asked about (keyword search can return
// loosely-related matches) and that the venue has a resolvable location.

const config = require('./config');
const { haversineKm, slugify, isValidFullDate } = require('./util');

function apiKey() {
  const k = process.env[config.TICKETMASTER.apiKeyEnv];
  if (!k) throw new Error(`Missing required environment variable: ${config.TICKETMASTER.apiKeyEnv}`);
  return k;
}

// Loose name match: lowercase, strip punctuation, require the band name to
// appear as a substring of the attraction name or vice versa. Good enough
// to reject "keyword happened to match" false positives without being so
// strict it rejects legitimate minor formatting differences ("Blink-182"
// vs "blink182").
//
// One real bug this let through on the first live run: "Arctic Monkeys
// Tribute" at a small Istanbul bar matched against "Arctic Monkeys" because
// it's a pure substring match, and independent WebSearch verification
// afterward confirmed the real Arctic Monkeys have no announced 2026 tour
// at all. Tribute/cover acts routinely reuse the original band's exact name
// as a substring, so they need an explicit exclusion rather than relying on
// the substring check to somehow reject them.
//
// A second, distinct round of real mismatches found in production data
// (2026-07-13 QA pass) showed this single keyword list wasn't enough:
//   - "Green Days" (a real Newcastle-based Green Day tribute act) slipped
//     through because plain substring matching doesn't care about word
//     boundaries — normalized("green day") is a substring of
//     normalized("green days") even though "Days" is a different word, not
//     a formatting variant of "Day". Fixed below by requiring containment
//     to happen on a whole-word boundary (namesMatchNormalized).
//   - "Ultimate Coldplay", "The Eminem Experience", and "Not Green Day" all
//     slipped through even with the OLD keyword list, because none of
//     "ultimate"/"not" were in it, and word-boundary matching alone doesn't
//     help here — "Ultimate Coldplay" contains "Coldplay" as a legitimately
//     whole-word-bounded substring, structurally identical to a legitimate
//     case like "Coldplay: Music of the Spheres Tour". The only way to tell
//     these apart is the specific qualifier word, so the keyword list below
//     was expanded with the common tribute/parody-naming vocabulary
//     ("not", "ultimate", "definitive", "totally", "unofficial", etc).
//   - These were caught in that QA pass by their ticketUrl literally
//     spelling it out ("not-green-day-tickets", "ultimate-coldplay-tickets",
//     "the-eminem-experience-in-london"), which is why the check below also
//     runs against event.name/event.url, not just the attraction name —
//     tribute nights are frequently sold under a bundled festival/event
//     title ("Christmas Rocks Day 4", "When We Were Punk '26", "Inbetween
//     Days") that says nothing tribute-flavored in the attraction name
//     itself but gives it away in the event title or URL slug.
//
// None of this makes the check bulletproof — creative tribute-act names
// ("No Way Sis" for Oasis) that don't contain the real band's name at all
// are excluded automatically (good), but a sufficiently creative name that
// both contains the real band's name AND isn't in this keyword list could
// still slip through. Treat this as a strong reduction in false positives,
// not a guarantee — if another one is spotted, add its qualifier word here.
const TRIBUTE_ACT_PATTERN =
  /\b(tribute|tributes|cover\s*band|coverband|revival|allstars?|experience|reunion|homage|ultimate|definitive|definitely|totally|simply|absolutely|unofficial|salut(e|ing)|remembering|celebrating|bootleg|counterfeit|replica|not|almost|nearly)\b/i;

// Whole-word-boundary-aware containment: true if `needle` appears in
// `haystack` as a run of whole words, bounded by spaces (or the start/end
// of the string) on both sides — NOT glued onto a longer word. This is what
// distinguishes "green day: saviours tour" (contains "green day" followed
// by a space — legitimate tour-title suffix) from "green days" (contains
// "green day" followed immediately by "s" — a different word, not a
// formatting variant).
function containsWholeWords(haystack, needle) {
  if (!needle) return false;
  const idx = haystack.indexOf(needle);
  if (idx === -1) return false;
  const before = idx === 0 || haystack[idx - 1] === ' ';
  const afterIdx = idx + needle.length;
  const after = afterIdx === haystack.length || haystack[afterIdx] === ' ';
  return before && after;
}

// Like the old norm(), but replaces stripped punctuation with a space
// instead of deleting it outright, so word boundaries survive
// normalization (needed by containsWholeWords above). Multiple spaces are
// collapsed and the result trimmed.
function normWords(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function namesMatch(bandName, attractionName, eventName, eventUrl) {
  if (
    TRIBUTE_ACT_PATTERN.test(attractionName || '') ||
    TRIBUTE_ACT_PATTERN.test(eventName || '') ||
    TRIBUTE_ACT_PATTERN.test((eventUrl || '').replace(/[-_/]/g, ' '))
  ) {
    return false;
  }
  const a = normWords(bandName);
  const b = normWords(attractionName);
  if (!a || !b) return false;
  if (a === b) return true;
  return containsWholeWords(b, a) || containsWholeWords(a, b);
}

// Returns an array of raw candidate concerts (not yet deduped against
// concerts.json) for a single band, or [] if nothing usable was found.
async function fetchUpcomingEvents(band, usage) {
  if (!usage.canCallTicketmaster()) {
    usage.note(`Ticketmaster per-run/daily cap reached — skipping "${band.name}"`);
    return [];
  }
  await usage.recordTicketmasterCall();

  const url = new URL(`${config.TICKETMASTER.baseUrl}/events.json`);
  url.searchParams.set('apikey', apiKey());
  url.searchParams.set('keyword', band.name);
  url.searchParams.set('classificationName', 'Music');
  url.searchParams.set('sort', 'date,asc');
  // Raised from 20 to 100 (2026-07): a band with 20+ near-term shows before
  // a later tour leg (e.g. Eagles of Death Metal's 21 North American dates
  // preceding their European leg) silently truncated the page before ever
  // reaching the later shows, and since Ticketmaster DID return some
  // results, the Tavily/Groq fallback in research.js never fired to catch
  // the gap. 100 gives 5x headroom over any realistic full tour. No cost
  // implication — Ticketmaster bills per request, not per page size, so
  // this is still exactly one API call per band either way.
  url.searchParams.set('size', '100');
  // Defensive, even though Ticketmaster appears to already exclude past
  // events by default without this: explicitly ask for events from right
  // now onward, in the yyyy-MM-ddTHH:mm:ssZ format their API requires. This
  // is belt-and-suspenders alongside the two other upcoming-only checks
  // (the Tavily/Groq fallback prompt, and the final merge-time filter in
  // research.js) — three independent layers, since a real live run already
  // showed one of those layers alone wasn't enough (the Tavily/Groq path
  // let 30 past-dated shows through before this was added).
  url.searchParams.set('startDateTime', new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));

  let res;
  try {
    res = await fetch(url.toString());
  } catch (e) {
    usage.note(`Ticketmaster request failed for "${band.name}": ${e.message}`);
    return [];
  }
  if (res.status === 404) return []; // Ticketmaster returns 404 for "no results" on this endpoint
  if (!res.ok) {
    usage.note(`Ticketmaster returned ${res.status} for "${band.name}"`);
    return [];
  }
  const data = await res.json();
  const events = data?._embedded?.events || [];

  const results = [];
  for (const event of events) {
    const attractions = event?._embedded?.attractions || [];
    const matched = attractions.some((a) => namesMatch(band.name, a.name, event.name, event.url));
    if (!matched) continue;

    const localDate = event?.dates?.start?.localDate;
    const tbd = event?.dates?.start?.dateTBD || event?.dates?.start?.dateTBA;
    if (tbd || !isValidFullDate(localDate)) continue; // mandatory-year policy: skip, never guess

    const venue = event?._embedded?.venues?.[0];
    if (!venue) continue;

    const lat = venue.location?.latitude ? parseFloat(venue.location.latitude) : null;
    const lon = venue.location?.longitude ? parseFloat(venue.location.longitude) : null;
    const distanceKm = haversineKm(config.HOME_LAT, config.HOME_LON, lat, lon);

    const city = venue.city?.name || '';
    const country = venue.country?.name || '';
    const addressLine = venue.address?.line1 || '';
    const venueAddress = [addressLine, city, country].filter(Boolean).join(', ') || null;

    results.push({
      id: `${band.id}-${localDate}-${slugify(city)}`,
      bandId: band.id,
      bandName: band.name,
      venue: venue.name || 'Unknown venue',
      city,
      country,
      date: localDate,
      time: event?.dates?.start?.localTime || null,
      distanceKm,
      articleUrl: null,
      ticketUrl: event.url || null,
      ticketRetailerVerified: true,
      isNew: true,
      foundAt: new Date().toISOString(),
      venueAddress,
    });
  }
  return results;
}

module.exports = { fetchUpcomingEvents };
