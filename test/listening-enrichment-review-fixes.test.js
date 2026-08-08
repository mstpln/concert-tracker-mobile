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

function build({ trustedMusicbrainz = true, spotifyMetadata = null } = {}) {
  const currentBand = band();
  if (!trustedMusicbrainz) currentBand.musicbrainz = { spotify: currentBand.musicbrainz.spotify };
  return inventoryLib.buildListeningInventory({
    bands: [currentBand],
    events: [{
      bandId: 'band-1',
      artistCreditName: 'Example Band',
      recordingTitle: 'Exact Song',
      spotifyTrackId: 'SpotifyTrack123',
    }],
    spotifyMetadata,
  });
}

test('stored ISRC is reused before another Spotify request', () => {
  const inventory = build();
  const key = inventory.items[0].trackKey;
  const plan = engine.planEnrichment({
    inventory,
    trackIdentities: { records: { [key]: {
      workKey: key,
      localBandId: 'band-1',
      spotifyTrackId: 'SpotifyTrack123',
      isrc: 'USABC1234567',
    } } },
  });
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].provider, 'musicbrainz');
  assert.equal(plan.steps[0].operation, 'isrc_lookup');
  assert.equal(plan.steps[0].input.isrc, 'USABC1234567');
});

test('ISRC never schedules MusicBrainz without a trusted artist anchor', () => {
  const inventory = build({ trustedMusicbrainz: false });
  const key = inventory.items[0].trackKey;
  const plan = engine.planEnrichment({
    inventory,
    trackIdentities: { records: { [key]: {
      workKey: key,
      localBandId: 'band-1',
      spotifyTrackId: 'SpotifyTrack123',
      isrc: 'USABC1234567',
    } } },
  });
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].provider, 'spotify');
  assert.equal(plan.steps[0].operation, 'exact_track');
});

test('conflicting stored and Spotify-metadata ISRC evidence blocks provider work', () => {
  const inventory = build({ spotifyMetadata: { records: { SpotifyTrack123: { spotifyTrackId: 'SpotifyTrack123', isrc: 'USABC1234567' } } } });
  const key = inventory.items[0].trackKey;
  const plan = engine.planEnrichment({
    inventory,
    trackIdentities: { records: { [key]: {
      workKey: key,
      localBandId: 'band-1',
      spotifyTrackId: 'SpotifyTrack123',
      isrc: 'GBXYZ7654321',
    } } },
  });
  assert.equal(plan.steps.length, 0);
  assert.equal(plan.counts.blocked, 1);
});

test('stored provider artist evidence that contradicts trusted band identity is blocked', () => {
  const inventory = build();
  const key = inventory.items[0].trackKey;
  const spotifyConflict = engine.planEnrichment({
    inventory,
    trackIdentities: { records: { [key]: {
      workKey: key,
      spotifyTrackId: 'SpotifyTrack123',
      spotifyArtistIds: ['DifferentSpotifyArtist'],
    } } },
  });
  assert.equal(spotifyConflict.steps.length, 0);
  assert.equal(spotifyConflict.counts.blocked, 1);

  const musicbrainzConflict = engine.planEnrichment({
    inventory,
    trackIdentities: { records: { [key]: {
      workKey: key,
      spotifyTrackId: 'SpotifyTrack123',
      musicbrainzRecordingId: MB_RECORDING,
      musicbrainzArtistIds: ['44444444-4444-4444-8444-444444444444'],
    } } },
  });
  assert.equal(musicbrainzConflict.steps.length, 0);
  assert.equal(musicbrainzConflict.counts.blocked, 1);
});

test('reused Spotify metadata with explicit different artists is blocked by inventory', () => {
  const inventory = build({ spotifyMetadata: { records: {
    SpotifyTrack123: {
      spotifyTrackId: 'SpotifyTrack123',
      spotifyArtistIds: ['DifferentSpotifyArtist'],
      isrc: 'USABC1234567',
    },
  } } });
  assert.equal(inventory.items[0].status, 'blocked');
  assert.equal(inventory.items[0].reason, 'spotify_metadata_artist_conflict');
});

test('conflicting compatible recording-id fields block rather than choosing one', () => {
  const inventory = build();
  const key = inventory.items[0].trackKey;
  const plan = engine.planEnrichment({
    inventory,
    trackIdentities: { records: { [key]: {
      workKey: key,
      spotifyTrackId: 'SpotifyTrack123',
      musicbrainzRecordingId: MB_RECORDING,
      recordingMbid: OTHER_RECORDING,
    } } },
  });
  assert.equal(plan.steps.length, 0);
  assert.equal(plan.counts.blocked, 1);
});

