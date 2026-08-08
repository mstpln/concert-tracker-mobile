'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryLib = require('../scripts/listening-inventory');
const engine = require('../scripts/listening-enrichment-engine');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';
const OLD_RECORDING_FIELD = '22222222-2222-4222-8222-222222222222';

function item() {
  const inventory = inventoryLib.buildListeningInventory({
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
  assert.equal(outcome.reason, 'malformed_spotify_artist_ids');
});

test('explicit malformed Spotify provider fields fail closed', () => {
  const base = {
    id: 'SpotifyTrack123',
    artists: [{ id: 'SpotifyArtist123' }],
    album: { id: 'Album123', images: [{ url: 'https://i.scdn.co/image/example' }] },
    external_ids: { isrc: 'USABC1234567' },
  };
  const cases = [
    [{ ...base, album: { id: 'bad id', images: [] } }, 'malformed_spotify_album_id'],
    [{ ...base, album: { id: 'Album123', images: [{ url: 'http://example.com/image' }] } }, 'malformed_spotify_artwork_url'],
    [{ ...base, external_ids: { isrc: 'bad-isrc' } }, 'malformed_spotify_isrc'],
    [{ ...base, artists: [{ id: 'SpotifyArtist123' }, { id: 'bad id' }] }, 'malformed_spotify_artist_ids'],
  ];
  for (const [payload, reason] of cases) {
    const outcome = engine.spotifyOutcome({ requestedTrackId: 'SpotifyTrack123', trustedSpotifyArtistId: 'SpotifyArtist123', payload });
    assert.equal(outcome.status, 'error');
    assert.equal(outcome.reason, reason);
  }
});

test('malformed MusicBrainz recording or artist-credit data fails closed', () => {
  const badRecording = engine.musicbrainzIsrcOutcome({
    trustedMusicbrainzArtistMbid: MB_ARTIST,
    payload: { recordings: [{ id: 'bad-mbid', 'artist-credit': [{ artist: { id: MB_ARTIST } }] }] },
  });
  assert.equal(badRecording.status, 'error');
  assert.equal(badRecording.reason, 'malformed_musicbrainz_recording');

  const badCredit = engine.musicbrainzIsrcOutcome({
    trustedMusicbrainzArtistMbid: MB_ARTIST,
    payload: { recordings: [{ id: OLD_RECORDING_FIELD, 'artist-credit': [{ artist: { id: 'bad-mbid' } }] }] },
  });
  assert.equal(badCredit.status, 'error');
  assert.equal(badCredit.reason, 'malformed_musicbrainz_artist_credits');
});

test('malformed ListenBrainz identity fields fail closed', () => {
  const malformedArtistIds = engine.listenbrainzOutcome({
    artistName: 'Example Band',
    recordingName: 'Exact Song',
    trustedMusicbrainzArtistMbid: MB_ARTIST,
    payload: {
      artist_credit_name: 'Example Band',
      artist_mbids: [MB_ARTIST, 'bad-mbid'],
      recording_name: 'Exact Song',
      recording_mbid: OLD_RECORDING_FIELD,
    },
  });
  assert.equal(malformedArtistIds.status, 'error');
  assert.equal(malformedArtistIds.reason, 'malformed_listenbrainz_artist_ids');

  const malformedRecording = engine.listenbrainzOutcome({
    artistName: 'Example Band',
    recordingName: 'Exact Song',
    trustedMusicbrainzArtistMbid: MB_ARTIST,
    payload: {
      artist_credit_name: 'Example Band',
      artist_mbids: [MB_ARTIST],
      recording_name: 'Exact Song',
      recording_mbid: 'bad-mbid',
    },
  });
  assert.equal(malformedRecording.status, 'error');
  assert.equal(malformedRecording.reason, 'malformed_listenbrainz_recording_mbid');
});

test('unknown provider outcome states cannot be persisted and retried as fresh work', () => {
  assert.throws(
    () => engine.mergeIdentityRecord(
      { workKey: 'spotify:SpotifyTrack123', spotifyTrackId: 'SpotifyTrack123' },
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
        [work.trackKey]: {
          workKey: work.trackKey,
          spotifyTrackId: work.spotifyTrackId,
          providers: { spotify: { status: 'future_status' } },
        },
      },
    },
  });
  assert.equal(plan.steps.length, 0);
  assert.equal(plan.counts.no_route, 1);
});

test('retry persistence requires a valid explicit retry date', () => {
  const work = item();
  for (const nextEligibleCheckAt of [undefined, null, 'not-a-date']) {
    assert.throws(() => engine.mergeIdentityRecord(
      { workKey: work.trackKey, spotifyTrackId: work.spotifyTrackId },
      work,
      'spotify',
      { status: 'retry', reason: 'rate_limited', nextEligibleCheckAt },
      '2026-08-08T08:00:00.000Z',
    ), /requires nextEligibleCheckAt/);
  }
});

test('older compatible recording-id fields still suppress provider work', () => {
  const work = item();
  const plan = engine.planEnrichment({
    inventory: { items: [work] },
    trackIdentities: {
      records: {
        [work.trackKey]: {
          workKey: work.trackKey,
          spotifyTrackId: work.spotifyTrackId,
          musicbrainzRecordingMbid: OLD_RECORDING_FIELD,
        },
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
        [work.trackKey]: {
          workKey: work.trackKey,
          spotifyTrackId: work.spotifyTrackId,
          localBandId: 'different-band',
        },
      },
    },
  });
  assert.equal(plan.steps.length, 0);
  assert.equal(plan.counts.blocked, 1);
  assert.throws(
    () => engine.mergeIdentityRecord(
      { workKey: work.trackKey, spotifyTrackId: work.spotifyTrackId, localBandId: 'different-band' },
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
