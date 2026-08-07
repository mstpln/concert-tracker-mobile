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

function metadataFixture(ids, saved, initial = null) {
  let local = initial || { kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} };
  return {
    emptyDocument: () => ({ kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} }),
    readRemote: async () => ({ document: { kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} }, etag: null, missing: true }),
    loadLocal: async () => JSON.parse(JSON.stringify(local)),
    mergeDocuments: (left) => ({ ...left, records: { ...(left.records || {}) } }),
    unresolvedTrackIds: (document) => ids.filter((id) => !document.records[id]),
    recordFromSpotifyTrack: (track) => ({
      spotifyTrackId: track.id,
      spotifyTrackUrl: track.external_urls.spotify,
      spotifyAlbumId: track.album?.id || null,
      spotifyAlbumUrl: track.album?.external_urls?.spotify || null,
      artworkUrl: track.album?.images?.[0]?.url || null,
      fetchedAt: new Date().toISOString(),
      source: 'spotify_exact_track_id',
    }),
    saveLocal: async (document) => {
      local = JSON.parse(JSON.stringify(document));
      saved.push(local);
      return local;
    },
    applyToEvents: () => {},
    documentsEqual: () => false,
    writeRemote: async () => {},
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
  const metadata = metadataFixture(['OriginalTrack123'], saved);
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

