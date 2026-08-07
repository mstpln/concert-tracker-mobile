'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const source = require('../scripts/spotify-artwork-backfill-source.js');

function gzipJson(value) {
  const text = JSON.stringify(value);
  return { text, bytes: zlib.gzipSync(Buffer.from(text)), sha256: source.sha256Hex(text) };
}

function spotifyPath(sha256) {
  return `listening/spotify-history/${sha256}.json.gz`;
}

function listenbrainzPath(sha256) {
  return `listening/listenbrainz/2026-08/${sha256}.json.gz`;
}

function fixtureFetch(routes) {
  return async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const route = routes[url.pathname];
    if (!route) return new Response('not found', { status: 404 });
    if (route.json) return new Response(JSON.stringify(route.json), { status: 200, headers: { 'Content-Type': 'application/json', ETag: '"fixture"' } });
    return new Response(route.bytes, { status: 200, headers: { 'Content-Type': 'application/gzip' } });
  };
}

test('reads and verifies the Spotify archive plus ListenBrainz incrementals', async () => {
  const base = gzipJson({
    kind: 'livevault-listening-history',
    schemaVersion: 1,
    events: [{ stableListenId: 'spotify-1', spotifyTrackId: 'TrackA' }],
  });
  const incremental = gzipJson({
    kind: 'livevault-listening-incremental',
    schemaVersion: 1,
    source: 'listenbrainz',
    events: [{ stableListenId: 'lb-1', spotifyTrackId: 'TrackB' }],
  });
  const basePath = spotifyPath(base.sha256);
  const incrementalPath = listenbrainzPath(incremental.sha256);
  const manifest = {
    kind: 'livevault-listening-vault',
    schemaVersion: 1,
    archive: {
      source: 'spotify_import', path: basePath, sha256: base.sha256, contentEncoding: 'gzip', eventCount: 1,
    },
    incrementals: [{
      source: 'listenbrainz', path: incrementalPath, sha256: incremental.sha256, contentEncoding: 'gzip', eventCount: 1,
    }],
  };
  const result = await source.readAllSourceEvents({
    endpoint: 'https://worker.invalid',
    token: 'synthetic-token',
    fetchImpl: fixtureFetch({
      '/listening/manifest.json': { json: manifest },
      [`/${basePath}`]: { bytes: base.bytes },
      [`/${incrementalPath}`]: { bytes: incremental.bytes },
    }),
  });
  assert.deepEqual(result.events.map((event) => event.spotifyTrackId), ['TrackA', 'TrackB']);
  assert.deepEqual(result.counts, {
    spotifyArchiveEvents: 1,
    incrementalObjects: 1,
    incrementalEvents: 1,
    totalEvents: 2,
  });
});

test('fails closed when an archive body checksum does not match the manifest', async () => {
  const base = gzipJson({ kind: 'livevault-listening-history', schemaVersion: 1, events: [] });
  const declaredSha = '0'.repeat(64);
  const basePath = spotifyPath(declaredSha);
  const manifest = {
    kind: 'livevault-listening-vault',
    schemaVersion: 1,
    archive: {
      source: 'spotify_import', path: basePath, sha256: declaredSha, contentEncoding: 'gzip', eventCount: 0,
    },
    incrementals: [],
  };
  await assert.rejects(
    () => source.readAllSourceEvents({
      endpoint: 'https://worker.invalid', token: 'synthetic-token',
      fetchImpl: fixtureFetch({
        '/listening/manifest.json': { json: manifest },
        [`/${basePath}`]: { bytes: base.bytes },
      }),
    }),
    /SHA-256 integrity check/
  );
});

test('fails closed when a manifest archive path is not the exact content-addressed listening path', () => {
  const sha = 'a'.repeat(64);
  assert.throws(
    () => source.validateArchiveDescriptor({
      source: 'spotify_import',
      path: `listening/spotify-history/${'b'.repeat(64)}.json.gz`,
      sha256: sha,
      contentEncoding: 'gzip',
      eventCount: 1,
    }, 'spotify_import'),
    /path does not match its checksum/
  );
  assert.throws(
    () => source.validateArchiveDescriptor({
      source: 'listenbrainz',
      path: `listening/..\/apiUsage.json`,
      sha256: sha,
      contentEncoding: 'gzip',
      eventCount: 1,
    }, 'listenbrainz'),
    /archive path is invalid/
  );
});

test('fails closed when a ListenBrainz incremental count differs from its descriptor', async () => {
  const base = gzipJson({ kind: 'livevault-listening-history', schemaVersion: 1, events: [] });
  const incremental = gzipJson({ kind: 'livevault-listening-incremental', schemaVersion: 1, source: 'listenbrainz', events: [] });
  const basePath = spotifyPath(base.sha256);
  const incrementalPath = listenbrainzPath(incremental.sha256);
  const manifest = {
    kind: 'livevault-listening-vault', schemaVersion: 1,
    archive: { source: 'spotify_import', path: basePath, sha256: base.sha256, contentEncoding: 'gzip', eventCount: 0 },
    incrementals: [{ source: 'listenbrainz', path: incrementalPath, sha256: incremental.sha256, contentEncoding: 'gzip', eventCount: 1 }],
  };
  await assert.rejects(
    () => source.readAllSourceEvents({
      endpoint: 'https://worker.invalid', token: 'synthetic-token',
      fetchImpl: fixtureFetch({
        '/listening/manifest.json': { json: manifest },
        [`/${basePath}`]: { bytes: base.bytes },
        [`/${incrementalPath}`]: { bytes: incremental.bytes },
      }),
    }),
    /count does not match/
  );
});
