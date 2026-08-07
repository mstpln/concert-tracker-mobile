'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const spotifyMetadata = require('../spotifyListeningMetadataV101.js');

function response(status, body = null) {
  return new Response(body == null ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function spotifyUser() {
  return {
    validAuth: async () => ({ accessToken: 'synthetic-token', refreshToken: 'synthetic-refresh', clientId: 'synthetic-client' }),
    refresh: async (auth) => auth,
    clearAuth: async () => {},
  };
}

function metadataFixture(ids) {
  let local = { kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} };
  return {
    emptyDocument: () => ({ kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} }),
    readRemote: async () => ({ document: { kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} }, etag: null, missing: true }),
    loadLocal: async () => JSON.parse(JSON.stringify(local)),
    mergeDocuments: (left) => ({ ...left, records: { ...(left.records || {}) } }),
    unresolvedTrackIds: (document) => ids.filter((id) => !document.records[id]),
    recordFromSpotifyTrack: (track) => ({
      spotifyTrackId: track.id,
      spotifyTrackUrl: track.external_urls.spotify,
      spotifyAlbumId: null,
      spotifyAlbumUrl: null,
      artworkUrl: null,
      fetchedAt: new Date().toISOString(),
      source: 'spotify_exact_track_id',
    }),
    saveLocal: async (document) => {
      local = JSON.parse(JSON.stringify(document));
      return JSON.parse(JSON.stringify(local));
    },
    applyToEvents: () => {},
    documentsEqual: () => true,
    writeRemote: async () => {},
  };
}

function visibilityDocument() {
  const listeners = new Set();
  return {
    visibilityState: 'visible',
    addEventListener(type, listener) {
      if (type === 'visibilitychange') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'visibilitychange') listeners.delete(listener);
    },
    setVisibility(value) {
      this.visibilityState = value;
      for (const listener of [...listeners]) listener();
    },
  };
}

test('v103 stops after the app leaves the foreground and manual retry skips every saved Spotify track', async () => {
  const ids = ['Track0', 'Track1', 'Track2'];
  const metadata = metadataFixture(ids);
  const fakeDocument = visibilityDocument();
  const previousDocument = global.document;
  global.document = fakeDocument;

  try {
    const firstRunRequests = [];
    await assert.rejects(
      () => spotifyMetadata.enrich({
        metadata,
        spotifyUser: spotifyUser(),
        requestDelayMs: 0,
        fetchImpl: async (url) => {
          const id = new URL(url).pathname.split('/').pop();
          firstRunRequests.push(id);
          return response(200, { id, album: {}, external_urls: { spotify: `https://open.spotify.com/track/${id}` } });
        },
        onProgress: ({ processed }) => {
          if (processed === 1) fakeDocument.setVisibility('hidden');
        },
      }),
      (error) => {
        assert.match(error.message, /left the foreground/i);
        assert.deepEqual(error.liveVaultProgress, { processed: 1, total: 3, added: 1 });
        return true;
      },
    );
    assert.deepEqual(firstRunRequests, ['Track0']);

    fakeDocument.setVisibility('visible');
    const retryRequests = [];
    const result = await spotifyMetadata.enrich({
      metadata,
      spotifyUser: spotifyUser(),
      requestDelayMs: 0,
      fetchImpl: async (url) => {
        const id = new URL(url).pathname.split('/').pop();
        retryRequests.push(id);
        return response(200, { id, album: {}, external_urls: { spotify: `https://open.spotify.com/track/${id}` } });
      },
    });

    assert.deepEqual(retryRequests, ['Track1', 'Track2']);
    assert.equal(result.requested, 2);
    assert.equal(result.added, 2);
  } finally {
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
  }
});