test('v103 still rejects malformed successful Spotify track responses with clear safe feedback', async () => {
  await assert.rejects(
    () => v101.requestTrack('TrackABC123', {
      fetchImpl: async () => response(200, { id: '', album: {}, external_urls: {} }),
      spotifyUser: spotifyUser(),
      requestDelayMs: 0,
    }),
    /could not safely use.*Nothing was guessed or overwritten/i,
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

test('v103 honors Retry-After once and then gives understandable temporary rate-limit feedback', async () => {
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount += 1;
    if (requestCount === 1) return response(429, { error: { status: 429, message: 'Too many requests' } }, { 'retry-after': '0' });
    return response(200, { id: 'TrackABC123', album: {}, external_urls: { spotify: 'https://open.spotify.com/track/TrackABC123' } });
  };
  const track = await v101.requestTrack('TrackABC123', { fetchImpl, spotifyUser: spotifyUser(), requestDelayMs: 0 });
  assert.equal(track.id, 'TrackABC123');
  assert.equal(requestCount, 2);

  requestCount = 0;
  await assert.rejects(
    () => v101.requestTrack('TrackABC123', {
      fetchImpl: async () => { requestCount += 1; return response(429, { error: { status: 429 } }, { 'retry-after': '12' }); },
      spotifyUser: spotifyUser(),
      requestDelayMs: 0,
    }),
    (error) => {
      assert.match(error.message, /temporarily rate-limiting/i);
      assert.match(error.message, /12 seconds/i);
      assert.match(error.message, /kept the artwork already fetched/i);
      return true;
    },
  );
  assert.equal(requestCount, 2);
});

test('v103 stops immediately on Spotify Development Mode quota exhaustion and explains reconnecting will not help', async () => {
  let requestCount = 0;
  await assert.rejects(
    () => v101.requestTrack('TrackABC123', {
      fetchImpl: async () => {
        requestCount += 1;
        return response(429, { error: { status: 429, message: 'Too many requests', reason: 'QUOTA_EXCEEDED' } }, { 'retry-after': '30' });
      },
      spotifyUser: spotifyUser(),
      requestDelayMs: 0,
    }),
    (error) => {
      assert.match(error.message, /Development Mode quota/i);
      assert.match(error.message, /stopped safely/i);
      assert.match(error.message, /Reconnecting Spotify will not help/i);
      return true;
    },
  );
  assert.equal(requestCount, 1);
});

test('v101 403 does not falsely tell a connected user to reconnect', async () => {
  await assert.rejects(
    () => v101.requestTrack('TrackABC123', { fetchImpl: async () => response(403), spotifyUser: spotifyUser(), requestDelayMs: 0 }),
    (error) => {
      assert.match(error.message, /connection is still saved/i);
      assert.match(error.message, /reconnecting is not expected to fix/i);
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

test('v103 enrichment uses a 100-track cap, 1-second pacing and saves after every processed track', async () => {
  const ids = Array.from({ length: 150 }, (_, index) => `Track${index}`);
  const saved = [];
  const paths = [];
  const metadata = metadataFixture(ids, saved);
  const fetchImpl = async (url) => {
    paths.push(new URL(url).pathname);
    const id = new URL(url).pathname.split('/').pop();
    return response(200, { id, album: {}, external_urls: { spotify: `https://open.spotify.com/track/${id}` } });
  };
  const result = await v101.enrich({ metadata, spotifyUser: spotifyUser(), fetchImpl, requestDelayMs: 0 });
  assert.equal(v101.MAX_TRACKS_PER_RUN, 100);
  assert.equal(v101.PERSIST_EVERY, 1);
  assert.equal(v101.REQUEST_DELAY_MS, 1000);
  assert.equal(result.requested, 100);
  assert.equal(result.added, 100);
  assert.equal(paths.length, 100);
  assert.equal(saved.length, 100);
  assert.equal(Object.keys(saved.at(-1).records).length, 100);
});

test('v103 preserves every completed track when Spotify stops a run with 429', async () => {
  const ids = Array.from({ length: 20 }, (_, index) => `Track${index}`);
  const saved = [];
  const metadata = metadataFixture(ids, saved);
  let calls = 0;
  await assert.rejects(
    () => v101.enrich({
      metadata,
      spotifyUser: spotifyUser(),
      requestDelayMs: 0,
      fetchImpl: async (url) => {
        calls += 1;
        const id = new URL(url).pathname.split('/').pop();
        if (calls === 13) return response(429, { error: { status: 429, reason: 'QUOTA_EXCEEDED' } });
        return response(200, { id, album: {}, external_urls: { spotify: `https://open.spotify.com/track/${id}` } });
      },
    }),
    (error) => {
      assert.match(error.message, /Development Mode quota/i);
      assert.deepEqual(error.liveVaultProgress, { processed: 12, total: 20, added: 12 });
      return true;
    },
  );
  assert.equal(saved.length, 12);
  assert.equal(Object.keys(saved.at(-1).records).length, 12);
});

test('v103 manual retry resumes from the first unresolved track and never repeats saved Spotify requests', async () => {
  const ids = Array.from({ length: 6 }, (_, index) => `Track${index}`);
  const saved = [];
  const metadata = metadataFixture(ids, saved);
  const firstRunRequests = [];
  let calls = 0;
  await assert.rejects(
    () => v101.enrich({
      metadata,
      spotifyUser: spotifyUser(),
      requestDelayMs: 0,
      fetchImpl: async (url) => {
        const id = new URL(url).pathname.split('/').pop();
        firstRunRequests.push(id);
        calls += 1;
        if (calls === 4) return response(429, { error: { status: 429, reason: 'QUOTA_EXCEEDED' } });
        return response(200, { id, album: {}, external_urls: { spotify: `https://open.spotify.com/track/${id}` } });
      },
    }),
    /Development Mode quota/i,
  );
  assert.deepEqual(firstRunRequests, ['Track0', 'Track1', 'Track2', 'Track3']);
  assert.equal(Object.keys(saved.at(-1).records).length, 3);

  const retryRequests = [];
  const result = await v101.enrich({
    metadata,
    spotifyUser: spotifyUser(),
    requestDelayMs: 0,
    fetchImpl: async (url) => {
      const id = new URL(url).pathname.split('/').pop();
      retryRequests.push(id);
      return response(200, { id, album: {}, external_urls: { spotify: `https://open.spotify.com/track/${id}` } });
    },
  });
  assert.deepEqual(retryRequests, ['Track3', 'Track4', 'Track5']);
  assert.equal(result.requested, 3);
  assert.equal(Object.keys(saved.at(-1).records).length, 6);
});
