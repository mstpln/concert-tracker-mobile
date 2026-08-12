'use strict';
// Geocoding helper used only for Tavily/Groq concert-discovery fallback.
// Ticketmaster events already carry coordinates. Scheduled research uses
// Open-Meteo rather than the public Nominatim service. Successful Open-Meteo
// city/country results are stored additively on discovered concert records;
// future runs seed this cache from those records before making provider calls.

const { haversineKm } = require('./util');
const config = require('./config');

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const REQUEST_TIMEOUT_MS = 10000;
const PROVIDER = 'open-meteo';
const cache = new Map();

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

function finiteCoordinate(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function exactLocation(data, city, country) {
  const cityKey = normalize(city);
  const countryKey = normalize(country);
  const inputCountryCode = isoCountryCode(country);
  const candidates = Array.isArray(data?.results) ? data.results : [];
  const matches = candidates.filter((candidate) => {
    const lat = finiteCoordinate(candidate?.latitude);
    const lon = finiteCoordinate(candidate?.longitude);
    if (lat === null || lon === null || normalize(candidate?.name) !== cityKey) return false;
    if (inputCountryCode) return String(candidate?.country_code || '').toUpperCase() === inputCountryCode;
    return normalize(candidate?.country) === countryKey;
  });
  if (matches.length !== 1) return null;
  const match = matches[0];
  return {
    lat: finiteCoordinate(match.latitude),
    lon: finiteCoordinate(match.longitude),
    timezone: typeof match.timezone === 'string' && match.timezone.trim() ? match.timezone.trim() : null,
  };
}

function cachedLocation(value) {
  const lat = finiteCoordinate(value?.latitude ?? value?.lat);
  const lon = finiteCoordinate(value?.longitude ?? value?.lon ?? value?.lng);
  if (lat === null || lon === null) return null;
  return {
    lat,
    lon,
    timezone: typeof value?.timezone === 'string' && value.timezone.trim() ? value.timezone.trim() : null,
  };
}

function seedFromConcerts(concerts = []) {
  let seeded = 0;
  for (const concert of Array.isArray(concerts) ? concerts : []) {
    if (concert?.researchGeocodeProvider !== PROVIDER) continue;
    const key = locationKey(concert.city, concert.country);
    const coords = cachedLocation(concert);
    if (!key || !coords || cache.has(key)) continue;
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
    latitude: coords.lat,
    longitude: coords.lon,
    timezone: coords.timezone,
    distanceKm: haversineKm(config.HOME_LAT, config.HOME_LON, coords.lat, coords.lon),
    researchGeocodeProvider: PROVIDER,
  };
}

function clearCache() {
  cache.clear();
}

async function geocodeCity(city, country, { fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const cityText = String(city || '').trim();
  const countryText = String(country || '').trim();
  const key = locationKey(cityText, countryText);
  if (!key || typeof fetchImpl !== 'function') return null;
  if (cache.has(key)) return cache.get(key);

  const url = new URL(GEOCODE_URL);
  url.searchParams.set('name', cityText);
  url.searchParams.set('count', '10');
  url.searchParams.set('language', 'en');
  const countryCode = isoCountryCode(countryText);
  if (countryCode) url.searchParams.set('countryCode', countryCode);

  let timer = null;
  let controller = null;
  try {
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
