'use strict';
// Geocoding helper used only for Tavily/Groq concert-discovery fallback.
// Ticketmaster events already carry coordinates. Scheduled research uses
// Open-Meteo rather than the public Nominatim service. Successful Open-Meteo
// city/country results are stored as namespaced derived research evidence;
// future runs seed this cache from those records before making provider calls.

const { haversineKm, sleep } = require('./util');
const config = require('./config');

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const REQUEST_TIMEOUT_MS = 10000;
// Open-Meteo's free API currently documents 600 calls/minute. This caps
// request starts at about 400/minute so compliance does not depend on latency.
const MIN_GAP_MS = 150;
const PROVIDER = 'open-meteo';
const cache = new Map();
let lastCallAt = 0;

function normalize(value) {
  return String(value || '')
    .toLocaleLowerCase('en')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function locationKey(city, country) {
  const cityKey = normalize(city);
  const countryKey = normalize(country);
  return cityKey && countryKey ? `${cityKey}|${countryKey}` : null;
}

function isoCountryCode(value) {
  const text = String(value || '').trim();
  return /^[A-Za-z]{2}$/.test(text) ? text.toUpperCase() : null;
}

function finiteCoordinate(value, kind) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (kind === 'lat' && (numeric < -90 || numeric > 90)) return null;
  if (kind === 'lon' && (numeric < -180 || numeric > 180)) return null;
  return numeric;
}

function exactLocation(data, city, country) {
  const cityKey = normalize(city);
  const countryKey = normalize(country);
  const inputCountryCode = isoCountryCode(country);
  const candidates = Array.isArray(data?.results) ? data.results : [];
  const matches = candidates.filter((candidate) => {
    const lat = finiteCoordinate(candidate?.latitude, 'lat');
    const lon = finiteCoordinate(candidate?.longitude, 'lon');
    if (lat === null || lon === null || normalize(candidate?.name) !== cityKey) return false;
    if (inputCountryCode) return String(candidate?.country_code || '').toUpperCase() === inputCountryCode;
    return normalize(candidate?.country) === countryKey;
  });
  if (matches.length !== 1) return null;
  const match = matches[0];
  return {
    lat: finiteCoordinate(match.latitude, 'lat'),
    lon: finiteCoordinate(match.longitude, 'lon'),
  };
}

function cachedLocation(value) {
  const lat = finiteCoordinate(value?.latitude ?? value?.lat, 'lat');
  const lon = finiteCoordinate(value?.longitude ?? value?.lon ?? value?.lng, 'lon');
  if (lat === null || lon === null) return null;
  return { lat, lon };
}

function sameCoordinates(first, second) {
  return first?.lat === second?.lat && first?.lon === second?.lon;
}

function seedFromConcerts(concerts = []) {
  const discovered = new Map();
  const conflicts = new Set();
  for (const concert of Array.isArray(concerts) ? concerts : []) {
    const evidence = concert?.researchGeocode;
    if (evidence?.provider !== PROVIDER) continue;
    if (normalize(evidence.city) !== normalize(concert.city) || normalize(evidence.country) !== normalize(concert.country)) continue;
    const key = locationKey(concert.city, concert.country);
    const coords = cachedLocation(evidence);
    if (!key || !coords || conflicts.has(key)) continue;
    if (!discovered.has(key)) {
      discovered.set(key, coords);
      continue;
    }
    if (!sameCoordinates(discovered.get(key), coords)) {
      discovered.delete(key);
      conflicts.add(key);
    }
  }

  let seeded = 0;
  for (const [key, coords] of discovered) {
    if (cache.has(key)) continue;
    cache.set(key, coords);
    seeded += 1;
  }
  return seeded;
}

function cachedForCity(city, country) {
  const key = locationKey(city, country);
  if (!key || !cache.has(key)) return null;
  const coords = cache.get(key);
  if (!coords) return null;
  return {
    distanceKm: haversineKm(config.HOME_LAT, config.HOME_LON, coords.lat, coords.lon),
    researchGeocode: {
      provider: PROVIDER,
      city: String(city || '').trim(),
      country: String(country || '').trim(),
      latitude: coords.lat,
      longitude: coords.lon,
    },
  };
}

function clearCache() {
  cache.clear();
  lastCallAt = 0;
}

async function waitForProviderSlot() {
  const gap = Date.now() - lastCallAt;
  if (lastCallAt && gap < MIN_GAP_MS) await sleep(MIN_GAP_MS - gap);
  lastCallAt = Date.now();
}

async function geocodeCity(city, country, { fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const cityText = String(city || '').trim();
  const countryText = String(country || '').trim();
  const key = locationKey(cityText, countryText);
  if (!key || typeof fetchImpl !== 'function') return null;
  if (cache.has(key)) return cache.get(key);

  const url = new URL(GEOCODE_URL);
  url.searchParams.set('name', cityText);
  // The API supports up to 100 results. Requesting the maximum strengthens
  // the fail-closed ambiguity check instead of assuming the top ten are unique.
  url.searchParams.set('count', '100');
  url.searchParams.set('language', 'en');
  const countryCode = isoCountryCode(countryText);
  if (countryCode) url.searchParams.set('countryCode', countryCode);

  let timer = null;
  let controller = null;
  try {
    await waitForProviderSlot();
    if (typeof AbortController === 'function' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeoutMs);
    }
    const response = await fetchImpl(url.toString(), controller ? { signal: controller.signal } : undefined);
    if (!response?.ok) return null;
    const result = exactLocation(await response.json(), cityText, countryText);
    if (result) cache.set(key, result);
    return result;
  } catch (_) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function locationForCity(city, country, options) {
  const coords = await geocodeCity(city, country, options);
  if (!coords) return null;
  return cachedForCity(city, country);
}

async function distanceKmForCity(city, country, options) {
  const location = await locationForCity(city, country, options);
  return location?.distanceKm ?? null;
}

module.exports = {
  GEOCODE_URL,
  REQUEST_TIMEOUT_MS,
  MIN_GAP_MS,
  PROVIDER,
  normalize,
  locationKey,
  exactLocation,
  seedFromConcerts,
  cachedForCity,
  clearCache,
  geocodeCity,
  locationForCity,
  distanceKmForCity,
};
