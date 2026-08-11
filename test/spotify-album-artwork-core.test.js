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

test('stale explicit local band IDs fail closed instead of creating an orphan album group', () => {
  const source = { ...event('TrackA'), localBandId: 'deleted-band' };
  const result = core.buildAlbumGroups({ bands, events: [source], metadata: { records: {} } });

  assert.equal(result.groups.length, 0);
  assert.equal(result.ambiguous.length, 0);
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

test('the same exact Spotify track crossing two album groups quarantines both groups', () => {
  const result = core.buildAlbumGroups({
    bands,
    events: [event('TrackA', 'Album One'), event('TrackA', 'Album Two')],
    metadata: { records: {} },
  });

  assert.equal(result.groups.length, 0);
  assert.equal(result.ambiguous.length, 2);
  assert.ok(result.ambiguous.every((group) => group.reason === 'spotify_track_crosses_album_groups'));
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

test('representative persistence preserves unknown fields and writes only the exact looked-up track', () => {
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
      TrackA: {
        ...metadataRecord('TrackA', null, null),
        spotifyAlbumId: null,
        spotifyAlbumUrl: null,
        futureField: 'keep-me',
      },
    },
  };
  const output = core.mergeRepresentativeRecord(metadata, group, metadataRecord('TrackA'));

  assert.equal(output.futureTopLevel.keep, true);
  assert.equal(output.records.TrackA.spotifyAlbumId, 'Album123');
  assert.equal(output.records.TrackA.artworkUrl, 'https://images.example.test/album.jpg');
  assert.equal(output.records.TrackA.futureField, 'keep-me');
  assert.equal(output.records.TrackA.albumGroupKey, group.key);
  assert.equal(output.records.TrackA.source, 'spotify_exact_track_id');
  assert.equal(output.records.TrackB, undefined);
});

test('representative persistence rejects a provider album that conflicts with already-known group identity', () => {
  const group = {
    key: 'album:test',
    representativeTrackId: 'TrackA',
    knownAlbumId: 'KnownAlbum',
    trackIds: ['TrackA', 'TrackB'],
  };
  const output = core.mergeRepresentativeRecord(
    { records: {} },
    group,
    metadataRecord('TrackA', 'DifferentAlbum'),
  );

  assert.equal(output, null);
});
