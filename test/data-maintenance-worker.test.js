'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function workerUnderTest() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8').replace('export default{', 'globalThis.worker = {');
  const context = { Response, Request, URL, TextDecoder, AbortController, setTimeout, clearTimeout, globalThis: {} };
  vm.runInNewContext(code, context);
  return context.globalThis.worker;
}

function bucket() {
  const values = new Map([
    ['bands.json', '[]'], ['concerts.json', '[]'], ['news.json', '[]'], ['apiUsage.json', '{}'],
    ['listening/manifest.json', JSON.stringify({
      kind: 'livevault-listening-vault', schemaVersion: 1,
      archive: { source: 'spotify_import', path: `listening/spotify-history/${'a'.repeat(64)}.json.gz`, sha256: 'a'.repeat(64), contentEncoding: 'gzip', eventCount: 0 },
      incrementals: [],
    })],
  ]);
  const object = (key) => values.has(key) ? { body: values.get(key), text: async () => values.get(key), etag: `${key}-etag`, httpEtag: `"${key}-etag"` } : null;
  return {
    values,
    async get(key) { return object(key); },
    async head(key) { return object(key); },
    async put(key, value) { values.set(key, String(value)); return object(key); },
    async delete(key) { values.delete(key); },
  };
}

function request(pathname, token, method = 'GET', value = null) {
  const headers = { Authorization: `Bearer ${token}` };
  const init = { method, headers };
  if (value != null) {
    headers['Content-Type'] = 'application/json';
    headers['If-None-Match'] = '*';
    init.body = JSON.stringify(value);
  }
  return new Request(`https://worker.test/${pathname.replace(/^\//, '')}`, init);
}

const now = '2026-08-07T12:00:00.000Z';

test('data-maintenance role has an explicit narrow read/write boundary', async () => {
  const worker = workerUnderTest();
  const BUCKET = bucket();
  const env = { BROWSER_TOKEN: 'browser', AUTOMATION_TOKEN: 'automation', DATA_MAINTENANCE_TOKEN: 'maintenance', BUCKET };

  for (const name of ['bands.json', 'concerts.json', 'apiUsage.json', 'listening/manifest.json']) {
    assert.equal((await worker.fetch(request(name, 'maintenance'), env)).status, 200, name);
  }
  assert.equal((await worker.fetch(request('news.json', 'maintenance'), env)).status, 403);
  assert.equal((await worker.fetch(request('ticket-files/show/ticket.pdf', 'maintenance'), env)).status, 403);
  assert.equal((await worker.fetch(request('bands.json', 'maintenance', 'PUT', []), env)).status, 403);
  assert.equal((await worker.fetch(request('listening/manifest.json', 'maintenance', 'PUT', JSON.parse(BUCKET.values.get('listening/manifest.json'))), env)).status, 403);

  const metadata = {
    kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: now,
    records: { track1: { spotifyTrackId: 'track1', spotifyTrackUrl: 'https://open.spotify.com/track/track1', spotifyAlbumId: 'album1', spotifyAlbumUrl: 'https://open.spotify.com/album/album1', artworkUrl: 'https://image.test/a.jpg', spotifyArtistIds: ['artist1'], isrc: 'SEAAA1200001', fetchedAt: now, source: 'spotify_exact_track_id' } },
  };
  assert.equal((await worker.fetch(request('listening/spotify-metadata.json', 'maintenance', 'PUT', metadata), env)).status, 200);

  const identities = {
    kind: 'bandmarkr-listening-track-identities', schemaVersion: 1, updatedAt: now,
    records: { 'spotify:track1': { trackKey: 'spotify:track1', bandId: 'band-1', status: 'unresolved', evidence: [{ source: 'source_event' }], verifiedAt: null, nextEligibleCheckAt: now } },
  };
  assert.equal((await worker.fetch(request('listening/track-identities.json', 'maintenance', 'PUT', identities), env)).status, 200);

  const weather = {
    kind: 'bandmarkr-concert-weather', schemaVersion: 1, updatedAt: now,
    records: { 'concert-1': { concertId: 'concert-1', source: 'open-meteo', fetchedAt: now, nextEligibleCheckAt: now, coordinates: { latitude: 55.6, longitude: 13.0 }, forecast: { temperature: 18 } } },
  };
  assert.equal((await worker.fetch(request('weather.json', 'maintenance', 'PUT', weather), env)).status, 200);
  assert.equal((await worker.fetch(request('apiUsage.json', 'maintenance', 'PUT', { dataMaintenance: {} }), env)).status, 200);
});

test('browser may read new derived documents but cannot write maintenance-owned identity/weather data', async () => {
  const worker = workerUnderTest();
  const BUCKET = bucket();
  BUCKET.values.set('listening/track-identities.json', JSON.stringify({ kind: 'bandmarkr-listening-track-identities', schemaVersion: 1, updatedAt: now, records: {} }));
  BUCKET.values.set('weather.json', JSON.stringify({ kind: 'bandmarkr-concert-weather', schemaVersion: 1, updatedAt: now, records: {} }));
  const env = { BROWSER_TOKEN: 'browser', DATA_MAINTENANCE_TOKEN: 'maintenance', BUCKET };

  assert.equal((await worker.fetch(request('listening/track-identities.json', 'browser'), env)).status, 200);
  assert.equal((await worker.fetch(request('weather.json', 'browser'), env)).status, 200);
  assert.equal((await worker.fetch(request('listening/track-identities.json', 'browser', 'PUT', { kind: 'bandmarkr-listening-track-identities', schemaVersion: 1, records: {} }), env)).status, 403);
  assert.equal((await worker.fetch(request('weather.json', 'browser', 'PUT', { kind: 'bandmarkr-concert-weather', schemaVersion: 1, records: {} }), env)).status, 403);
});

test('track identity and weather writes fail closed on malformed documents', async () => {
  const worker = workerUnderTest();
  const env = { DATA_MAINTENANCE_TOKEN: 'maintenance', BUCKET: bucket() };
  const badIdentity = { kind: 'bandmarkr-listening-track-identities', schemaVersion: 1, updatedAt: now, records: { 'text:guess': { trackKey: 'text:guess', bandId: 'band-1', status: 'complete' } } };
  const badWeather = { kind: 'bandmarkr-concert-weather', schemaVersion: 1, updatedAt: now, records: { c1: { concertId: 'c1', source: 'other' } } };
  assert.equal((await worker.fetch(request('listening/track-identities.json', 'maintenance', 'PUT', badIdentity), env)).status, 400);
  assert.equal((await worker.fetch(request('weather.json', 'maintenance', 'PUT', badWeather), env)).status, 400);
});
