'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

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

test('Worker validator accepts exact metadata and rejects mismatched URLs', async () => {
  const validator = await import('../spotifyMetadataValidatorV99.mjs');
  const valid = {
    kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: '2026-08-06T00:00:00.000Z',
    records: {
      TrackABC123: {
        spotifyTrackId: 'TrackABC123',
        spotifyTrackUrl: 'https://open.spotify.com/track/TrackABC123',
        spotifyAlbumId: 'AlbumXYZ789',
        spotifyAlbumUrl: 'https://open.spotify.com/album/AlbumXYZ789',
        artworkUrl: 'https://i.scdn.co/image/cover',
        fetchedAt: '2026-08-06T00:00:00.000Z',
        source: 'spotify_exact_track_id',
      },
    },
  };
  assert.equal(validator.spotifyListeningMetadataIsValid(valid), true);
  assert.equal(validator.spotifyListeningMetadataIsValid({
    ...valid,
    records: { TrackABC123: { ...valid.records.TrackABC123, spotifyTrackUrl: 'https://open.spotify.com/track/Other999' } },
  }), false);
  assert.equal(validator.spotifyListeningMetadataIsValid({
    ...valid,
    records: { TrackABC123: { ...valid.records.TrackABC123, artworkUrl: 'http://example.com/cover.jpg' } },
  }), false);
});
