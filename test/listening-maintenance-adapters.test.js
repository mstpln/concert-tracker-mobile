'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createListeningMaintenanceClient } = require('../scripts/lib/listeningMaintenanceClient');
const { createListeningMaintenanceProviders, retryAtFromHeader } = require('../scripts/lib/listeningMaintenanceProviders');

function response(status, data = {}, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get(name) { return headers[String(name).toLowerCase()] ?? null; } },
    async json() { return data; },
    async text() { return JSON.stringify(data); },
  };
}

test('maintenance worker client uses the dedicated token and conditional writes', async () => {
  const calls = [];
  const client = createListeningMaintenanceClient({
    env: { CF_WORKER_ENDPOINT: 'https://worker.test/', DATA_MAINTENANCE_TOKEN: 'maintenance-secret' },
    async fetchImpl(url, options = {}) {
      calls.push({ url, options });
      if (!options.method) return response(200, { kind: 'livevault-track-identities', schemaVersion: 1, updatedAt: null, records: {} }, { etag: 'identity-1' });
      return response(200, {}, { etag: 'identity-2' });
    },
  });

  const document = await client.readJson('listening/track-identities.json', null);
  await client.writeJsonStrict('listening/track-identities.json', document);

  assert.equal(calls[0].options.headers.Authorization, 'Bearer maintenance-secret');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer maintenance-secret');
  assert.equal(calls[1].options.headers['If-Match'], 'identity-1');
  assert.equal(calls[1].options.method, 'PUT');
});

test('Spotify exact-track adapter sends only the exact ID and preserves provider payload', async () => {
  const calls = [];
  const providers = createListeningMaintenanceProviders({
    spotifyTokenProvider: async () => 'spotify-token',
    listenbrainzTokenProvider: async () => 'lb-token',
    async fetchImpl(url, options = {}) {
      calls.push({ url, options });
      return response(200, { id: 'Track123', external_ids: { isrc: 'USABC1234567' }, artists: [{ id: 'Artist123' }] });
    },
  });
  const result = await providers.spotify.exact_track({ spotifyTrackId: 'Track123' });
  assert.equal(result.kind, 'ok');
  assert.equal(result.data.external_ids.isrc, 'USABC1234567');
  assert.equal(calls[0].url, 'https://api.spotify.com/v1/tracks/Track123');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer spotify-token');
});

test('MusicBrainz ISRC adapter requests artist credits with the reviewed User-Agent', async () => {
  const calls = [];
  const providers = createListeningMaintenanceProviders({
    async fetchImpl(url, options = {}) {
      calls.push({ url, options });
      return response(200, { recordings: [] });
    },
  });
  const result = await providers.musicbrainz.isrc_lookup({ isrc: 'usabc1234567' });
  assert.equal(result.kind, 'ok');
  assert.match(calls[0].url, /\/isrc\/USABC1234567\?fmt=json&inc=artist-credits$/);
  assert.match(calls[0].options.headers['User-Agent'], /LiveVault|TheLiveVault/);
});

test('ListenBrainz adapter authenticates metadata lookup without adding release text', async () => {
  const calls = [];
  const providers = createListeningMaintenanceProviders({
    listenbrainzTokenProvider: async () => 'listenbrainz-token',
    async fetchImpl(url, options = {}) {
      calls.push({ url, options });
      return response(200, { recording_mbid: '22222222-2222-4222-8222-222222222222' });
    },
  });
  const result = await providers.listenbrainz.metadata_lookup({ artistName: 'Synthetic Artist', recordingName: 'Synthetic Song' });
  assert.equal(result.kind, 'ok');
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('artist_name'), 'Synthetic Artist');
  assert.equal(url.searchParams.get('recording_name'), 'Synthetic Song');
  assert.equal(url.searchParams.has('release_name'), false);
  assert.equal(calls[0].options.headers.Authorization, 'Token listenbrainz-token');
});

test('rate limits become explicit retry state only when Retry-After is usable', async () => {
  const now = Date.parse('2026-08-08T09:00:00.000Z');
  assert.equal(retryAtFromHeader(response(429, {}, { 'retry-after': '30' }), now), '2026-08-08T09:00:30.000Z');

  const providers = createListeningMaintenanceProviders({
    now: () => now,
    spotifyTokenProvider: async () => 'spotify-token',
    async fetchImpl() { return response(429, {}, { 'retry-after': '30' }); },
  });
  const retry = await providers.spotify.exact_track({ spotifyTrackId: 'Track123' });
  assert.deepEqual(retry, { kind: 'retry', reason: 'http_429', nextEligibleCheckAt: '2026-08-08T09:00:30.000Z' });

  const noHeaderProviders = createListeningMaintenanceProviders({
    spotifyTokenProvider: async () => 'spotify-token',
    async fetchImpl() { return response(429); },
  });
  assert.deepEqual(await noHeaderProviders.spotify.exact_track({ spotifyTrackId: 'Track123' }), { kind: 'error', reason: 'http_429' });
});
