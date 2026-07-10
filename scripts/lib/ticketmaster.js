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
function namesMatch(bandName, attractionName) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const a = norm(bandName);
  const b = norm(attractionName);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
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
