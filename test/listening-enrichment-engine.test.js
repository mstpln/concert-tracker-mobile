'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryLib = require('../scripts/listening-inventory');
const engine = require('../scripts/listening-enrichment-engine');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';
const MB_RECORDING = '22222222-2222-4222-8222-222222222222';
const MB_RECORDING_2 = '33333333-3333-4333-8333-333333333333';

function band(overrides = {}) {
  return {
    id: 'band-1',
    name: 'Example Band',
    musicbrainz: {
      mbid: MB_ARTIST,
      status: 'manual_confirmed',
      spotify: { id: 'SpotifyArtist123', status: 'manual_confirmed' },
    },
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    stableListenId: 'listen-1',
    artistCreditName: 'Example Band',
    recordingTitle: 'Exact Song',
    spotifyTrackId: 'SpotifyTrack123',
    source: 'spotify_import',
    ...overrides,
  };
}

function build(options = {}) {
  return inventoryLib.buildListeningInventory({ bands: [band()], events: [event()], ...options });
}

test('planner follows Spotify then MusicBrainz then ListenBrainz without guessing', () => {
  const first = engine.planEnrichment({ inventory: build() });
  assert.equal(first.steps.length, 1);
  assert.equal(first.steps[0].provider, 'spotify');
  assert.equal(first.steps[0].operation, 'exact_track');

  const withIsrc = build({
    spotifyMetadata: { records: { SpotifyTrack123: { spotifyTrackId: 'SpotifyTrack123', isrc: 'USABC1234567' } } },
  });
  const second = engine.planEnrichment({ inventory: withIsrc });
  assert.equal(second.steps[0].provider, 'musicbrainz');
  assert.equal(second.steps[0].input.isrc, 'USABC1234567');

  const afterNoMatch = engine.planEnrichment({
    inventory: withIsrc,
    trackIdentities: {
      records: {
        'spotify:SpotifyTrack123': {
          workKey: 'spotify:SpotifyTrack123',
          isrc: 'USABC1234567',
          providers: { musicbrainz: { status: 'no_match' } },
        },
      },
    },
  });
  assert.equal(afterNoMatch.steps[0].provider, 'listenbrainz');
  assert.equal(afterNoMatch.steps[0].input.artistName, 'Example Band');
  assert.equal(afterNoMatch.steps[0].input.recordingName, 'Exact Song');
});

test('planner retries only explicitly scheduled provider work after it is due', () => {
  const inventory = build();
  const key = inventory.items[0].trackKey;
  const futureRetry = {
    workKey: key,
    nextEligibleCheckAt: '2026-08-09T08:00:00.000Z',
    providers: { spotify: { status: 'retry' } },
  };
  const waiting = engine.planEnrichment({
    inventory,
    now: '2026-08-08T08:00:00.000Z',
    trackIdentities: { records: { [key]: futureRetry } },
  });
  assert.equal(waiting.steps.length, 0);
  assert.equal(waiting.counts.retry_wait, 1);

  const due = engine.planEnrichment({
    inventory,
    now: '2026-08-10T08:00:00.000Z',
    trackIdentities: { records: { [key]: futureRetry } },
  });
  assert.equal(due.steps.length, 1);
  assert.equal(due.steps[0].provider, 'spotify');

  const unscheduledRetry = engine.planEnrichment({
    inventory,
    now: '2026-08-10T08:00:00.000Z',
    trackIdentities: { records: { [key]: { workKey: key, providers: { spotify: { status: 'retry' } } } } },
  });
  assert.equal(unscheduledRetry.steps.length, 0);
  assert.equal(unscheduledRetry.counts.no_route, 1);

  const priorError = engine.planEnrichment({
    inventory,
    trackIdentities: { records: { [key]: { workKey: key, providers: { spotify: { status: 'error' } } } } },
  });
  assert.equal(priorError.steps.length, 0);
  assert.equal(priorError.counts.no_route, 1);
});

test('planner respects resolved identities', () => {
  const inventory = build();
  const key = inventory.items[0].trackKey;
  const resolved = engine.planEnrichment({
    inventory,
    trackIdentities: { records: { [key]: { workKey: key, musicbrainzRecordingId: MB_RECORDING } } },
  });
  assert.equal(resolved.steps.length, 0);
  assert.equal(resolved.counts.complete, 1);
});

test('Spotify exact-track parsing preserves requested identity and accepts additive provider fields', () => {
  const outcome = engine.spotifyOutcome({
    requestedTrackId: 'SpotifyTrack123',
    trustedSpotifyArtistId: 'SpotifyArtist123',
    payload: {
      id: 'RelinkedTrack456',
      artists: [{ id: 'SpotifyArtist123' }],
      external_ids: { isrc: 'USABC1234567' },
      album: { id: 'Album123', images: [{ url: 'https://i.scdn.co/image/example' }] },
    },
  });
  assert.equal(outcome.status, 'metadata');
  assert.equal(outcome.requestedTrackId, 'SpotifyTrack123');
  assert.equal(outcome.resolvedTrackId, 'RelinkedTrack456');
  assert.equal(outcome.relinked, true);
  assert.equal(outcome.isrc, 'USABC1234567');

  const item = build().items[0];
  const metadata = engine.spotifyMetadataRecord({ futureField: { keep: true } }, item, outcome, '2026-08-08T08:00:00.000Z');
  assert.equal(metadata.spotifyTrackId, 'SpotifyTrack123');
  assert.equal(metadata.spotifyProviderResolvedTrackId, 'RelinkedTrack456');
  assert.deepEqual(metadata.futureField, { keep: true });
});

