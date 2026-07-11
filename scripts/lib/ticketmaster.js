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
const TRIBUTE_ACT_PATTERN = /\b(tribute|cover\s*band|coverband|revival|allstars|allstar|experience|reunion|homage)\b/i;

// Second real bug, found during a full data-integrity audit on 2026-07-11:
// the substring-containment rule in namesMatch() below is far too loose for
// short/common band names. Swedish band "Kent" (normalized "kent", 4 chars)
// matched against American country artist "Corey Kent" (normalized
// "coreykent") because "coreykent".includes("kent") is true — a completely
// unrelated artist who just happens to have "Kent" as part of their name.
// This let ~10 fake upcoming US-fairground shows onto Kent's page, even
// though Kent (the Swedish band) split up and stopped touring in 2023.
// Fix: for short normalized names (< SHORT_NAME_THRESHOLD chars) or names
// that are a single common word, require an EXACT normalized match instead
// of substring containment in either direction. Substring containment is
// only safe for longer, more distinctive names where an unrelated artist
// coincidentally containing the whole string is far less likely
// ("Motorhead" vs "The Motorhead Band", say).
const SHORT_NAME_THRESHOLD = 8;

// Third real bug, found in the same audit: promoters running tribute nights
// / cover-act shows routinely tag the *attraction* with the real band's
// exact name (so fans searching for the real band find the tribute event),
// while the word "tribute" only appears in the event's own title/URL slug
// (e.g. event.name = "Kashmir - A Tribute to Led Zeppelin", attraction.name
// = "Kashmir"). Checking TRIBUTE_ACT_PATTERN only against attraction.name
// missed these entirely. Fix: also reject the whole event if the pattern
// matches the top-level event.name, not just each attraction's name.
function namesMatch(bandName, attractionName) {
  if (TRIBUTE_ACT_PATTERN.test(attractionName || '')) return false;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const a = norm(bandName);
  const b = norm(attractionName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < SHORT_NAME_THRESHOLD || b.length < SHORT_NAME_THRESHOLD) {
    // Short/common names: substring containment is too easily satisfied by
    // an unrelated artist (e.g. "Kent" inside "Corey Kent"). Require exact
    // match only.
    return false;
  }
  return a.includes(b) || b.includes(a);
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
  url.searchParams.set('size', '20');
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
    // Reject tribute/cover-act events even when the promoter has tagged the
    // attraction with the real band's exact name and the "tribute" wording
    // only shows up in the event's own title (see comment on
    // TRIBUTE_ACT_PATTERN above).
    if (TRIBUTE_ACT_PATTERN.test(event?.name || '')) continue;

    const attractions = event?._embedded?.attractions || [];
    const matched = attractions.some((a) => namesMatch(band.name, a.name));
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
