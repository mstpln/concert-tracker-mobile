'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../scripts/spotify-album-artwork-core');

const bands = [
  { id: 'band-a', name: 'Synthetic Artist' },
  { id: 'band-b', name: 'Other Artist' },
];

function event(trackId, releaseTitle = 'Synthetic Album', artistCreditName = 'Synthetic Artist', listenedAt = null, stableListenId = null) {
  return {
    stableListenId: stableListenId || `listen-${trackId}`,
    artistCreditName,
    recordingTitle: `Track ${trackId}`,
    releaseTitle,
    spotifyTrackId: trackId,
    source: 'spotify_import',
    ...(listenedAt ? { listenedAt } : {}),
  };
}

function metadataRecord(trackId, albumId = 'Album123', artworkUrl = 'https://images.example.test/album.jpg') {
  return {
    spotifyTrackId: trackId,
    spotifyTrackUrl: `https://open.spotify.com/track/${trackId}`,
    spotifyAlbumId: albumId,
    spotifyAlbumUrl: albumId ? `https://open.spotify.com/album/${albumId}` : null,
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

test('recent unresolved albums rank ahead of older high-volume albums', () => {
  const events = [
    event('OldA', 'Old Favourite', 'Synthetic Artist', '2026-01-01T10:00:00.000Z', 'old-1'),
    event('OldA', 'Old Favourite', 'Synthetic Artist', '2026-01-02T10:00:00.000Z', 'old-2'),
    event('OldB', 'Old Favourite', 'Synthetic Artist', '2026-01-03T10:00:00.000Z', 'old-3'),
    event('OldC', 'Old Favourite', 'Synthetic Artist', '2026-01-04T10:00:00.000Z', 'old-4'),
    event('RecentA', 'Recent Album', 'Synthetic Artist', '2026-08-11T10:00:00.000Z', 'recent-1'),
  ];

  const plan = core.planAlbumArtwork({ bands, events, metadata: { records: {} } });

  assert.equal(plan.provider[0].normalizedReleaseTitle, 'recent album');
  assert.equal(plan.provider[0].listenCount, 1);
  assert.equal(plan.provider[0].latestListenedAt, '2026-08-11T10:00:00.000Z');
  assert.equal(plan.provider[1].normalizedReleaseTitle, 'old favourite');
  assert.equal(plan.provider[1].listenCount, 4);
});

test('total listens break equal-recency ties before distinct track count', () => {
  const events = [
    event('PopularA', 'Popular Album', 'Synthetic Artist', '2026-08-11T10:00:00.000Z', 'popular-1'),
    event('PopularA', 'Popular Album', 'Synthetic Artist', '2026-08-11T10:00:00.000Z', 'popular-2'),
    event('PopularA', 'Popular Album', 'Synthetic Artist', '2026-08-11T10:00:00.000Z', 'popular-3'),
    event('BroadA', 'Broad Album', 'Synthetic Artist', '2026-08-11T10:00:00.000Z', 'broad-1'),
    event('BroadB', 'Broad Album', 'Synthetic Artist', '2026-08-11T10:00:00.000Z', 'broad-2'),
  ];

  const plan = core.planAlbumArtwork({ bands, events, metadata: { records: {} } });

  assert.equal(plan.provider[0].normalizedReleaseTitle, 'popular album');
  assert.equal(plan.provider[0].listenCount, 3);
  assert.equal(plan.provider[0].trackIds.length, 1);
  assert.equal(plan.provider[1].normalizedReleaseTitle, 'broad album');
  assert.equal(plan.provider[1].listenCount, 2);
  assert.equal(plan.provider[1].trackIds.length, 2);
});

test('distinct track count breaks equal-recency and equal-listen ties', () => {
  const events = [
    event('BroadA', 'Broad Album', 'Synthetic Artist', '2026-08-11T10:00:00.000Z', 'broad-1'),
    event('BroadB', 'Broad Album', 'Synthetic Artist', '2026-08-11T10:00:00.000Z', 'broad-2'),
    event('RepeatA', 'Repeat Album', 'Synthetic Artist', '2026-08-11T10:00:00.000Z', 'repeat-1'),
    event('RepeatA', 'Repeat Album', 'Synthetic Artist', '2026-08-11T10:00:00.000Z', 'repeat-2'),
  ];

  const plan = core.planAlbumArtwork({ bands, events, metadata: { records: {} } });

  assert.equal(plan.provider[0].normalizedReleaseTitle, 'broad album');
  assert.equal(plan.provider[0].listenCount, 2);
  assert.equal(plan.provider[0].trackIds.length, 2);
  assert.equal(plan.provider[1].normalizedReleaseTitle, 'repeat album');
  assert.equal(plan.provider[1].trackIds.length, 1);
});

test('missing or malformed listen timestamps rank behind valid recent listening without becoming unsafe', () => {
  const events = [
    event('UnknownA', 'Unknown Date Album', 'Synthetic Artist', null, 'unknown-1'),
    { ...event('BadA', 'Bad Date Album', 'Synthetic Artist', null, 'bad-1'), listenedAt: 'not-a-date' },
    event('RecentA', 'Recent Album', 'Synthetic Artist', '2026-08-11T10:00:00.000Z', 'recent-1'),
  ];

  const result = core.buildAlbumGroups({ bands, events, metadata: { records: {} } });

  assert.equal(result.groups[0].normalizedReleaseTitle, 'recent album');
  assert.equal(result.unsafeEvents, 0);
  assert.equal(result.groups.filter((group) => group.latestListenTime === 0).length, 2);
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

test('known album identity selects its exact track as the provider representative when artwork is missing', () => {
  const plan = core.planAlbumArtwork({
    bands,
    events: [event('TrackA'), event('TrackB')],
    metadata: { records: { TrackB: metadataRecord('TrackB', 'Album123', null) } },
  });

  assert.equal(plan.reusable.length, 0);
  assert.equal(plan.provider.length, 1);
  assert.equal(plan.provider[0].knownAlbumId, 'Album123');
  assert.equal(plan.provider[0].representativeTrackId, 'TrackB');
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
