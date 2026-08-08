'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventory = require('../scripts/listening-inventory');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';
const MB_RECORDING = '22222222-2222-4222-8222-222222222222';

function band() {
  return {
    id: 'band-1',
    name: 'Example Band',
    musicbrainz: {
      mbid: MB_ARTIST,
      status: 'manual_confirmed',
      spotify: { id: 'SpotifyArtist123', status: 'manual_confirmed' },
    },
  };
}

function event() {
  return {
    bandId: 'band-1',
    artistCreditName: 'Example Band',
    recordingTitle: 'Exact Song',
    spotifyTrackId: 'SpotifyTrack123',
  };
}

test('malformed supplied reusable documents stop inventory planning', () => {
  assert.throws(() => inventory.buildListeningInventory({
    bands: [band()], events: [event()], trackIdentities: { records: [] },
  }), /Invalid track identity document/);
  assert.throws(() => inventory.buildListeningInventory({
    bands: [band()], events: [event()], spotifyMetadata: { records: [] },
  }), /Invalid Spotify metadata document/);
});

test('malformed exact Spotify metadata blocks rather than becoming fresh provider work', () => {
  const result = inventory.buildListeningInventory({
    bands: [band()],
    events: [event()],
    spotifyMetadata: {
      records: {
        SpotifyTrack123: {
          spotifyTrackId: 'DifferentTrack',
          spotifyArtistIds: ['SpotifyArtist123'],
          isrc: 'USABC1234567',
        },
      },
    },
  });
  assert.equal(result.items[0].status, 'blocked');
  assert.equal(result.items[0].reason, 'spotify_metadata_identity_conflict');
  assert.equal(result.counts.needsSpotifyTracks, 0);
});

test('malformed exact Spotify metadata ISRC blocks inside inventory', () => {
  const result = inventory.buildListeningInventory({
    bands: [band()],
    events: [event()],
    spotifyMetadata: {
      records: {
        SpotifyTrack123: {
          spotifyTrackId: 'SpotifyTrack123',
          spotifyArtistIds: ['SpotifyArtist123'],
          isrc: 'bad-isrc',
        },
      },
    },
  });
  assert.equal(result.items[0].status, 'blocked');
  assert.equal(result.items[0].reason, 'spotify_metadata_identity_conflict');
});

test('malformed stored compatible recording fields block inventory reuse', () => {
  for (const recordingMbid of ['bad-mbid', 17]) {
    const result = inventory.buildListeningInventory({
      bands: [band()],
      events: [event()],
      trackIdentities: { records: {
        'spotify:SpotifyTrack123': {
          workKey: 'spotify:SpotifyTrack123',
          spotifyTrackId: 'SpotifyTrack123',
          musicbrainzRecordingId: MB_RECORDING,
          recordingMbid,
        },
      } },
    });
    assert.equal(result.items[0].status, 'blocked');
    assert.equal(result.items[0].reason, 'stored_track_identity_conflict');
    assert.equal(result.counts.completeTracks, 0);
  }
});

test('malformed stored providers container blocks inventory reuse', () => {
  const result = inventory.buildListeningInventory({
    bands: [band()],
    events: [event()],
    trackIdentities: { records: {
      'spotify:SpotifyTrack123': {
        workKey: 'spotify:SpotifyTrack123',
        spotifyTrackId: 'SpotifyTrack123',
        providers: [],
      },
    } },
  });
  assert.equal(result.items[0].status, 'blocked');
  assert.equal(result.items[0].reason, 'stored_track_identity_conflict');
});

test('malformed known provider entry blocks even otherwise resolved inventory reuse', () => {
  for (const spotify of ['bad-state', [], 17, null]) {
    const result = inventory.buildListeningInventory({
      bands: [band()],
      events: [event()],
      trackIdentities: { records: {
        'spotify:SpotifyTrack123': {
          workKey: 'spotify:SpotifyTrack123',
          spotifyTrackId: 'SpotifyTrack123',
          musicbrainzRecordingId: MB_RECORDING,
          providers: { spotify },
        },
      } },
    });
    assert.equal(result.items[0].status, 'blocked');
    assert.equal(result.items[0].reason, 'stored_track_identity_conflict');
    assert.equal(result.counts.completeTracks, 0);
  }
});

test('unknown future provider keys and statuses do not invalidate resolved identity reuse', () => {
  const result = inventory.buildListeningInventory({
    bands: [band()],
    events: [event()],
    trackIdentities: { records: {
      'spotify:SpotifyTrack123': {
        workKey: 'spotify:SpotifyTrack123',
        spotifyTrackId: 'SpotifyTrack123',
        musicbrainzRecordingId: MB_RECORDING,
        providers: {
          spotify: { status: 'future_status', futureField: true },
          futureProvider: { value: 1 },
        },
      },
    } },
  });
  assert.equal(result.items[0].status, 'complete');
  assert.equal(result.items[0].reason, 'existing_track_identity');
});
