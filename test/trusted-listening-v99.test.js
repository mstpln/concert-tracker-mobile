'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadModule(metadataRecords = {}) {
  global.ListeningStats = {
    isValidListen: (listen) => Number.isFinite(Number(listen?.listenedAtMs)),
    validDurationMs: (listen) => Math.max(0, Number(listen?.listenedDurationMs) || 0),
    listenTimeMs: (listen) => Number(listen?.listenedAtMs),
  };
  global.SpotifyListeningMetadataV99 = {
    recordForTrack: (id) => metadataRecords[id] || null,
  };
  delete require.cache[require.resolve('../trustedListeningV99.js')];
  return require('../trustedListeningV99.js');
}

test('Spotify links are constructed only from valid exact IDs', () => {
  const api = loadModule();
  assert.equal(api.spotifyUrl('track', 'TrackABC123'), 'https://open.spotify.com/track/TrackABC123');
  assert.equal(api.spotifyUrl('album', 'AlbumXYZ789', 'https://open.spotify.com/album/AlbumXYZ789'), 'https://open.spotify.com/album/AlbumXYZ789');
  assert.equal(api.spotifyUrl('track', 'unsafe-id'), null);
  assert.equal(api.spotifyUrl('track', '', 'https://example.com/not-spotify'), null);
});

test('cached exact-track metadata supplies album identity and artwork', () => {
  const api = loadModule({
    TrackABC123: {
      spotifyTrackId: 'TrackABC123',
      spotifyTrackUrl: 'https://open.spotify.com/track/TrackABC123',
      spotifyAlbumId: 'AlbumXYZ789',
      spotifyAlbumUrl: 'https://open.spotify.com/album/AlbumXYZ789',
      artworkUrl: 'https://i.scdn.co/image/cover',
    },
  });
  const listen = { spotifyTrackId: 'TrackABC123' };
  assert.deepEqual(api.trustedTrackMeta(listen), {
    spotifyTrackId: 'TrackABC123',
    spotifyTrackUrl: 'https://open.spotify.com/track/TrackABC123',
    artworkPath: 'https://i.scdn.co/image/cover',
  });
  assert.deepEqual(api.trustedAlbumMeta(listen), {
    spotifyAlbumId: 'AlbumXYZ789',
    spotifyAlbumUrl: 'https://open.spotify.com/album/AlbumXYZ789',
    artworkPath: 'https://i.scdn.co/image/cover',
  });
});

test('global Top Tracks keeps unresolved events separate', () => {
  const api = loadModule();
  const rows = api.aggregate([
    { id: 'one', listenedAtMs: 1, listenedDurationMs: 1000, recordingTitle: 'Same title', artistCreditName: 'Artist' },
    { id: 'two', listenedAtMs: 2, listenedDurationMs: 1000, recordingTitle: 'Same title', artistCreditName: 'Artist' },
  ], 'track', 10);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].listenCount, 1);
  assert.equal(rows[1].listenCount, 1);
  assert.equal(rows.every((row) => row.trustedSpotifyIdentity === false), true);
});

test('conflicting Spotify IDs never create a clickable grouped row', () => {
  const api = loadModule();
  const rows = api.aggregate([
    {
      id: 'one', listenedAtMs: 1, listenedDurationMs: 1000, recordingTitle: 'Track', artistCreditName: 'Artist',
      musicbrainzRecordingId: 'recording-mbid', spotifyTrackId: 'TrackABC123',
    },
    {
      id: 'two', listenedAtMs: 2, listenedDurationMs: 1000, recordingTitle: 'Track', artistCreditName: 'Artist',
      musicbrainzRecordingId: 'recording-mbid', spotifyTrackId: 'TrackDEF456',
    },
  ], 'track', 10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].listenCount, 2);
  assert.equal(rows[0].spotifyConflict, true);
  assert.equal(rows[0].spotifyTrackUrl, null);
  assert.equal(rows[0].artworkPath, null);
});
