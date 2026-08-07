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
