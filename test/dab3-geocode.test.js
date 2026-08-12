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
  assert.equal(location.researchGeocode.provider, 'open-meteo');
  assert.equal(location.researchGeocode.latitude, 55.6761);
  assert.equal(location.researchGeocode.longitude, 12.5683);
  assert.equal(location.researchGeocode.city, 'Copenhagen');
  assert.equal(location.researchGeocode.country, 'Denmark');
  assert.ok(Number.isFinite(location.distanceKm));
  assert.equal('latitude' in location, false);
  assert.equal('longitude' in location, false);
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

test('DAB3 seeds a future run only from matching namespaced Open-Meteo evidence', async () => {
  const seeded = geocode.seedFromConcerts([
    {
      city: 'Copenhagen', country: 'Denmark',
      researchGeocode: { provider: 'open-meteo', city: 'Copenhagen', country: 'Denmark', latitude: 55.6761, longitude: 12.5683 },
    },
    {
      city: 'Berlin', country: 'Germany',
      researchGeocode: { provider: 'ticketmaster', city: 'Berlin', country: 'Germany', latitude: 52.52, longitude: 13.405 },
    },
    {
      city: 'Oslo', country: 'Norway',
      researchGeocode: { provider: 'open-meteo', city: 'Bergen', country: 'Norway', latitude: 60.39, longitude: 5.32 },
    },
    {
      city: 'Bad Data', country: 'Denmark',
      researchGeocode: { provider: 'open-meteo', city: 'Bad Data', country: 'Denmark', latitude: null, longitude: 12.5 },
    },
  ]);
  assert.equal(seeded, 1);

  let calls = 0;
  const cached = await geocode.locationForCity('Copenhagen', 'Denmark', { fetchImpl: async () => { calls += 1; throw new Error('should not run'); } });
  assert.equal(calls, 0);
  assert.equal(cached.researchGeocode.latitude, 55.6761);
  assert.equal(cached.researchGeocode.provider, 'open-meteo');

  assert.equal(geocode.cachedForCity('Berlin', 'Germany'), null);
  assert.equal(geocode.cachedForCity('Oslo', 'Norway'), null);
});

test('DAB3 focused runner persists namespaced geocode evidence on a new Tavily candidate', async () => {
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
  assert.equal(candidate.researchGeocode.provider, 'open-meteo');
  assert.equal(candidate.researchGeocode.latitude, 55.6761);
  assert.equal(candidate.researchGeocode.longitude, 12.5683);
  assert.equal('latitude' in candidate, false);
  assert.equal('longitude' in candidate, false);
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
