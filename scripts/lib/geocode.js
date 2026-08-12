'use strict';
// Geocoding helper used only for Tavily/Groq concert-discovery fallback.
// Ticketmaster events already carry coordinates.  Scheduled research uses
// Open-Meteo rather than the public Nominatim service because Nominatim's
// policy strongly discourages periodic bulk geocoding and restricts regular
// scripts to four requests per minute.  Open-Meteo is already the project's
// browser weather geocoder and supports this bounded non-commercial use.

const { haversineKm } = require('./util');
const config = require('./config');

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const REQUEST_TIMEOUT_MS = 10000;
const cache = new Map();

function normalize(value) {
  return String(value || '')
    .toLocaleLowerCase('en')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
  return {
    lat: finiteCoordinate(matches[0].latitude),
    lon: finiteCoordinate(matches[0].longitude),
  };
}

async function geocodeCity(city, country, { fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const cityText = String(city || '').trim();
  const countryText = String(country || '').trim();
  if (!cityText || !countryText || typeof fetchImpl !== 'function') return null;

  const key = `${normalize(cityText)}|${normalize(countryText)}`;
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
    if (!response?.ok) {
      cache.set(key, null);
      return null;
    }
    const result = exactLocation(await response.json(), cityText, countryText);
    cache.set(key, result);
    return result;
  } catch (_) {
    cache.set(key, null);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function distanceKmForCity(city, country, options) {
  const coords = await geocodeCity(city, country, options);
  if (!coords) return null;
  return haversineKm(config.HOME_LAT, config.HOME_LON, coords.lat, coords.lon);
}

module.exports = {
  GEOCODE_URL,
  REQUEST_TIMEOUT_MS,
  normalize,
  exactLocation,
  geocodeCity,
  distanceKmForCity,
};
