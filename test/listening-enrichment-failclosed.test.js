'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryLib = require('../scripts/listening-inventory');
const engine = require('../scripts/listening-enrichment-engine');

const OLD_RECORDING_FIELD = '22222222-2222-4222-8222-222222222222';

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
  assert.equal(outcome.status, 'error');
  assert.equal(outcome.reason, 'missing_spotify_artist_ids');
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

  const work = item();
  const plan = engine.planEnrichment({
    inventory: { items: [work] },
    trackIdentities: {
      records: {
        [work.trackKey]: { workKey: work.trackKey, providers: { spotify: { status: 'future_status' } } },
      },
    },
  });
  assert.equal(plan.steps.length, 0);
  assert.equal(plan.counts.no_route, 1);
});

test('older compatible recording-id fields still suppress provider work', () => {
  const work = item();
  const plan = engine.planEnrichment({
    inventory: { items: [work] },
    trackIdentities: {
      records: {
        [work.trackKey]: { workKey: work.trackKey, musicbrainzRecordingMbid: OLD_RECORDING_FIELD },
      },
    },
  });
  assert.equal(plan.steps.length, 0);
  assert.equal(plan.counts.complete, 1);
});

test('stale band ownership in a stored identity blocks rather than migrating silently', () => {
  const work = item();
  const plan = engine.planEnrichment({
    inventory: { items: [work] },
    trackIdentities: {
      records: {
        [work.trackKey]: { workKey: work.trackKey, localBandId: 'different-band' },
      },
    },
  });
  assert.equal(plan.steps.length, 0);
  assert.equal(plan.counts.blocked, 1);
  assert.throws(
    () => engine.mergeIdentityRecord(
      { workKey: work.trackKey, localBandId: 'different-band' },
      work,
      'spotify',
      { status: 'no_match', reason: 'not_found' },
    ),
    /conflicts with the planned work item/,
  );
});

test('malformed supplied track-identity documents stop before planning provider work', () => {
  assert.throws(
    () => engine.planEnrichment({ inventory: { items: [item()] }, trackIdentities: { records: [] } }),
    /Invalid track identity document/,
  );
});
