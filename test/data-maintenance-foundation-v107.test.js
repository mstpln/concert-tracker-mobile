'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function source(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function workerUnderTest() {
  const code = source('worker.js').replace('export default {', 'globalThis.worker = {');
  const context = { Response, Request, URL, TextDecoder, AbortController, setTimeout, clearTimeout, globalThis: {} };
  vm.runInNewContext(code, context);
  return context.globalThis.worker;
}
function bucket() {
  const items = new Map([
    ['bands.json', { value: '[]', etag: 'bands-1' }],
    ['concerts.json', { value: '[]', etag: 'concerts-1' }],
    ['news.json', { value: '[]', etag: 'news-1' }],
    ['apiUsage.json', { value: '{}', etag: 'usage-1' }],
    ['listening/manifest.json', { value: JSON.stringify({ kind: 'livevault-listening-vault', schemaVersion: 1, archive: { source: 'spotify_import', path: `listening/spotify-history/${'a'.repeat(64)}.json.gz`, sha256: 'a'.repeat(64), contentEncoding: 'gzip', eventCount: 1 }, incrementals: [] }), etag: 'manifest-1' }],
    ['listening/spotify-metadata.json', { value: JSON.stringify({ kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} }), etag: 'metadata-1' }],
  ]);
  const object = (entry) => entry && ({ body: entry.value, text: async () => entry.value, etag: entry.etag, httpEtag: `"${entry.etag}"` });
  return {
    async get(key) { return object(items.get(key)); },
    async head(key) { return object(items.get(key)); },
    async put(key, value, options) {
      const existing = items.get(key);
      const condition = options?.onlyIf;
      if (condition?.etagMatches && existing?.etag !== condition.etagMatches) return null;
      if (condition?.etagDoesNotMatch === '*' && existing) return null;
      const entry = { value: String(value), etag: `${key}-next` };
      items.set(key, entry);
      return object(entry);
    },
    async delete(key) { items.delete(key); },
  };
}
function req(method, pathname, token, body, headers = {}) {
  return new Request(`https://worker.test${pathname}`, { method, headers: { Authorization: `Bearer ${token}`, ...headers }, body });
}

test('data maintenance role is least privilege', async () => {
  const worker = workerUnderTest();
  const env = { BROWSER_TOKEN: 'browser', AUTOMATION_TOKEN: 'automation', DATA_MAINTENANCE_TOKEN: 'maintenance', BUCKET: bucket() };

  assert.equal((await worker.fetch(req('GET', '/bands.json', 'maintenance'), env)).status, 200);
  assert.equal((await worker.fetch(req('GET', '/concerts.json', 'maintenance'), env)).status, 200);
  assert.equal((await worker.fetch(req('GET', '/apiUsage.json', 'maintenance'), env)).status, 200);
  assert.equal((await worker.fetch(req('GET', '/news.json', 'maintenance'), env)).status, 403);
  assert.equal((await worker.fetch(req('PUT', '/bands.json', 'maintenance', '[]', { 'Content-Type': 'application/json', 'If-Match': 'bands-1' }), env)).status, 403);
  assert.equal((await worker.fetch(req('PUT', '/concerts.json', 'maintenance', '[]', { 'Content-Type': 'application/json', 'If-Match': 'concerts-1' }), env)).status, 403);
  assert.equal((await worker.fetch(req('GET', '/ticket-files/show-1/ticket-1.pdf', 'maintenance'), env)).status, 403);
  assert.equal((await worker.fetch(req('GET', '/listening/manifest.json', 'maintenance'), env)).status, 200);
  assert.equal((await worker.fetch(req('PUT', '/listening/manifest.json', 'maintenance', '{}', { 'Content-Type': 'application/json', 'If-Match': 'manifest-1' }), env)).status, 403);
  assert.equal((await worker.fetch(req('GET', '/listening/manifest.json', 'automation'), env)).status, 403);
});

test('maintenance can create track identities only through validated conditional JSON writes', async () => {
  const worker = workerUnderTest();
  const env = { DATA_MAINTENANCE_TOKEN: 'maintenance', BUCKET: bucket() };
  const key = 'spotify:4uLU6hMCjMI75M1A2tKUQC';
  const good = {
    kind: 'livevault-track-identities', schemaVersion: 1, updatedAt: '2026-08-07T18:00:00.000Z', records: {
      [key]: {
        workKey: key,
        localBandId: 'band-1',
        spotifyTrackId: '4uLU6hMCjMI75M1A2tKUQC',
        spotifyArtistIds: ['0du5cEVh5yTK9QJze8zA0C'],
        isrc: 'USAT29900609',
        musicbrainzRecordingId: '123e4567-e89b-42d3-a456-426614174000',
        musicbrainzArtistIds: ['123e4567-e89b-42d3-a456-426614174001'],
        status: 'resolved',
        updatedAt: '2026-08-07T18:00:00.000Z',
        futureField: { kept: true },
      },
    },
  };

  let response = await worker.fetch(req('PUT', '/listening/track-identities.json', 'maintenance', JSON.stringify(good), { 'Content-Type': 'application/json', 'If-None-Match': '*' }), env);
  assert.equal(response.status, 200);
  response = await worker.fetch(req('GET', '/listening/track-identities.json', 'maintenance'), env);
  assert.equal(response.status, 200);

  const bad = structuredClone(good);
  bad.records[key].isrc = 'bad';
  response = await worker.fetch(req('PUT', '/listening/track-identities.json', 'maintenance', JSON.stringify(bad), { 'Content-Type': 'application/json', 'If-Match': 'listening/track-identities.json-next' }), env);
  assert.equal(response.status, 400);
});

test('spotify metadata contract accepts additive artist ids and ISRC but rejects malformed provider fields', async () => {
  const worker = workerUnderTest();
  const env = { DATA_MAINTENANCE_TOKEN: 'maintenance', BUCKET: bucket() };
  const id = '4uLU6hMCjMI75M1A2tKUQC';
  const good = {
    kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: '2026-08-07T18:00:00.000Z', records: {
      [id]: {
        spotifyTrackId: id,
        spotifyTrackUrl: `https://open.spotify.com/track/${id}`,
        spotifyAlbumId: '6JWc4iAiJ9FjyK0B59ABb4',
        spotifyAlbumUrl: 'https://open.spotify.com/album/6JWc4iAiJ9FjyK0B59ABb4',
        artworkUrl: 'https://i.scdn.co/image/example',
        spotifyArtistIds: ['0du5cEVh5yTK9QJze8zA0C'],
        isrc: 'USAT29900609',
        fetchedAt: '2026-08-07T18:00:00.000Z',
        source: 'spotify_exact_track_id',
        futureField: 'preserved',
      },
    },
  };

  let response = await worker.fetch(req('PUT', '/listening/spotify-metadata.json', 'maintenance', JSON.stringify(good), { 'Content-Type': 'application/json', 'If-Match': 'metadata-1' }), env);
  assert.equal(response.status, 200);

  const bad = structuredClone(good);
  bad.records[id].spotifyArtistIds = ['not valid!'];
  response = await worker.fetch(req('PUT', '/listening/spotify-metadata.json', 'maintenance', JSON.stringify(bad), { 'Content-Type': 'application/json', 'If-Match': 'listening/spotify-metadata.json-next' }), env);
  assert.equal(response.status, 400);
});

test('v107 remains synchronized across app and service-worker cache', () => {
  assert.match(source('version.js'), /APP_VERSION = 'v107'/);
  assert.match(source('service-worker.js'), /CACHE_NAME_LITERAL = 'v107'/);
});
