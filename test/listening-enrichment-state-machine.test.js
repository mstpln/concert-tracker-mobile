'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryLib = require('../scripts/listening-inventory');
const engine = require('../scripts/listening-enrichment-engine');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';
const MB_RECORDING = '22222222-2222-4222-8222-222222222222';

function work() {
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

test('top-level terminal identity states never restart provider work', () => {
  for (const status of ['needs_review', 'error', 'no_match']) {
    const item = work();
    const plan = engine.planEnrichment({
      inventory: { items: [item] },
      trackIdentities: { records: { [item.trackKey]: { workKey: item.trackKey, spotifyTrackId: item.spotifyTrackId, status } } },
    });
    assert.equal(plan.steps.length, 0, status);
    assert.equal(plan.counts.no_route, 1, status);
  }
});

test('top-level resolved without recording identity is treated as inconsistent and blocked', () => {
  const item = work();
  const plan = engine.planEnrichment({
    inventory: { items: [item] },
    trackIdentities: { records: { [item.trackKey]: { workKey: item.trackKey, spotifyTrackId: item.spotifyTrackId, status: 'resolved' } } },
  });
  assert.equal(plan.steps.length, 0);
  assert.equal(plan.counts.blocked, 1);
});

test('top-level retry requires exactly one provider retry state', () => {
  const item = work();
  for (const providers of [{}, { spotify: { status: 'retry' }, musicbrainz: { status: 'retry' } }]) {
    const plan = engine.planEnrichment({
      inventory: { items: [item] },
      now: '2026-08-08T10:00:00.000Z',
      trackIdentities: { records: { [item.trackKey]: {
        workKey: item.trackKey,
        spotifyTrackId: item.spotifyTrackId,
        status: 'retry',
        nextEligibleCheckAt: '2026-08-08T09:00:00.000Z',
        providers,
      } } },
    });
    assert.equal(plan.steps.length, 0);
    assert.equal(plan.counts.no_route, 1);
  }
});

test('nested retry state without top-level retry never triggers a hidden retry', () => {
  const item = work();
  const plan = engine.planEnrichment({
    inventory: { items: [item] },
    now: '2026-08-08T10:00:00.000Z',
    trackIdentities: { records: { [item.trackKey]: {
      workKey: item.trackKey,
      spotifyTrackId: item.spotifyTrackId,
      status: 'unresolved',
      nextEligibleCheckAt: '2026-08-08T09:00:00.000Z',
      providers: { spotify: { status: 'retry' } },
    } } },
  });
  assert.equal(plan.steps.length, 0);
  assert.equal(plan.counts.no_route, 1);
});

test('a due retry can schedule only its owning provider', () => {
  const item = work();
  const spotifyRetry = engine.planEnrichment({
    inventory: { items: [item] },
    now: '2026-08-08T10:00:00.000Z',
    trackIdentities: { records: { [item.trackKey]: {
      workKey: item.trackKey,
      spotifyTrackId: item.spotifyTrackId,
      status: 'retry',
      nextEligibleCheckAt: '2026-08-08T09:00:00.000Z',
      providers: { spotify: { status: 'retry' } },
    } } },
  });
  assert.equal(spotifyRetry.steps.length, 1);
  assert.equal(spotifyRetry.steps[0].provider, 'spotify');

  const musicbrainzRetry = engine.planEnrichment({
    inventory: { items: [item] },
    now: '2026-08-08T10:00:00.000Z',
    trackIdentities: { records: { [item.trackKey]: {
      workKey: item.trackKey,
      spotifyTrackId: item.spotifyTrackId,
      isrc: 'USABC1234567',
      status: 'retry',
      nextEligibleCheckAt: '2026-08-08T09:00:00.000Z',
      providers: { musicbrainz: { status: 'retry' } },
    } } },
  });
  assert.equal(musicbrainzRetry.steps.length, 1);
  assert.equal(musicbrainzRetry.steps[0].provider, 'musicbrainz');
});

test('provider-specific outcome statuses are enforced at persistence', () => {
  const item = work();
  assert.throws(() => engine.mergeIdentityRecord({}, item, 'spotify', {
    status: 'resolved',
    reason: 'invalid',
    recordingMbid: MB_RECORDING,
  }), /Invalid Spotify enrichment outcome status/);
  assert.throws(() => engine.mergeIdentityRecord({}, item, 'musicbrainz', {
    status: 'metadata',
    reason: 'invalid',
  }), /Invalid enrichment provider outcome status/);
});

test('resolved outcome cannot be persisted without recording identity', () => {
  const item = work();
  assert.throws(() => engine.mergeIdentityRecord({}, item, 'musicbrainz', {
    status: 'resolved',
    reason: 'invalid',
    artistMbids: [MB_ARTIST],
  }), /missing recording identity/);
});

test('Spotify metadata helper independently rejects contradictory artist identity', () => {
  const item = work();
  const record = engine.spotifyMetadataRecord(null, item, {
    status: 'metadata',
    requestedTrackId: item.spotifyTrackId,
    resolvedTrackId: item.spotifyTrackId,
    relinked: false,
    spotifyArtistIds: ['DifferentSpotifyArtist'],
    spotifyAlbumId: null,
    artworkUrl: null,
    isrc: null,
  });
  assert.equal(record, null);
});

test('malformed stored providers container blocks planning', () => {
  const item = work();
  for (const providers of ['spotify', [], 17]) {
    const plan = engine.planEnrichment({
      inventory: { items: [item] },
      trackIdentities: { records: { [item.trackKey]: {
        workKey: item.trackKey,
        spotifyTrackId: item.spotifyTrackId,
        providers,
      } } },
    });
    assert.equal(plan.steps.length, 0);
    assert.equal(plan.counts.blocked, 1);
  }
});

test('malformed compatible recording identity field blocks even beside a valid field', () => {
  const item = work();
  for (const malformedValue of [17, 'not-a-mbid']) {
    const plan = engine.planEnrichment({
      inventory: { items: [item] },
      trackIdentities: { records: { [item.trackKey]: {
        workKey: item.trackKey,
        spotifyTrackId: item.spotifyTrackId,
        musicbrainzRecordingId: MB_RECORDING,
        recordingMbid: malformedValue,
      } } },
    });
    assert.equal(plan.steps.length, 0);
    assert.equal(plan.counts.blocked, 1);
  }
});
