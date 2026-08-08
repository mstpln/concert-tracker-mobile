'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryLib = require('../scripts/listening-inventory');
const engine = require('../scripts/listening-enrichment-engine');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';

function build({ trustedMusicbrainz = true } = {}) {
  return inventoryLib.buildListeningInventory({
    bands: [{
      id: 'band-1',
      name: 'Example Band',
      musicbrainz: {
        ...(trustedMusicbrainz ? { mbid: MB_ARTIST, status: 'manual_confirmed' } : {}),
        spotify: { id: 'SpotifyArtist123', status: 'manual_confirmed' },
      },
    }],
    events: [{
      bandId: 'band-1',
      artistCreditName: 'Example Band',
      recordingTitle: 'Exact Song',
      spotifyTrackId: 'SpotifyTrack123',
    }],
  });
}

test('stored ISRC is reused before another Spotify request', () => {
  const inventory = build();
  const key = inventory.items[0].trackKey;
  const plan = engine.planEnrichment({
    inventory,
    trackIdentities: {
      records: {
        [key]: {
          workKey: key,
          localBandId: 'band-1',
          spotifyTrackId: 'SpotifyTrack123',
          isrc: 'USABC1234567',
        },
      },
    },
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
    trackIdentities: {
      records: {
        [key]: {
          workKey: key,
          localBandId: 'band-1',
          spotifyTrackId: 'SpotifyTrack123',
          isrc: 'USABC1234567',
        },
      },
    },
  });

  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].provider, 'spotify');
  assert.equal(plan.steps[0].operation, 'exact_track');
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
