'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryLib = require('../scripts/listening-inventory');
const engine = require('../scripts/listening-enrichment-engine');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';

function item() {
  return inventoryLib.buildListeningInventory({
    bands: [{
      id: 'band-1',
      name: 'Example Band',
      musicbrainz: {
        mbid: MB_ARTIST,
        status: 'manual_confirmed',
        spotify: { id: 'SpotifyArtist123', status: 'manual_confirmed' },
      },
    }],
    events: [{
      bandId: 'band-1',
      artistCreditName: 'Example Band',
      recordingTitle: 'Exact Song',
      spotifyTrackId: 'SpotifyTrack123',
    }],
  }).items[0];
}

function metadataOutcome(overrides = {}) {
  return {
    status: 'metadata',
    requestedTrackId: 'SpotifyTrack123',
    resolvedTrackId: 'SpotifyTrack123',
    relinked: false,
    spotifyArtistIds: ['SpotifyArtist123'],
    spotifyAlbumId: null,
    artworkUrl: null,
    isrc: null,
    ...overrides,
  };
}

test('missing incoming Spotify artist IDs preserve existing valid artist IDs', () => {
  const existing = {
    spotifyTrackId: 'SpotifyTrack123',
    spotifyArtistIds: ['SpotifyArtist123'],
  };
  const merged = engine.spotifyMetadataRecord(existing, item(), metadataOutcome({ spotifyArtistIds: [] }));
  assert.deepEqual(merged.spotifyArtistIds, ['SpotifyArtist123']);
});

test('malformed album IDs and non-HTTPS artwork are rejected before persistence', () => {
  assert.equal(engine.spotifyMetadataRecord(null, item(), metadataOutcome({ spotifyAlbumId: 'bad album!' })), null);
  assert.equal(engine.spotifyMetadataRecord(null, item(), metadataOutcome({ artworkUrl: 'http://example.test/art.jpg' })), null);
});

test('relink audit fields must agree with the provider-resolved track ID', () => {
  assert.equal(engine.spotifyMetadataRecord(null, item(), metadataOutcome({
    resolvedTrackId: 'RelinkedTrack456',
    relinked: false,
  })), null);
  assert.equal(engine.spotifyMetadataRecord(null, item(), metadataOutcome({
    resolvedTrackId: 'SpotifyTrack123',
    relinked: true,
  })), null);
});

test('valid relinked metadata keeps requested storage identity and separate audit identity', () => {
  const merged = engine.spotifyMetadataRecord(null, item(), metadataOutcome({
    resolvedTrackId: 'RelinkedTrack456',
    relinked: true,
  }));
  assert.equal(merged.spotifyTrackId, 'SpotifyTrack123');
  assert.equal(merged.spotifyProviderResolvedTrackId, 'RelinkedTrack456');
  assert.equal(merged.spotifyProviderRelinked, true);
});
