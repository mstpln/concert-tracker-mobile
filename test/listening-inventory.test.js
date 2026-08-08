'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventory = require('../scripts/listening-inventory');

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
    listenedAt: '2026-01-01T12:00:00.000Z',
    listenedDurationMs: 180000,
    artistCreditName: 'Example Band',
    recordingTitle: 'Exact Song',
    releaseTitle: 'Example Album',
    spotifyTrackId: 'SpotifyTrack123',
    source: 'spotify_import',
    ...overrides,
  };
}

test('inventory uses exact Spotify track IDs as the unique provider-work key', () => {
  const events = [event(), event({ stableListenId: 'listen-2', listenedAt: '2026-01-02T12:00:00.000Z' })];
  const result = inventory.buildListeningInventory({ bands: [band()], events });
  assert.equal(result.counts.sourceEvents, 2);
  assert.equal(result.counts.mappedEvents, 2);
  assert.equal(result.counts.uniqueTracks, 1);
  assert.equal(result.counts.spotifyKeyTracks, 1);
  assert.equal(result.counts.needsSpotifyTracks, 1);
  assert.equal(result.items[0].trackKey, 'spotify:SpotifyTrack123');
  assert.equal(result.items[0].sourceEventCount, 2);
});

test('existing source recording MBID completes a track with zero provider work', () => {
  const result = inventory.buildListeningInventory({
    bands: [band()],
    events: [event({ source: 'listenbrainz', spotifyTrackId: null, musicbrainzRecordingId: MB_RECORDING, musicbrainzArtistIds: [MB_ARTIST] })],
  });
  assert.equal(result.counts.completeTracks, 1);
  assert.equal(result.counts.sourceRecordingIdentityTracks, 1);
  assert.equal(result.counts.needsListenbrainzFallbackTracks, 0);
  assert.equal(result.items[0].reason, 'source_recording_mbid');
});

test('existing v107 track identity is reused before any provider planning', () => {
  const base = inventory.buildListeningInventory({ bands: [band()], events: [event()] });
  const key = base.items[0].trackKey;
  const result = inventory.buildListeningInventory({
    bands: [band()],
    events: [event()],
    trackIdentities: {
      kind: 'livevault-track-identities',
      schemaVersion: 1,
      records: {
        [key]: {
          workKey: key,
          spotifyTrackId: 'SpotifyTrack123',
          musicbrainzRecordingId: MB_RECORDING,
          futureField: { keep: true },
        },
      },
    },
  });
  assert.equal(result.items[0].status, 'complete');
  assert.equal(result.items[0].reason, 'existing_track_identity');
  assert.equal(result.counts.needsSpotifyTracks, 0);
});

test('existing Spotify metadata with ISRC routes to MusicBrainz without another Spotify fetch', () => {
  const result = inventory.buildListeningInventory({
    bands: [band()],
    events: [event()],
    spotifyMetadata: {
      records: {
        SpotifyTrack123: { spotifyTrackId: 'SpotifyTrack123', isrc: 'USABC1234567', futureField: { keep: true } },
      },
    },
  });
  assert.equal(result.items[0].status, 'needs_musicbrainz');
  assert.equal(result.items[0].reason, 'spotify_metadata_with_isrc');
  assert.equal(result.counts.needsSpotifyTracks, 0);
  assert.equal(result.counts.needsMusicbrainzTracks, 1);
});

test('text fallback is deterministic and requires trusted MusicBrainz artist identity', () => {
  const noSpotify = event({ source: 'listenbrainz', spotifyTrackId: null });
  const first = inventory.buildListeningInventory({ bands: [band()], events: [noSpotify] });
  const second = inventory.buildListeningInventory({ bands: [band()], events: [structuredClone(noSpotify)] });
  assert.match(first.items[0].trackKey, /^text:[a-f0-9]{64}$/);
  assert.equal(first.items[0].trackKey, second.items[0].trackKey);
  assert.equal(first.items[0].status, 'needs_listenbrainz_fallback');

  const untrusted = band({ musicbrainz: { mbid: MB_ARTIST, status: 'needs_review', spotify: { id: 'SpotifyArtist123', status: 'manual_confirmed' } } });
  const blocked = inventory.buildListeningInventory({ bands: [untrusted], events: [noSpotify] });
  assert.equal(blocked.items[0].status, 'blocked');
  assert.equal(blocked.items[0].reason, 'missing_trusted_musicbrainz_artist');
});

test('explicit stale band IDs never fall back to text matching', () => {
  const result = inventory.buildListeningInventory({
    bands: [band()],
    events: [event({ localBandId: 'deleted-band' })],
  });
  assert.equal(result.counts.mappedEvents, 0);
  assert.equal(result.counts.unmappedEvents, 1);
  assert.equal(result.counts.uniqueTracks, 0);
});

test('ambiguous duplicate band names remain unmapped instead of guessed', () => {
  const result = inventory.buildListeningInventory({
    bands: [band(), band({ id: 'band-2' })],
    events: [event()],
  });
  assert.equal(result.counts.mappedEvents, 0);
  assert.equal(result.counts.unmappedEvents, 1);
});

test('conflicting recording identities are blocked instead of guessed', () => {
  const result = inventory.buildListeningInventory({
    bands: [band()],
    events: [
      event({ stableListenId: 'lb-1', source: 'listenbrainz', spotifyTrackId: null, musicbrainzRecordingId: MB_RECORDING }),
      event({ stableListenId: 'lb-2', source: 'listenbrainz', spotifyTrackId: null, musicbrainzRecordingId: MB_RECORDING_2 }),
    ],
  });
  assert.equal(result.counts.uniqueTracks, 1);
  assert.equal(result.items[0].status, 'blocked');
  assert.equal(result.items[0].reason, 'source_recording_conflict');
});

test('inventory never mutates source observations or metadata documents', () => {
  const bands = [band({ unknownBandField: { keep: true } })];
  const events = [event({ unknownSourceField: { keep: true } })];
  const spotifyMetadata = { kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, futureRoot: { keep: true }, records: {} };
  const trackIdentities = { kind: 'livevault-track-identities', schemaVersion: 1, futureRoot: { keep: true }, records: {} };
  const before = structuredClone({ bands, events, spotifyMetadata, trackIdentities });
  inventory.buildListeningInventory({ bands, events, spotifyMetadata, trackIdentities });
  assert.deepEqual({ bands, events, spotifyMetadata, trackIdentities }, before);
});

test('safe inventory summary contains aggregate counts only', () => {
  const result = inventory.buildListeningInventory({ bands: [band()], events: [event()] });
  const summary = inventory.safeInventorySummary(result);
  const serialized = JSON.stringify(summary);
  assert.equal(summary.sourceEvents, 1);
  assert.equal(summary.uniqueTracks, 1);
  assert.doesNotMatch(serialized, /Example Band|Exact Song|SpotifyTrack123|listen-1/);
  assert.deepEqual(Object.keys(summary).sort(), [
    'blockedTracks', 'completeTracks', 'existingSpotifyMetadataTracks', 'existingTrackIdentityTracks',
    'mappedEvents', 'needsListenbrainzFallbackTracks', 'needsMusicbrainzTracks', 'needsSpotifyTracks',
    'sourceEvents', 'sourceRecordingIdentityTracks', 'spotifyKeyTracks', 'textFallbackTracks',
    'uniqueTracks', 'unmappedEvents', 'unusableEvents',
  ].sort());
});
