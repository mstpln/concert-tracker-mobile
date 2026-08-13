'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../scripts/spotify-album-artwork-core');

const bands = [{ id: 'band-a', name: 'Synthetic Artist' }];
const events = [{
  stableListenId: 'listen-a',
  localBandId: 'band-a',
  artistCreditName: 'Synthetic Artist',
  recordingTitle: 'Synthetic Track',
  releaseTitle: 'Synthetic Album',
  spotifyTrackId: 'TrackA',
  source: 'spotify_import',
}];

function metadata() {
  return {
    kind: 'livevault-spotify-listening-metadata',
    schemaVersion: 1,
    records: {},
    futureField: { preserved: true },
  };
}

test('terminal suppression preserves unknown metadata and removes the matching group from later provider plans', () => {
  const initial = core.planAlbumArtwork({ events, bands, metadata: metadata() });
  assert.equal(initial.provider.length, 1);
  const group = initial.provider[0];
  const next = core.mergeTerminalSuppression(metadata(), group, 'exact_track_not_found', '2026-08-13T12:00:00.000Z');
  assert.equal(next.futureField.preserved, true);
  assert.equal(next.albumArtworkSuppressions[group.key].representativeTrackId, 'TrackA');
  assert.equal(next.albumArtworkSuppressions[group.key].reason, 'exact_track_not_found');
  const replanned = core.planAlbumArtwork({ events, bands, metadata: next });
  assert.equal(replanned.provider.length, 0);
  assert.equal(replanned.suppressed.length, 1);
});

test('a suppression with a different representative track is ignored', () => {
  const initial = core.planAlbumArtwork({ events, bands, metadata: metadata() });
  const group = initial.provider[0];
  const value = metadata();
  value.albumArtworkSuppressions = {
    [group.key]: {
      albumGroupKey: group.key,
      representativeTrackId: 'DifferentTrack',
      reason: 'exact_track_not_found',
      futureField: true,
    },
  };
  const replanned = core.planAlbumArtwork({ events, bands, metadata: value });
  assert.equal(replanned.provider.length, 1);
  assert.equal(replanned.suppressed.length, 0);
});

test('a successful changed representative clears the obsolete group suppression', () => {
  const expandedEvents = [
    { ...events[0], stableListenId: 'listen-b', spotifyTrackId: 'ATrack' },
    events[0],
  ];
  const initial = core.planAlbumArtwork({ events, bands, metadata: metadata() });
  const suppressed = core.mergeTerminalSuppression(metadata(), initial.provider[0], 'exact_track_not_found', '2026-08-13T12:00:00.000Z');
  const changed = core.planAlbumArtwork({ events: expandedEvents, bands, metadata: suppressed });
  assert.equal(changed.provider[0].representativeTrackId, 'ATrack');
  const resolved = core.mergeRepresentativeRecord(suppressed, changed.provider[0], {
    spotifyTrackId: 'ATrack',
    spotifyAlbumId: 'AlbumA',
    spotifyAlbumUrl: 'https://open.spotify.com/album/AlbumA',
    artworkUrl: 'https://images.example.test/album-a.jpg',
  });
  assert.equal(resolved.albumArtworkSuppressions[changed.provider[0].key], undefined);
});
