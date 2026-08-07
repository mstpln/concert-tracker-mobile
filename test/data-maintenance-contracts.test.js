'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const contracts = require('../scripts/lib/dataMaintenanceContracts');

const now = '2026-08-07T12:00:00.000Z';
const bandId = 'band-1';
const recordingMbid = '12345678-1234-4234-8234-123456789abc';
const artistMbid = '22345678-1234-4234-8234-123456789abc';

test('Spotify listening metadata extends additively with exact artist IDs and ISRC', () => {
  const doc = {
    kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: now,
    records: {
      abc123: {
        spotifyTrackId: 'abc123', spotifyTrackUrl: 'https://open.spotify.com/track/abc123',
        spotifyAlbumId: 'album1', spotifyAlbumUrl: 'https://open.spotify.com/album/album1',
        artworkUrl: 'https://image.example/art.jpg', spotifyArtistIds: ['artist1'], isrc: 'SEAAA1200001',
        fetchedAt: now, source: 'spotify_exact_track_id', futureField: { preserved: true },
      },
    }, futureRoot: true,
  };
  assert.equal(contracts.validSpotifyMetadataDocument(doc), true);
  assert.equal(contracts.validSpotifyMetadataDocument({ ...doc, records: { abc123: { ...doc.records.abc123, isrc: 'bad' } } }), false);
});

test('track identities accept exact provider work keys and reject ambiguous identity shapes', () => {
  const record = {
    trackKey: 'spotify:abc123', bandId, musicbrainzRecordingMbid: recordingMbid,
    musicbrainzArtistMbids: [artistMbid], evidence: [{ source: 'isrc_musicbrainz', observedAt: now, future: true }],
    status: 'complete', verifiedAt: now, nextEligibleCheckAt: null, futureField: 'kept',
  };
  const doc = { kind: 'bandmarkr-listening-track-identities', schemaVersion: 1, updatedAt: now, records: { 'spotify:abc123': record } };
  assert.equal(contracts.validTrackIdentitiesDocument(doc), true);
  assert.equal(contracts.validTrackIdentitiesDocument({ ...doc, records: { 'spotify:abc123': { ...record, trackKey: 'spotify:other' } } }), false);
  assert.equal(contracts.validTrackIdentitiesDocument({ ...doc, records: { 'text:guess': { ...record, trackKey: 'text:guess' } } }), false);
});

test('hashed ListenBrainz fallback keys are deterministic contract inputs, not raw private text', () => {
  const key = `listenbrainz:${'a'.repeat(64)}`;
  const doc = {
    kind: 'bandmarkr-listening-track-identities', schemaVersion: 1, updatedAt: now,
    records: { [key]: { trackKey: key, bandId, status: 'unresolved', evidence: [{ source: 'source_event' }], verifiedAt: null, nextEligibleCheckAt: now } },
  };
  assert.equal(contracts.validTrackIdentitiesDocument(doc), true);
});

test('weather remains a separate derived document keyed by stable concert ID', () => {
  const doc = {
    kind: 'bandmarkr-concert-weather', schemaVersion: 1, updatedAt: now,
    records: {
      'concert-1': {
        concertId: 'concert-1', source: 'open-meteo', fetchedAt: now, nextEligibleCheckAt: now,
        locationResolvedAt: now, locationFingerprint: 'b'.repeat(64),
        coordinates: { latitude: 55.6, longitude: 13.0 }, forecast: { temperature: 18 }, unknownFutureField: true,
      },
    },
  };
  assert.equal(contracts.validWeatherDocument(doc), true);
  assert.equal(contracts.validWeatherDocument({ ...doc, records: { 'concert-1': { ...doc.records['concert-1'], coordinates: { latitude: 120, longitude: 13 } } } }), false);
});
