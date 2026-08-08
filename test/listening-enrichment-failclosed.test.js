'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryLib = require('../scripts/listening-inventory');
const engine = require('../scripts/listening-enrichment-engine');

function item() {
  const inventory = inventoryLib.buildListeningInventory({
    bands: [{
      id: 'band-1',
      name: 'Example Band',
      musicbrainz: {
        mbid: '11111111-1111-4111-8111-111111111111',
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
  });
  return inventory.items[0];
}

test('malformed Spotify artist collections fail closed without throwing', () => {
  const outcome = engine.spotifyOutcome({
    requestedTrackId: 'SpotifyTrack123',
    trustedSpotifyArtistId: 'SpotifyArtist123',
    payload: { id: 'SpotifyTrack123', artists: { id: 'SpotifyArtist123' }, external_ids: { isrc: 'USABC1234567' } },
  });
  assert.equal(outcome.status, 'needs_review');
  assert.equal(outcome.reason, 'spotify_artist_mismatch');
});

test('unknown provider outcome states cannot be persisted and retried as fresh work', () => {
  assert.throws(
    () => engine.mergeIdentityRecord(
      { workKey: 'spotify:SpotifyTrack123' },
      item(),
      'spotify',
      { status: 'unexpected', reason: 'bad-state' },
      '2026-08-08T08:00:00.000Z',
    ),
    /Invalid enrichment provider outcome/,
  );
});
