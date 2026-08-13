'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const metadata = require('../spotifyListeningMetadataV99.js');

function metadataRecord(id, fetchedAt = '2026-08-06T00:00:00.000Z') {
  return {
    spotifyTrackId: id,
    spotifyTrackUrl: `https://open.spotify.com/track/${id}`,
    spotifyAlbumId: null,
    spotifyAlbumUrl: null,
    artworkUrl: null,
    fetchedAt,
    source: 'spotify_exact_track_id',
  };
}

function metadataDocument(records = {}, updatedAt = null) {
  return {
    kind: 'livevault-spotify-listening-metadata',
    schemaVersion: 1,
    updatedAt,
    records,
  };
}

test('recordFromSpotifyTrack keeps exact Spotify track and album identity', () => {
  const record = metadata.recordFromSpotifyTrack({
    id: 'TrackABC123',
    external_urls: { spotify: 'https://open.spotify.com/track/TrackABC123' },
    album: {
      id: 'AlbumXYZ789',
      external_urls: { spotify: 'https://open.spotify.com/album/AlbumXYZ789' },
      images: [
        { url: 'https://i.scdn.co/image/small', width: 64, height: 64 },
        { url: 'https://i.scdn.co/image/large', width: 640, height: 640 },
      ],
    },
  }, '2026-08-06T12:00:00.000Z');

  assert.deepEqual(record, {
    spotifyTrackId: 'TrackABC123',
    spotifyTrackUrl: 'https://open.spotify.com/track/TrackABC123',
    spotifyAlbumId: 'AlbumXYZ789',
    spotifyAlbumUrl: 'https://open.spotify.com/album/AlbumXYZ789',
    artworkUrl: 'https://i.scdn.co/image/large',
    fetchedAt: '2026-08-06T12:00:00.000Z',
    source: 'spotify_exact_track_id',
  });
});

test('normalization rejects guessed, malformed and non-https metadata', () => {
  assert.equal(metadata.normalizeRecord({ spotifyTrackId: 'bad-id' }), null);
  assert.equal(metadata.normalizeRecord({
    spotifyTrackId: 'TrackABC123',
    spotifyTrackUrl: 'http://open.spotify.com/track/TrackABC123',
  }), null);
  assert.equal(metadata.normalizeRecord({
    spotifyTrackId: 'TrackABC123',
    spotifyTrackUrl: 'https://open.spotify.com/track/TrackABC123',
    spotifyAlbumId: 'AlbumXYZ789',
    spotifyAlbumUrl: 'not-a-url',
  }), null);
});

test('mergeDocuments preserves unknown fields and keeps the newest exact record', () => {
  const older = metadataDocument({
    TrackABC123: {
      ...metadataRecord('TrackABC123', '2026-08-05T00:00:00.000Z'),
      spotifyAlbumId: 'AlbumOld123',
      spotifyAlbumUrl: 'https://open.spotify.com/album/AlbumOld123',
      artworkUrl: 'https://i.scdn.co/image/old',
      futureField: { keep: true },
    },
  }, '2026-08-05T00:00:00.000Z');
  const newer = metadataDocument({
    TrackABC123: {
      ...metadataRecord('TrackABC123', '2026-08-06T00:00:00.000Z'),
      spotifyAlbumId: 'AlbumNew123',
      spotifyAlbumUrl: 'https://open.spotify.com/album/AlbumNew123',
      artworkUrl: 'https://i.scdn.co/image/new',
    },
  }, '2026-08-06T00:00:00.000Z');

  const merged = metadata.mergeDocuments(older, newer);
  assert.equal(merged.records.TrackABC123.spotifyAlbumId, 'AlbumNew123');
  assert.deepEqual(merged.records.TrackABC123.futureField, { keep: true });
  assert.equal(merged.updatedAt, '2026-08-06T00:00:00.000Z');
});

