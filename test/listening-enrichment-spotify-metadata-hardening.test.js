'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryLib = require('../scripts/listening-inventory');
const engine = require('../scripts/listening-enrichment-engine');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';
const MB_RECORDING = '22222222-2222-4222-8222-222222222222';
const OTHER_RECORDING = '33333333-3333-4333-8333-333333333333';

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

function item() {
  return inventoryLib.buildListeningInventory({
    bands: [band()],
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

test('metadata without any effective Spotify artist identity is rejected', () => {
  assert.equal(engine.spotifyMetadataRecord(null, item(), metadataOutcome({ spotifyArtistIds: [] })), null);
  assert.throws(() => engine.mergeIdentityRecord(null, item(), 'spotify', metadataOutcome({ spotifyArtistIds: [] })), /missing artist identity/);
});

test('malformed album IDs and non-HTTPS artwork are rejected before persistence', () => {
  assert.equal(engine.spotifyMetadataRecord(null, item(), metadataOutcome({ spotifyAlbumId: 'bad album!' })), null);
  assert.equal(engine.spotifyMetadataRecord(null, item(), metadataOutcome({ artworkUrl: 'http://example.test/art.jpg' })), null);
  assert.equal(engine.spotifyMetadataRecord({
    spotifyTrackId: 'SpotifyTrack123',
    spotifyArtistIds: ['SpotifyArtist123'],
    spotifyAlbumId: 'bad album!',
  }, item(), metadataOutcome()), null);
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

test('a later non-relinked response clears stale known relink audit fields', () => {
  const merged = engine.spotifyMetadataRecord({
    spotifyTrackId: 'SpotifyTrack123',
    spotifyArtistIds: ['SpotifyArtist123'],
    spotifyProviderResolvedTrackId: 'OldRelinkedTrack456',
    spotifyProviderRelinked: true,
    futureField: { keep: true },
  }, item(), metadataOutcome());
  assert.equal(Object.prototype.hasOwnProperty.call(merged, 'spotifyProviderResolvedTrackId'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(merged, 'spotifyProviderRelinked'), false);
  assert.deepEqual(merged.futureField, { keep: true });
});

test('inventory independently blocks stale or conflicting stored identity evidence', () => {
  const baseEvent = {
    bandId: 'band-1',
    artistCreditName: 'Example Band',
    recordingTitle: 'Exact Song',
    spotifyTrackId: 'SpotifyTrack123',
  };
  const key = 'spotify:SpotifyTrack123';

  const staleBand = inventoryLib.buildListeningInventory({
    bands: [band()],
    events: [baseEvent],
    trackIdentities: { records: { [key]: {
      workKey: key,
      localBandId: 'other-band',
      spotifyTrackId: 'SpotifyTrack123',
      musicbrainzRecordingId: MB_RECORDING,
    } } },
  });
  assert.equal(staleBand.items[0].status, 'blocked');
  assert.equal(staleBand.items[0].reason, 'stored_track_identity_conflict');

  const conflictingRecordings = inventoryLib.buildListeningInventory({
    bands: [band()],
    events: [baseEvent],
    trackIdentities: { records: { [key]: {
      workKey: key,
      spotifyTrackId: 'SpotifyTrack123',
      musicbrainzRecordingId: MB_RECORDING,
      recordingMbid: OTHER_RECORDING,
    } } },
  });
  assert.equal(conflictingRecordings.items[0].status, 'blocked');
  assert.equal(conflictingRecordings.items[0].reason, 'stored_track_identity_conflict');
});
