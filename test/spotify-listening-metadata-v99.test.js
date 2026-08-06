'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const metadata = require('../spotifyListeningMetadataV99.js');

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
  const older = {
    kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: '2026-08-05T00:00:00.000Z', records: {
      TrackABC123: {
        spotifyTrackId: 'TrackABC123',
        spotifyTrackUrl: 'https://open.spotify.com/track/TrackABC123',
        spotifyAlbumId: 'AlbumOld123',
        spotifyAlbumUrl: 'https://open.spotify.com/album/AlbumOld123',
        artworkUrl: 'https://i.scdn.co/image/old',
        fetchedAt: '2026-08-05T00:00:00.000Z',
        source: 'spotify_exact_track_id',
        futureField: { keep: true },
      },
    },
  };
  const newer = {
    kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: '2026-08-06T00:00:00.000Z', records: {
      TrackABC123: {
        spotifyTrackId: 'TrackABC123',
        spotifyTrackUrl: 'https://open.spotify.com/track/TrackABC123',
        spotifyAlbumId: 'AlbumNew123',
        spotifyAlbumUrl: 'https://open.spotify.com/album/AlbumNew123',
        artworkUrl: 'https://i.scdn.co/image/new',
        fetchedAt: '2026-08-06T00:00:00.000Z',
        source: 'spotify_exact_track_id',
      },
    },
  };

  const merged = metadata.mergeDocuments(older, newer);
  assert.equal(merged.records.TrackABC123.spotifyAlbumId, 'AlbumNew123');
  assert.deepEqual(merged.records.TrackABC123.futureField, { keep: true });
  assert.equal(merged.updatedAt, '2026-08-06T00:00:00.000Z');
});

test('unresolvedTrackIds uses only exact Spotify IDs and deduplicates safely', () => {
  const document = {
    kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null,
    records: {
      Known123: {
        spotifyTrackId: 'Known123', spotifyTrackUrl: 'https://open.spotify.com/track/Known123',
        spotifyAlbumId: null, spotifyAlbumUrl: null, artworkUrl: null,
        fetchedAt: '2026-08-06T00:00:00.000Z', source: 'spotify_exact_track_id',
      },
    },
  };
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
