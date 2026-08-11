'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function freshModule() {
  delete require.cache[require.resolve('../spotifyListeningAlbumArtworkV113.js')];
  return require('../spotifyListeningAlbumArtworkV113.js');
}

function resetGlobals() {
  delete globalThis.SpotifyListeningAlbumArtworkV113;
  delete globalThis.SpotifyListeningMetadataV99;
  delete globalThis.bands;
  delete globalThis.listeningEvents;
}

test.afterEach(resetGlobals);

test('browser planner returns one representative trusted track per safe album group', () => {
  globalThis.bands = [{ id: 'band-a', name: 'Synthetic Artist' }];
  globalThis.listeningEvents = [
    { localBandId: 'band-a', artistCreditName: 'Synthetic Artist', releaseTitle: 'Album One', spotifyTrackId: 'TrackA' },
    { localBandId: 'band-a', artistCreditName: 'Synthetic Artist', releaseTitle: 'Album One', spotifyTrackId: 'TrackB' },
    { localBandId: 'band-a', artistCreditName: 'Synthetic Artist', releaseTitle: 'Album Two', spotifyTrackId: 'TrackC' },
  ];
  const api = freshModule();
  assert.deepEqual(api.albumOrientedUnresolvedTrackIds({ records: {} }), ['TrackA', 'TrackC']);
});

test('known album artwork suppresses sibling requests without assigning inferred Spotify album identity', () => {
  globalThis.bands = [{ id: 'band-a', name: 'Synthetic Artist' }];
  globalThis.listeningEvents = [
    { localBandId: 'band-a', artistCreditName: 'Synthetic Artist', releaseTitle: 'Album One', spotifyTrackId: 'TrackA' },
    { localBandId: 'band-a', artistCreditName: 'Synthetic Artist', releaseTitle: 'Album One', spotifyTrackId: 'TrackB' },
  ];
  const api = freshModule();
  const document = {
    records: {
      TrackA: {
        spotifyTrackId: 'TrackA',
        spotifyTrackUrl: 'https://open.spotify.com/track/TrackA',
        spotifyAlbumId: 'Album123',
        spotifyAlbumUrl: 'https://open.spotify.com/album/Album123',
        artworkUrl: 'https://images.example.test/cover.jpg',
        fetchedAt: '2026-08-11T12:00:00.000Z',
        source: 'spotify_exact_track_id',
      },
    },
  };

  assert.deepEqual(api.albumOrientedUnresolvedTrackIds(document), []);
  assert.equal(api.applyAlbumReuse(document), 2);
  assert.equal(globalThis.listeningEvents[0].spotifyAlbumId, undefined);
  assert.equal(globalThis.listeningEvents[1].spotifyAlbumId, undefined);
  assert.equal(globalThis.listeningEvents[1].spotifyAlbumUrl, undefined);
  assert.equal(globalThis.listeningEvents[1].albumArtworkUrl, 'https://images.example.test/cover.jpg');
  assert.equal(globalThis.listeningEvents[1].spotifyAlbumArtworkSource, 'spotify_album_group_reuse');
  assert.equal(globalThis.listeningEvents[1].spotifyAlbumArtworkSeedTrackId, 'TrackA');
});

test('conflicting known album IDs fail closed and do not queue a guessed representative', () => {
  globalThis.bands = [{ id: 'band-a', name: 'Synthetic Artist' }];
  globalThis.listeningEvents = [
    { localBandId: 'band-a', artistCreditName: 'Synthetic Artist', releaseTitle: 'Album One', spotifyTrackId: 'TrackA' },
    { localBandId: 'band-a', artistCreditName: 'Synthetic Artist', releaseTitle: 'Album One', spotifyTrackId: 'TrackB' },
  ];
  const api = freshModule();
  const document = {
    records: {
      TrackA: { spotifyTrackId: 'TrackA', spotifyAlbumId: 'AlbumOne', artworkUrl: 'https://images.example.test/one.jpg' },
      TrackB: { spotifyTrackId: 'TrackB', spotifyAlbumId: 'AlbumTwo', artworkUrl: 'https://images.example.test/two.jpg' },
    },
  };

  assert.deepEqual(api.albumOrientedUnresolvedTrackIds(document), []);
  assert.equal(api.applyAlbumReuse(document), 0);
});

test('the same exact Spotify track crossing album groups fails closed in the browser', () => {
  globalThis.bands = [{ id: 'band-a', name: 'Synthetic Artist' }];
  globalThis.listeningEvents = [
    { localBandId: 'band-a', artistCreditName: 'Synthetic Artist', releaseTitle: 'Album One', spotifyTrackId: 'TrackA' },
    { localBandId: 'band-a', artistCreditName: 'Synthetic Artist', releaseTitle: 'Album Two', spotifyTrackId: 'TrackA' },
  ];
  const api = freshModule();
  const groups = api.buildGroups({ records: {} });

  assert.equal(groups.length, 2);
  assert.ok(groups.every((group) => group.ambiguous));
  assert.ok(groups.every((group) => group.ambiguityReason === 'spotify_track_crosses_album_groups'));
  assert.deepEqual(api.albumOrientedUnresolvedTrackIds({ records: {} }), []);
  assert.equal(api.applyAlbumReuse({ records: {} }), 0);
});

test('stale explicit local band ID stays placeholder-only and never becomes a provider request', () => {
  globalThis.bands = [{ id: 'band-a', name: 'Synthetic Artist' }];
  globalThis.listeningEvents = [
    { localBandId: 'deleted-band', artistCreditName: 'Synthetic Artist', releaseTitle: 'Album One', spotifyTrackId: 'TrackA' },
  ];
  const api = freshModule();
  assert.deepEqual(api.albumOrientedUnresolvedTrackIds({ records: {} }), []);
});

test('missing release title stays placeholder-only and never becomes a provider request', () => {
  globalThis.bands = [{ id: 'band-a', name: 'Synthetic Artist' }];
  globalThis.listeningEvents = [
    { localBandId: 'band-a', artistCreditName: 'Synthetic Artist', releaseTitle: null, spotifyTrackId: 'TrackA' },
  ];
  const api = freshModule();
  assert.deepEqual(api.albumOrientedUnresolvedTrackIds({ records: {} }), []);
});

test('patch replaces only queue/apply behavior while preserving the existing metadata document contract', () => {
  globalThis.bands = [{ id: 'band-a', name: 'Synthetic Artist' }];
  globalThis.listeningEvents = [];
  let originalApplyCalls = 0;
  const metadata = {
    unresolvedTrackIds: () => ['legacy'],
    applyToEvents: () => { originalApplyCalls += 1; return 4; },
    existingFutureMethod: () => 'kept',
  };
  globalThis.SpotifyListeningMetadataV99 = metadata;
  const api = freshModule();

  assert.equal(api.patchMetadata(metadata), true);
  assert.equal(metadata.existingFutureMethod(), 'kept');
  assert.equal(metadata.applyToEvents({ records: {} }), 4);
  assert.equal(originalApplyCalls, 1);
  assert.equal(api.patchMetadata(metadata), false);
});
