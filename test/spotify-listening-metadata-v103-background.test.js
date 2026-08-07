'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const spotifyMetadata = require('../spotifyListeningMetadataV101.js');

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

function memoryStore() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test('v103 stops after the app leaves the foreground and manual retry skips every saved Spotify track', async () => {
  const ids = ['Track0', 'Track1', 'Track2'];
  const metadata = metadataFixture(ids);
  const fakeDocument = visibilityDocument();
  const store = memoryStore();
  const previousDocument = global.document;
  global.document = fakeDocument;

  try {
    const firstRunRequests = [];
    await assert.rejects(
      () => spotifyMetadata.enrich({
        metadata,
        spotifyUser: spotifyUser(),
        requestDelayMs: 0,
        runStateStore: store,
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
      runStateStore: store,
      fetchImpl: async (url) => {
        const id = new URL(url).pathname.split('/').pop();
        retryRequests.push(id);
        return response(200, { id, album: {}, external_urls: { spotify: `https://open.spotify.com/track/${id}` } });
      },
    });

    assert.deepEqual(retryRequests, ['Track1', 'Track2']);
    assert.equal(result.requested, 2);
    assert.equal(result.batchTotal, 3);
    assert.equal(result.batchProcessed, 3);
    assert.equal(result.added, 2);
  } finally {
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
  }
});

test('v103 retry finishes only the remainder of the original 100-track run instead of starting another 100', async () => {
  const ids = Array.from({ length: 150 }, (_, index) => `Track${index}`);
  const metadata = metadataFixture(ids);
  const fakeDocument = visibilityDocument();
  const store = memoryStore();
  const previousDocument = global.document;
  global.document = fakeDocument;

  try {
    const firstRunRequests = [];
    await assert.rejects(
      () => spotifyMetadata.enrich({
        metadata,
        spotifyUser: spotifyUser(),
        requestDelayMs: 0,
        runStateStore: store,
        fetchImpl: async (url) => {
          const id = new URL(url).pathname.split('/').pop();
          firstRunRequests.push(id);
          return response(200, { id, album: {}, external_urls: { spotify: `https://open.spotify.com/track/${id}` } });
        },
        onProgress: ({ processed }) => {
          if (processed === 50) fakeDocument.setVisibility('hidden');
        },
      }),
      (error) => {
        assert.deepEqual(error.liveVaultProgress, { processed: 50, total: 100, added: 50 });
        return true;
      },
    );
    assert.equal(firstRunRequests.length, 50);

    fakeDocument.setVisibility('visible');
    const retryRequests = [];
    const result = await spotifyMetadata.enrich({
      metadata,
      spotifyUser: spotifyUser(),
      requestDelayMs: 0,
      runStateStore: store,
      fetchImpl: async (url) => {
        const id = new URL(url).pathname.split('/').pop();
        retryRequests.push(id);
        return response(200, { id, album: {}, external_urls: { spotify: `https://open.spotify.com/track/${id}` } });
      },
    });

    assert.equal(retryRequests.length, 50);
    assert.deepEqual(retryRequests, ids.slice(50, 100));
    assert.equal(result.requested, 50);
    assert.equal(result.batchTotal, 100);
    assert.equal(result.batchProcessed, 100);
    assert.equal(metadata.unresolvedTrackIds(await metadata.loadLocal()).length, 50);
  } finally {
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
  }
});

test('v103 does not make a hidden automatic retry after Spotify asks it to wait', async () => {
  let requests = 0;
  let stopped = false;
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback) => {
    stopped = true;
    callback();
    return 0;
  };

  try {
    await assert.rejects(
      () => spotifyMetadata.requestTrack('TrackRetry123', {
        spotifyUser: spotifyUser(),
        requestDelayMs: 1,
        shouldStop: () => stopped,
        fetchImpl: async () => {
          requests += 1;
          return response(429, { error: { status: 429, message: 'Too many requests' } }, { 'Retry-After': '1' });
        },
      }),
      /left the foreground/i,
    );
    assert.equal(requests, 1);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});