test('browser metadata writes preserve remote provider suppressions and unknown root fields', async () => {
  const suppression = {
    representativeTrackId: 'TrackABC123',
    reason: 'exact_track_not_found',
    checkedAt: '2026-08-13T08:00:00.000Z',
  };
  const remoteDocument = {
    ...metadataDocument({ Remote123: metadataRecord('Remote123') }, '2026-08-13T08:00:00.000Z'),
    albumArtworkSuppressions: { 'album-group': suppression },
    futureRootField: { keep: true },
  };
  const localDocument = metadataDocument({
    Local456: metadataRecord('Local456', '2026-08-13T09:00:00.000Z'),
  }, '2026-08-13T09:00:00.000Z');

  const merged = metadata.mergeDocuments(localDocument, remoteDocument);
  assert.deepEqual(merged.albumArtworkSuppressions, { 'album-group': suppression });
  assert.deepEqual(merged.futureRootField, { keep: true });

  let written;
  global.remote = { endpoint: 'https://worker.invalid', token: 'synthetic-token' };
  try {
    await metadata.writeRemote(merged, 'metadata-etag', false, async (_input, options) => {
      written = JSON.parse(options.body);
      return { ok: true, status: 200, headers: { get: () => 'next-etag' } };
    });
  } finally {
    delete global.remote;
  }

  assert.deepEqual(written.albumArtworkSuppressions, { 'album-group': suppression });
  assert.deepEqual(written.futureRootField, { keep: true });
});

test('remote suppression removal wins over a stale browser-local checkpoint', () => {
  const local = {
    ...metadataDocument({ Local456: metadataRecord('Local456') }),
    albumArtworkSuppressions: {
      'album-group': {
        representativeTrackId: 'TrackABC123',
        reason: 'exact_track_not_found',
        checkedAt: '2026-08-13T08:00:00.000Z',
      },
    },
  };
  const remoteWithoutSuppression = metadataDocument({ Remote123: metadataRecord('Remote123') });

  const merged = metadata.mergeDocuments(local, remoteWithoutSuppression);
  assert.equal(Object.hasOwn(merged, 'albumArtworkSuppressions'), false);
});

test('pending local-only metadata remains detectable after a conflict and needs no provider refetch', () => {
  const remote = metadataDocument({ Remote123: metadataRecord('Remote123') }, '2026-08-06T00:00:00.000Z');
  const localAfterConflict = metadataDocument({
    Remote123: metadataRecord('Remote123'),
    Local456: metadataRecord('Local456', '2026-08-06T01:00:00.000Z'),
  }, '2026-08-06T01:00:00.000Z');

  const mergedOnNextRun = metadata.mergeDocuments(localAfterConflict, remote);
  assert.equal(metadata.documentsEqual(mergedOnNextRun, remote), false, 'local-only record must trigger another conditional R2 write');
  assert.deepEqual(metadata.unresolvedTrackIds(mergedOnNextRun, [{ spotifyTrackId: 'Local456' }]), [], 'already-resolved local record must not be fetched from Spotify again');

  const remoteAfterRetry = metadata.normalizeDocument(mergedOnNextRun);
  assert.equal(metadata.documentsEqual(mergedOnNextRun, remoteAfterRetry), true, 'successful retry leaves no pending remote synchronization');
});

test('unresolvedTrackIds uses only exact Spotify IDs and deduplicates safely', () => {
  const document = metadataDocument({ Known123: metadataRecord('Known123') });
  const ids = metadata.unresolvedTrackIds(document, [
    { spotifyTrackId: 'Known123' },
    { spotifyTrackId: 'New456' },
    { spotifyTrackId: 'New456' },
    { spotifyTrackId: 'unsafe-id' },
    { recordingTitle: 'No identity' },
  ]);
  assert.deepEqual(ids, ['New456']);
});

test('Worker keeps metadata validation self-contained and exact-ID only', () => {
  const worker = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
  assert.doesNotMatch(worker, /^import\s/m);
  assert.match(worker, /SPOTIFY_METADATA_PATH = 'listening\/spotify-metadata\.json'/);
  assert.match(worker, /spotifyMetadataSpotifyUrlIsValid/);
  assert.match(worker, /url\.hostname==='open\.spotify\.com'/);
  assert.match(worker, /record\.source!=='spotify_exact_track_id'/);
  assert.match(worker, /MAX_SPOTIFY_METADATA_RECORDS/);
});
