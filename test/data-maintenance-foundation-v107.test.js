'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
function source(file) { return fs.readFileSync(path.join(ROOT, file), 'utf8'); }

const worker = require('../worker');

function req(method, pathname, token = 'browser', body = undefined, headers = {}) {
  return new Request(`https://worker.example${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...headers },
    body,
  });
}

function bucket(initial = {}) {
  const data = new Map(Object.entries(initial).map(([key, body]) => [key, { body, etag: `${key}-etag` }]));
  return {
    async get(key) {
      const item = data.get(key);
      if (!item) return null;
      return { text: async () => item.body, httpEtag: `"${item.etag}"`, httpMetadata: { contentType: 'application/json' } };
    },
    async head(key) {
      const item = data.get(key);
      return item ? { httpEtag: `"${item.etag}"` } : null;
    },
    async put(key, body, options = {}) {
      const current = data.get(key);
      const ifMatch = options.onlyIf?.etagMatches;
      const ifNone = options.onlyIf?.etagDoesNotMatch;
      if (ifMatch && current?.etag !== ifMatch) throw new Error('412 precondition');
      if (ifNone === '*' && current) throw new Error('412 precondition');
      const nextEtag = `${key}-next`;
      data.set(key, { body, etag: nextEtag });
      return { httpEtag: `"${nextEtag}"` };
    },
    dump(key) { return data.get(key)?.body; },
  };
}

function env(overrides = {}) {
  return {
    BUCKET: bucket({
      'bands.json': '[]',
      'concerts.json': '[]',
      'news.json': '[]',
      'apiUsage.json': '{}',
      'listening/spotify-metadata.json': JSON.stringify({ schemaVersion: 1, updatedAt: '2026-08-12T00:00:00Z', records: {} }),
    }),
    BROWSER_TOKEN: 'browser',
    AUTOMATION_TOKEN: 'automation',
    MAINTENANCE_TOKEN: 'maintenance',
    READ_ONLY_TOKEN: 'read-only',
    ...overrides,
  };
}

test('maintenance role can read supported JSON and cannot use browser-only ticket routes', async () => {
  const e = env();
  let response = await worker.fetch(req('GET', '/bands.json', 'maintenance'), e);
  assert.equal(response.status, 200);
  response = await worker.fetch(req('GET', '/tickets/example', 'maintenance'), e);
  assert.equal(response.status, 403);
});

test('maintenance JSON write still requires optimistic concurrency', async () => {
  const e = env();
  let response = await worker.fetch(req('PUT', '/bands.json', 'maintenance', '[]', { 'Content-Type': 'application/json' }), e);
  assert.equal(response.status, 428);
  response = await worker.fetch(req('PUT', '/bands.json', 'maintenance', '[]', { 'Content-Type': 'application/json', 'If-Match': 'bands.json-etag' }), e);
  assert.equal(response.status, 200);
});

test('maintenance token must not alias another privileged role', async () => {
  let response = await worker.fetch(req('GET', '/bands.json', 'browser'), env({ MAINTENANCE_TOKEN: 'browser' }));
  assert.equal(response.status, 503);
  response = await worker.fetch(req('GET', '/bands.json', 'automation'), env({ MAINTENANCE_TOKEN: 'automation' }));
  assert.equal(response.status, 503);
});

test('spotify listening metadata validator accepts additive album metadata and future fields', async () => {
  const e = env();
  const id = 'spotify-track:synthetic';
  const good = {
    schemaVersion: 1,
    updatedAt: '2026-08-12T12:00:00Z',
    futureTop: { keep: true },
    records: {
      [id]: {
        sourceTrackKey: id,
        spotifyTrackId: 'synthetic',
        spotifyArtistIds: ['artist-1'],
        spotifyTrackUrl: 'https://open.spotify.com/track/synthetic',
        spotifyAlbumId: 'album-1',
        spotifyAlbumUrl: 'https://open.spotify.com/album/album-1',
        artworkUrl: 'https://i.scdn.co/image/synthetic',
        updatedAt: '2026-08-12T12:00:00Z',
        futureRecordField: 42,
      },
    },
  };
  let response = await worker.fetch(req('PUT', '/listening/spotify-metadata.json', 'maintenance', JSON.stringify(good), { 'Content-Type': 'application/json', 'If-Match': 'listening/spotify-metadata.json-etag' }), e);
  assert.equal(response.status, 200);

  const badType = structuredClone(good);
  badType.records[id].spotifyArtistIds = [123];
  response = await worker.fetch(req('PUT', '/listening/spotify-metadata.json', 'maintenance', JSON.stringify(badType), { 'Content-Type': 'application/json', 'If-Match': 'listening/spotify-metadata.json-next' }), e);
  assert.equal(response.status, 400);

  const badAlbumType = structuredClone(good);
  badAlbumType.records[id].spotifyAlbumId = 123;
  badAlbumType.records[id].spotifyAlbumUrl = 'https://open.spotify.com/album/123';
  response = await worker.fetch(req('PUT', '/listening/spotify-metadata.json', 'maintenance', JSON.stringify(badAlbumType), { 'Content-Type': 'application/json', 'If-Match': 'listening/spotify-metadata.json-next' }), e);
  assert.equal(response.status, 400);
});

test('active app and service-worker version assignments remain synchronized at v120', () => {
  const app = source('version.js').match(/^const APP_VERSION = '([^']+)';$/m)?.[1];
  const cache = source('service-worker.js').match(/^const CACHE_NAME_LITERAL = '([^']+)';$/m)?.[1];
  assert.equal(app, 'v120');
  assert.equal(cache, 'v120');
  assert.equal(app, cache);
});