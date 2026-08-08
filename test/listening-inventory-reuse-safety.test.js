'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventory = require('../scripts/listening-inventory');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';

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
