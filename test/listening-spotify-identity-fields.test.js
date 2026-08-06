'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const identityState = require('../providerIdentityState');
const review = require('../listeningSpotifyIdentityReview');

test('Spotify identity audit accepts stored listening timestamps, artists and Spotify source names', () => {
  const bands = [{ id: 'a', name: 'Alpha', musicbrainz: { mbid: 'mb-a', status: 'confirmed', spotify: { status: 'no_match' } } }];
  const now = '2026-08-06T00:00:00.000Z';
  const timestamp = Date.parse('2026-08-05T00:00:00.000Z');
  const events = [
    { stableListenId: 'ms', localBandId: 'a', listenedAtMs: timestamp, source: 'spotify_import', spotifyTrackId: 'track-ms' },
    { stableListenId: 'iso', artistCreditName: 'Alpha', listenedAt: '2026-08-05T01:00:00.000Z', source: 'listenbrainz' },
    { stableListenId: 'seconds', master_metadata_album_artist_name: 'Alpha', listenedAt: String(Math.floor(timestamp / 1000)), source: 'spotify_import', spotify_track_uri: 'spotify:track:track-seconds' },
  ];
  const [row] = review.auditSpotifyArtistIdentities(bands, events, { identityState, now });
  assert.deepEqual(row.affectedListens, { allTime: 3, twoWeeks: 3, threeMonths: 3, oneYear: 3, spotify: 2 });
  assert.equal(row.distinctSpotifyTrackIds, 2);
  assert.equal(row.firstAffectedAt, '2026-08-05T00:00:00.000Z');
  assert.equal(row.lastAffectedAt, '2026-08-05T01:00:00.000Z');
});

test('Spotify identity audit uses calendar subtraction for three-month and one-year windows', () => {
  const bands = [{ id: 'a', name: 'Alpha', musicbrainz: { mbid: 'mb-a', status: 'confirmed', spotify: { status: 'no_match' } } }];
  const events = [
    { stableListenId: 'inside-three-months', bandId: 'a', listenedAt: '2026-05-06T00:00:00.000Z' },
    { stableListenId: 'outside-three-months', bandId: 'a', listenedAt: '2026-05-05T23:59:59.999Z' },
    { stableListenId: 'inside-year', bandId: 'a', listenedAt: '2025-08-06T00:00:00.000Z' },
    { stableListenId: 'outside-year', bandId: 'a', listenedAt: '2025-08-05T23:59:59.999Z' },
  ];
  const [row] = review.auditSpotifyArtistIdentities(bands, events, { identityState, now: '2026-08-06T00:00:00.000Z' });
  assert.equal(row.affectedListens.threeMonths, 1);
  assert.equal(row.affectedListens.oneYear, 3);
});
