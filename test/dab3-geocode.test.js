'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const geocode = require('../scripts/lib/geocode');
const { attachResearchGeocode } = require('../scripts/tavilyConcertRun');

function response(payload, { ok = true } = {}) {
  return { ok, json: async () => payload };
}

test.beforeEach(() => geocode.clearCache());

test('DAB3 scheduled geocoder uses Open-Meteo and exact city-country matching', async () => {
  let requestedUrl = null;
  const fetchImpl = async (url) => {
    requestedUrl = new URL(url);
    return response({ results: [
      { name: 'Copenhagen', country: 'Denmark', country_code: 'DK', latitude: 55.6761, longitude: 12.5683 },
      { name: 'Copenhagen', country: 'United States', country_code: 'US', latitude: 42.73, longitude: -92.35 },
    ] });
  };

  const location = await geocode.locationForCity('Copenhagen', 'Denmark', { fetchImpl });
  assert.equal(requestedUrl.origin, 'https://geocoding-api.open-meteo.com');
  assert.equal(requestedUrl.pathname, '/v1/search');
  assert.equal(requestedUrl.searchParams.get('name'), 'Copenhagen');
  assert.equal(requestedUrl.searchParams.get('count'), '10');
  assert.equal(requestedUrl.searchParams.get('language'), 'en');
  assert.equal(requestedUrl.searchParams.has('countryCode'), false);
  assert.equal(location.researchGeocodeProvider, 'open-meteo');
  assert.equal(location.latitude, 55.6761);
  assert.equal(location.longitude, 12.5683);
  assert.ok(Number.isFinite(location.distanceKm));
});

test('DAB3 country-code inputs are sent to Open-Meteo and wrong-country results fail closed', async () => {
  let requestedUrl = null;
  const location = await geocode.locationForCity('Copenhagen', 'DK', {
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return response({ results: [{ name: 'Copenhagen', country: 'United States', country_code: 'US', latitude: 42.73, longitude: -92.35 }] });
    },
  });
  assert.equal(requestedUrl.searchParams.get('countryCode'), 'DK');
  assert.equal(location, null);
});

test('DAB3 ambiguous and malformed Open-Meteo results never become trusted coordinates', () => {
  assert.equal(geocode.exactLocation({ results: [
    { name: 'Springfield', country: 'United States', latitude: 39.78, longitude: -89.64 },
    { name: 'Springfield', country: 'United States', latitude: 44.05, longitude: -123.02 },
  ] }, 'Springfield', 'United States'), null);

  assert.equal(geocode.exactLocation({ results: [
    { name: 'Copenhagen', country: 'Denmark', latitude: null, longitude: 12.5683 },
  ] }, 'Copenhagen', 'Denmark'), null);

  assert.equal(geocode.exactLocation({ results: [
    { name: 'Copenhagen', country: 'Denmark', latitude: 155.6, longitude: 12.5683 },
  ] }, 'Copenhagen', 'Denmark'), null);
});

test('DAB3 reuses one successful city lookup during a run', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return response({ results: [{ name: 'Copenhagen', country: 'Denmark', latitude: 55.6761, longitude: 12.5683 }] });
  };

  const first = await geocode.locationForCity('Copenhagen', 'Denmark', { fetchImpl });
  const second = await geocode.locationForCity('Copenhagen', 'Denmark', { fetchImpl });
  assert.equal(calls, 1);
  assert.deepEqual(second, first);
});

test('DAB3 seeds a future run only from persisted Open-Meteo geocodes', async () => {
  const seeded = geocode.seedFromConcerts([
    { city: 'Copenhagen', country: 'Denmark', latitude: 55.6761, longitude: 12.5683, researchGeocodeProvider: 'open-meteo' },
    { city: 'Berlin', country: 'Germany', latitude: 52.52, longitude: 13.405, sourceProvider: 'ticketmaster' },
    { city: 'Bad Data', country: 'Denmark', latitude: null, longitude: 12.5, researchGeocodeProvider: 'open-meteo' },
  ]);
  assert.equal(seeded, 1);

  let calls = 0;
  const cached = await geocode.locationForCity('Copenhagen', 'Denmark', { fetchImpl: async () => { calls += 1; throw new Error('should not run'); } });
  assert.equal(calls, 0);
  assert.equal(cached.latitude, 55.6761);
  assert.equal(cached.researchGeocodeProvider, 'open-meteo');

  const ticketmasterLocation = geocode.cachedForCity('Berlin', 'Germany');
  assert.equal(ticketmasterLocation, null);
});

test('DAB3 focused runner persists the successful cached geocode on a new Tavily candidate', async () => {
  await geocode.locationForCity('Copenhagen', 'Denmark', {
    fetchImpl: async () => response({ results: [{ name: 'Copenhagen', country: 'Denmark', latitude: 55.6761, longitude: 12.5683 }] }),
  });

  const candidate = attachResearchGeocode({
    id: 'band-1-2026-09-01-copenhagen',
    bandId: 'band-1',
    city: 'Copenhagen',
    country: 'Denmark',
    distanceKm: 520,
  });
  assert.equal(candidate.latitude, 55.6761);
  assert.equal(candidate.longitude, 12.5683);
  assert.equal(candidate.researchGeocodeProvider, 'open-meteo');
  assert.ok(Number.isFinite(candidate.distanceKm));
});

test('DAB3 temporary provider failure remains retryable and does not create persisted evidence', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new Error('synthetic outage');
    return response({ results: [{ name: 'Copenhagen', country: 'Denmark', latitude: 55.6761, longitude: 12.5683 }] });
  };

  assert.equal(await geocode.locationForCity('Copenhagen', 'Denmark', { fetchImpl }), null);
  assert.equal(geocode.cachedForCity('Copenhagen', 'Denmark'), null);
  assert.ok(await geocode.locationForCity('Copenhagen', 'Denmark', { fetchImpl }));
  assert.equal(calls, 2);
});

test('DAB3 keeps the focused Tavily/Groq schedule unchanged and removes Nominatim from the scheduled geocoder', () => {
  const workflow = fs.readFileSync(path.join('.github', 'workflows', 'tavily-concert-research.yml'), 'utf8');
  const source = fs.readFileSync(path.join('scripts', 'lib', 'geocode.js'), 'utf8');
  assert.match(workflow, /0 2 1,15 \* \*/);
  assert.match(source, /geocoding-api\.open-meteo\.com\/v1\/search/);
  assert.doesNotMatch(source, /nominatim\.openstreetmap\.org/);
});