test('Spotify artist mismatch fails closed for a trusted band artist', () => {
  const outcome = engine.spotifyOutcome({
    requestedTrackId: 'SpotifyTrack123',
    trustedSpotifyArtistId: 'SpotifyArtist123',
    payload: { id: 'SpotifyTrack123', artists: [{ id: 'OtherArtist' }], external_ids: { isrc: 'USABC1234567' }, album: {} },
  });
  assert.equal(outcome.status, 'needs_review');
  assert.equal(outcome.reason, 'spotify_artist_mismatch');
});

test('MusicBrainz ISRC accepts exactly one recording belonging to the trusted artist', () => {
  const resolved = engine.musicbrainzIsrcOutcome({
    trustedMusicbrainzArtistMbid: MB_ARTIST,
    payload: {
      recordings: [
        { id: MB_RECORDING, 'artist-credit': [{ artist: { id: MB_ARTIST } }] },
        { id: MB_RECORDING_2, 'artist-credit': [{ artist: { id: '44444444-4444-4444-8444-444444444444' } }] },
      ],
    },
  });
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.recordingMbid, MB_RECORDING);

  const ambiguous = engine.musicbrainzIsrcOutcome({
    trustedMusicbrainzArtistMbid: MB_ARTIST,
    payload: {
      recordings: [
        { id: MB_RECORDING, 'artist-credit': [{ artist: { id: MB_ARTIST } }] },
        { id: MB_RECORDING_2, 'artist-credit': [{ artist: { id: MB_ARTIST } }] },
      ],
    },
  });
  assert.equal(ambiguous.status, 'needs_review');
});

test('ListenBrainz fallback requires exact normalized text plus trusted artist MBID', () => {
  const resolved = engine.listenbrainzOutcome({
    artistName: 'Example Band',
    recordingName: 'Exact Song',
    trustedMusicbrainzArtistMbid: MB_ARTIST,
    payload: {
      artist_credit_name: 'Example Band',
      artist_mbids: [MB_ARTIST],
      recording_name: 'Exact Song',
      recording_mbid: MB_RECORDING,
    },
  });
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.recordingMbid, MB_RECORDING);

  const mismatch = engine.listenbrainzOutcome({
    artistName: 'Example Band',
    recordingName: 'Exact Song',
    trustedMusicbrainzArtistMbid: MB_ARTIST,
    payload: {
      artist_credit_name: 'Different Band',
      artist_mbids: [MB_ARTIST],
      recording_name: 'Exact Song',
      recording_mbid: MB_RECORDING,
    },
  });
  assert.equal(mismatch.status, 'needs_review');
});

test('identity merges preserve unknown fields and never mutate inputs', () => {
  const item = build().items[0];
  const existing = { workKey: item.trackKey, futureField: { keep: true }, providers: { spotify: { futureProviderField: true } } };
  const before = structuredClone(existing);
  const outcome = {
    status: 'resolved',
    reason: 'isrc_exact_trusted_artist',
    recordingMbid: MB_RECORDING,
    artistMbids: [MB_ARTIST],
  };
  const merged = engine.mergeIdentityRecord(existing, item, 'musicbrainz', outcome, '2026-08-08T08:00:00.000Z');
  assert.deepEqual(existing, before);
  assert.deepEqual(merged.futureField, { keep: true });
  assert.equal(merged.musicbrainzRecordingId, MB_RECORDING);
  assert.equal(merged.status, 'resolved');
});

test('identity merges never downgrade an existing resolved recording', () => {
  const item = build().items[0];
  const existing = {
    workKey: item.trackKey,
    musicbrainzRecordingId: MB_RECORDING,
    status: 'resolved',
    nextEligibleCheckAt: '2026-08-09T08:00:00.000Z',
    futureField: { keep: true },
  };
  const merged = engine.mergeIdentityRecord(
    existing,
    item,
    'spotify',
    { status: 'error', reason: 'provider_error' },
    '2026-08-08T08:00:00.000Z',
  );
  assert.equal(merged.musicbrainzRecordingId, MB_RECORDING);
  assert.equal(merged.status, 'resolved');
  assert.equal(merged.nextEligibleCheckAt, null);
  assert.deepEqual(merged.futureField, { keep: true });
});

test('safe plan summary contains counts only', () => {
  const plan = engine.planEnrichment({ inventory: build() });
  const summary = engine.safePlanSummary(plan);
  const serialized = JSON.stringify(summary);
  assert.equal(summary.spotify, 1);
  assert.doesNotMatch(serialized, /Example Band|Exact Song|SpotifyTrack123/);
});
