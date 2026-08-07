'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const v101 = require('../spotifyListeningMetadataV101.js');

function response(status, body = null, headers = {}) {
  return new Response(body == null ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function spotifyUser() {
  return {
    validAuth: async () => ({ accessToken: 'synthetic-token', refreshToken: 'synthetic-refresh', clientId: 'synthetic-client' }),
    refresh: async (auth) => auth,
    clearAuth: async () => {},
  };
}

test('v101 uses Spotify single-track endpoint instead of removed batch endpoint', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return response(200, { id: 'TrackABC123', album: {}, external_urls: { spotify: 'https://open.spotify.com/track/TrackABC123' } });
  };
  const track = await v101.requestTrack('TrackABC123', { fetchImpl, spotifyUser: spotifyUser(), requestDelayMs: 0 });
  assert.equal(track.id, 'TrackABC123');
  assert.deepEqual(urls, ['https://api.spotify.com/v1/tracks/TrackABC123?market=SE']);
  assert.doesNotMatch(urls[0], /\/v1\/tracks\?/);
});

test('v102 accepts a valid Spotify relinked track response', async () => {
  const track = await v101.requestTrack('OriginalTrack123', {
    fetchImpl: async () => response(200, {
      id: 'RelinkedTrack456',
      album: { id: 'Album123', external_urls: { spotify: 'https://open.spotify.com/album/Album123' }, images: [] },
      external_urls: { spotify: 'https://open.spotify.com/track/RelinkedTrack456' },
    }),
    spotifyUser: spotifyUser(),
    requestDelayMs: 0,
  });
  assert.equal(track.id, 'RelinkedTrack456');
});

test('v102 preserves the requested trusted track identity when Spotify relinks metadata', async () => {
  const saved = [];
  const metadata = {
    emptyDocument: () => ({ kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} }),
    readRemote: async () => ({ document: { kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} }, etag: null, missing: true }),
    loadLocal: async () => ({ kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} }),
    mergeDocuments: (left) => ({ ...left, records: { ...(left.records || {}) } }),
    unresolvedTrackIds: () => ['OriginalTrack123'],
    recordFromSpotifyTrack: (track) => ({
      spotifyTrackId: track.id,
      spotifyTrackUrl: track.external_urls.spotify,
      spotifyAlbumId: track.album?.id || null,
      spotifyAlbumUrl: track.album?.external_urls?.spotify || null,
      artworkUrl: track.album?.images?.[0]?.url || null,
      fetchedAt: new Date().toISOString(),
      source: 'spotify_exact_track_id',
    }),
    saveLocal: async (document) => { saved.push(JSON.parse(JSON.stringify(document))); return document; },
    applyToEvents: () => {},
    documentsEqual: () => false,
    writeRemote: async () => {},
  };
  const fetchImpl = async () => response(200, {
    id: 'RelinkedTrack456',
    album: {
      id: 'Album123',
      external_urls: { spotify: 'https://open.spotify.com/album/Album123' },
      images: [{ url: 'https://i.scdn.co/image/synthetic', width: 640, height: 640 }],
    },
    external_urls: { spotify: 'https://open.spotify.com/track/RelinkedTrack456' },
  });

  const result = await v101.enrich({ metadata, spotifyUser: spotifyUser(), fetchImpl, requestDelayMs: 0 });
  assert.equal(result.added, 1);
  const record = saved.at(-1).records.OriginalTrack123;
  assert.ok(record);
  assert.equal(record.spotifyTrackId, 'OriginalTrack123');
  assert.equal(record.spotifyTrackUrl, 'https://open.spotify.com/track/OriginalTrack123');
  assert.equal(record.spotifyAlbumId, 'Album123');
  assert.equal(record.spotifyProviderResolvedTrackId, 'RelinkedTrack456');
  assert.equal(record.spotifyProviderRelinked, true);
  assert.equal(saved.at(-1).records.RelinkedTrack456, undefined);
});

test('v102 still rejects malformed successful Spotify track responses', async () => {
  await assert.rejects(
    () => v101.requestTrack('TrackABC123', {
      fetchImpl: async () => response(200, { id: '', album: {}, external_urls: {} }),
      spotifyUser: spotifyUser(),
      requestDelayMs: 0,
    }),
    /invalid track metadata response/,
  );
});

