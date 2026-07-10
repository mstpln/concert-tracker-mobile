'use strict';
// Free geocoding for the Tavily tour-date fallback path only — Ticketmaster
// events already carry a venue lat/lon, so this is only needed for the
// (smaller) set of shows found via Tavily+Groq instead, so they can still
// get a real distanceKm rather than null.
//
// Uses OpenStreetMap Nominatim, which is free and needs no API key/signup,
// but its usage policy requires: max 1 request/second, and an identifying
// User-Agent. Both are enforced here. Results are cached per city+country
// for the lifetime of a single run to avoid repeat lookups.

const { haversineKm, sleep } = require('./util');
const config = require('./config');

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const MIN_GAP_MS = 1100; // Nominatim policy: max 1 req/sec, with a small margin
const cache = new Map();
let lastCallAt = 0;

async function geocodeCity(city, country) {
  if (!city) return null;
  const key = `${city}|${country || ''}`.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const gap = Date.now() - lastCallAt;
  if (gap < MIN_GAP_MS) await sleep(MIN_GAP_MS - gap);
  lastCallAt = Date.now();

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('q', [city, country].filter(Boolean).join(', '));
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');

  let result = null;
  try {
    const res = await fetch(url.toString(), {
      headers: {
        // Required by Nominatim's usage policy — identifies the app and
        // gives them a way to contact us if this ever needs throttling
        // further on their end.
        'User-Agent': 'ConcertTrackerMobile-ResearchPipeline/1.0 (personal hobby project; no contact email on file)',
      },
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data[0]) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) result = { lat, lon };
      }
    }
  } catch {
    result = null;
  }
  cache.set(key, result);
  return result;
}

async function distanceKmForCity(city, country) {
  const geo = await geocodeCity(city, country);
  if (!geo) return null;
  return haversineKm(config.HOME_LAT, config.HOME_LON, geo.lat, geo.lon);
}

module.exports = { geocodeCity, distanceKmForCity };
