'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../scripts/spotify-album-artwork-core');

const bands = [
  { id: 'band-a', name: 'Synthetic Artist' },
  { id: 'band-b', name: 'Other Artist' },
];

function event(trackId, releaseTitle = 'Synthetic Album', artistCreditName = 'Synthetic Artist') {
  return {
    stableListenId: `listen-${trackId}`,
    artistCreditName,
    recordingTitle: `Track ${trackId}`,
    releaseTitle,
    spotifyTrackId: trackId,
    source: 'spotify_import',
  };
}

function metadataRecord(trackId, albumId = 'Album123', artworkUrl = 'https://images.example.test/album.jpg') {
  return {
    spotifyTrackId: trackId,
    spotifyTrackUrl: `https://open.spotify.com/track/${trackId}`,
    spotifyAlbumId: albumId,
    spotifyAlbumUrl: `https://open.spotify.com/album/${albumId}`,
    artworkUrl,
    fetchedAt: '2026-08-11T12:00:00.000Z',
    source: 'spotify_exact_track_id',
  };
}

test('groups exact trusted Spotify tracks by unique local band and normalized release title', () => {
  const result = core.buildAlbumGroups({
    bands,
    events: [event('TrackA'), event('TrackB'), event('TrackC', 'Other Album')],
    metadata: { records: {} },
  });

  assert.equal(result.groups.length, 2);
  assert.deepEqual(result.groups.map((group) => group.trackIds.length).sort((a, b) => b - a), [2, 1]);
  assert.equal(result.ambiguous.length, 0);
});

test('duplicate local band names fail closed instead of text-mapping an album group', () => {
  const result = core.buildAlbumGroups({
    bands: [...bands, { id: 'band-c', name: 'Synthetic Artist' }],
    events: [event('TrackA')],
    metadata: { records: {} },
  });

  assert.equal(result.groups.length, 0);
  assert.equal(result.unsafeEvents, 1);
});

test('conflicting already-known Spotify album IDs quarantine the title group', () => {
  const result = core.buildAlbumGroups({
    bands,
    events: [event('TrackA'), event('TrackB')],
    metadata: {
      records: {
        TrackA: metadataRecord('TrackA', 'AlbumOne'),
        TrackB: metadataRecord('TrackB', 'AlbumTwo'),
      },
    },
  });

  assert.equal(result.groups.length, 0);
  assert.equal(result.ambiguous.length, 1);
  assert.equal(result.ambiguous[0].reason, 'conflicting_known_spotify_album_ids');
});

test('one known album artwork record makes the whole safe album group reusable without provider work', () => {
  const plan = core.planAlbumArtwork({
    bands,
    events: [event('TrackA'), event('TrackB'), event('TrackC')],
    metadata: { records: { TrackB: metadataRecord('TrackB') } },
  });

  assert.equal(plan.reusable.length, 1);
  assert.equal(plan.provider.length, 0);
  assert.equal(plan.summary.uniqueTracksInSafeGroups, 3);
});

test('materialization reuses album artwork for sibling tracks while preserving existing unknown fields', () => {
  const group = core.buildAlbumGroups({
    bands,
    events: [event('TrackA'), event('TrackB')],
    metadata: { records: {} },
  }).groups[0];
  const metadata = {
    kind: 'livevault-spotify-listening-metadata',
    schemaVersion: 1,
    futureTopLevel: { keep: true },
    records: {
      TrackB: {
        ...metadataRecord('TrackB', 'Album123', null),
        futureField: 'keep-me',
      },
    },
  };
  const output = core.materializeGroupRecords({
    metadata,
    group,
    albumRecord: metadataRecord('TrackA'),
  });

  assert.equal(output.futureTopLevel.keep, true);
  assert.equal(output.records.TrackA.spotifyAlbumId, 'Album123');
  assert.equal(output.records.TrackB.spotifyAlbumId, 'Album123');
  assert.equal(output.records.TrackB.artworkUrl, 'https://images.example.test/album.jpg');
  assert.equal(output.records.TrackB.futureField, 'keep-me');
});

test('materialization never overwrites a conflicting known album assignment', () => {
  const group = {
    key: 'album:test',
    representativeTrackId: 'TrackA',
    trackIds: ['TrackA', 'TrackB'],
  };
  const output = core.materializeGroupRecords({
    metadata: { records: { TrackB: metadataRecord('TrackB', 'DifferentAlbum') } },
    group,
    albumRecord: metadataRecord('TrackA', 'Album123'),
  });

  assert.equal(output.records.TrackB.spotifyAlbumId, 'DifferentAlbum');
  assert.equal(output.records.TrackA.spotifyAlbumId, 'Album123');
});