test('v101 refreshes once after 401 and uses the refreshed bearer token', async () => {
  let requestCount = 0;
  let refreshCount = 0;
  const authorizations = [];
  const user = {
    validAuth: async () => ({ accessToken: 'expired-token', refreshToken: 'synthetic-refresh', clientId: 'synthetic-client' }),
    refresh: async (auth) => {
      refreshCount += 1;
      return { ...auth, accessToken: 'refreshed-token' };
    },
    clearAuth: async () => {},
  };
  const fetchImpl = async (_url, options) => {
    requestCount += 1;
    authorizations.push(new Headers(options.headers).get('Authorization'));
    if (requestCount === 1) return response(401);
    return response(200, { id: 'TrackABC123', album: {}, external_urls: { spotify: 'https://open.spotify.com/track/TrackABC123' } });
  };
  const track = await v101.requestTrack('TrackABC123', { fetchImpl, spotifyUser: user, requestDelayMs: 0 });
  assert.equal(track.id, 'TrackABC123');
  assert.equal(refreshCount, 1);
  assert.deepEqual(authorizations, ['Bearer expired-token', 'Bearer refreshed-token']);
});

test('v101 honors one 429 retry and does not create an unbounded retry loop', async () => {
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount += 1;
    if (requestCount === 1) return response(429, null, { 'retry-after': '0' });
    return response(200, { id: 'TrackABC123', album: {}, external_urls: { spotify: 'https://open.spotify.com/track/TrackABC123' } });
  };
  const track = await v101.requestTrack('TrackABC123', { fetchImpl, spotifyUser: spotifyUser(), requestDelayMs: 0 });
  assert.equal(track.id, 'TrackABC123');
  assert.equal(requestCount, 2);

  requestCount = 0;
  await assert.rejects(
    () => v101.requestTrack('TrackABC123', {
      fetchImpl: async () => { requestCount += 1; return response(429, null, { 'retry-after': '0' }); },
      spotifyUser: spotifyUser(),
      requestDelayMs: 0,
    }),
    /failed \(429\)/,
  );
  assert.equal(requestCount, 2);
});

test('v101 403 does not falsely tell a connected user to reconnect', async () => {
  await assert.rejects(
    () => v101.requestTrack('TrackABC123', { fetchImpl: async () => response(403), spotifyUser: spotifyUser(), requestDelayMs: 0 }),
    (error) => {
      assert.match(error.message, /saved Spotify connection is still present/);
      assert.doesNotMatch(error.message, /Connect again/);
      return true;
    },
  );
});

test('v101 treats a missing exact track as unresolved instead of corrupting metadata', async () => {
  const result = await v101.requestTrack('TrackABC123', {
    fetchImpl: async () => response(404),
    spotifyUser: spotifyUser(),
    requestDelayMs: 0,
  });
  assert.equal(result, null);
});

test('v101 enrichment is capped, paced and persists bounded progress', async () => {
  const ids = Array.from({ length: 600 }, (_, index) => `Track${index}`);
  const saved = [];
  const paths = [];
  const metadata = {
    emptyDocument: () => ({ kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} }),
    readRemote: async () => ({ document: { kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} }, etag: null, missing: true }),
    loadLocal: async () => ({ kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} }),
    mergeDocuments: (left) => ({ ...left, records: { ...(left.records || {}) } }),
    unresolvedTrackIds: () => ids,
    recordFromSpotifyTrack: (track) => ({ spotifyTrackId: track.id, spotifyTrackUrl: `https://open.spotify.com/track/${track.id}`, spotifyAlbumId: null, spotifyAlbumUrl: null, artworkUrl: null, fetchedAt: new Date().toISOString(), source: 'spotify_exact_track_id' }),
    saveLocal: async (document) => { saved.push(Object.keys(document.records).length); return document; },
    applyToEvents: () => {},
    documentsEqual: () => false,
    writeRemote: async () => {},
  };
  const user = spotifyUser();
  const fetchImpl = async (url) => {
    paths.push(new URL(url).pathname);
    const id = new URL(url).pathname.split('/').pop();
    return response(200, { id, album: {}, external_urls: { spotify: `https://open.spotify.com/track/${id}` } });
  };
  const result = await v101.enrich({ metadata, spotifyUser: user, fetchImpl, requestDelayMs: 0 });
  assert.equal(result.requested, 500);
  assert.equal(result.added, 500);
  assert.equal(paths.length, 500);
  assert.ok(paths.every((path) => /^\/v1\/tracks\/Track\d+$/.test(path)));
  assert.ok(saved.length >= 20);
  assert.equal(saved.at(-1), 500);
});