test('persistence rejects ISRC replacement and contradicting provider artist identities', () => {
  const item = build().items[0];
  assert.throws(() => engine.mergeIdentityRecord({
    workKey: item.trackKey,
    spotifyTrackId: 'SpotifyTrack123',
    isrc: 'USABC1234567',
  }, item, 'spotify', {
    status: 'metadata',
    reason: 'spotify_metadata_with_isrc',
    isrc: 'GBXYZ7654321',
    spotifyArtistIds: ['SpotifyArtist123'],
  }), /ISRC conflicts/);

  assert.throws(() => engine.mergeIdentityRecord({
    workKey: item.trackKey,
    spotifyTrackId: 'SpotifyTrack123',
  }, item, 'spotify', {
    status: 'metadata',
    reason: 'spotify_metadata_without_isrc',
    spotifyArtistIds: ['DifferentSpotifyArtist'],
  }), /Spotify artist identity conflicts/);

  assert.throws(() => engine.mergeIdentityRecord({
    workKey: item.trackKey,
    spotifyTrackId: 'SpotifyTrack123',
  }, item, 'musicbrainz', {
    status: 'resolved',
    reason: 'isrc_exact_trusted_artist',
    recordingMbid: MB_RECORDING,
    artistMbids: ['44444444-4444-4444-8444-444444444444'],
  }), /MusicBrainz artist identity conflicts/);
});

test('Spotify metadata persistence refuses a changed ISRC for the same stored track', () => {
  const item = build().items[0];
  const merged = engine.spotifyMetadataRecord({
    spotifyTrackId: 'SpotifyTrack123',
    isrc: 'USABC1234567',
  }, item, {
    status: 'metadata',
    requestedTrackId: 'SpotifyTrack123',
    resolvedTrackId: 'SpotifyTrack123',
    relinked: false,
    spotifyArtistIds: ['SpotifyArtist123'],
    spotifyAlbumId: null,
    artworkUrl: null,
    isrc: 'GBXYZ7654321',
  });
  assert.equal(merged, null);
});

test('later incomplete Spotify metadata never erases existing valid album metadata', () => {
  const item = build().items[0];
  const existing = {
    spotifyTrackId: 'SpotifyTrack123',
    spotifyTrackUrl: 'https://open.spotify.com/track/SpotifyTrack123',
    spotifyAlbumId: 'ExistingAlbum123',
    spotifyAlbumUrl: 'https://open.spotify.com/album/ExistingAlbum123',
    artworkUrl: 'https://i.scdn.co/image/existing',
    isrc: 'USABC1234567',
    futureField: { keep: true },
  };
  const outcome = {
    status: 'metadata',
    requestedTrackId: 'SpotifyTrack123',
    resolvedTrackId: 'SpotifyTrack123',
    relinked: false,
    spotifyArtistIds: ['SpotifyArtist123'],
    spotifyAlbumId: null,
    artworkUrl: null,
    isrc: null,
  };
  const merged = engine.spotifyMetadataRecord(existing, item, outcome, '2026-08-08T09:00:00.000Z');
  assert.equal(merged.spotifyAlbumId, 'ExistingAlbum123');
  assert.equal(merged.spotifyAlbumUrl, 'https://open.spotify.com/album/ExistingAlbum123');
  assert.equal(merged.artworkUrl, 'https://i.scdn.co/image/existing');
  assert.equal(merged.isrc, 'USABC1234567');
  assert.deepEqual(merged.futureField, { keep: true });
});

test('artwork from an old album is not carried onto a newly returned album', () => {
  const item = build().items[0];
  const merged = engine.spotifyMetadataRecord({
    spotifyTrackId: 'SpotifyTrack123',
    spotifyAlbumId: 'OldAlbum123',
    spotifyAlbumUrl: 'https://open.spotify.com/album/OldAlbum123',
    artworkUrl: 'https://i.scdn.co/image/old-album',
  }, item, {
    status: 'metadata',
    requestedTrackId: 'SpotifyTrack123',
    resolvedTrackId: 'SpotifyTrack123',
    relinked: false,
    spotifyArtistIds: ['SpotifyArtist123'],
    spotifyAlbumId: 'NewAlbum456',
    artworkUrl: null,
    isrc: null,
  }, '2026-08-08T09:00:00.000Z');
  assert.equal(merged.spotifyAlbumId, 'NewAlbum456');
  assert.equal(merged.spotifyAlbumUrl, 'https://open.spotify.com/album/NewAlbum456');
  assert.equal(merged.artworkUrl, null);
});

test('a resolved recording can never be overwritten by a different provider resolution', () => {
  const item = build().items[0];
  assert.throws(() => engine.mergeIdentityRecord({
    workKey: item.trackKey,
    localBandId: 'band-1',
    spotifyTrackId: 'SpotifyTrack123',
    musicbrainzRecordingId: MB_RECORDING,
    status: 'resolved',
  }, item, 'musicbrainz', {
    status: 'resolved',
    reason: 'isrc_exact_trusted_artist',
    recordingMbid: OTHER_RECORDING,
    artistMbids: [MB_ARTIST],
  }, '2026-08-08T09:00:00.000Z'), /Resolved recording identity conflicts/);
});
