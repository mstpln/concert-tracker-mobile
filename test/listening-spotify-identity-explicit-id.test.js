'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const identityState = require('../providerIdentityState');
const review = require('../listeningSpotifyIdentityReview');

test('an explicit missing band ID never falls back to another band with the same artist name', () => {
  const bands = [{
    id: 'current-band',
    name: 'Synthetic Artist',
    musicbrainz: { mbid: 'mb-current', status: 'confirmed', spotify: { status: 'no_match' } },
  }];
  const events = [{
    stableListenId: 'listen-from-deleted-band',
    bandId: 'deleted-band',
    artistCreditName: 'Synthetic Artist',
    listenedAt: '2026-08-05T00:00:00.000Z',
    source: 'spotify_import',
    spotifyTrackId: 'track-a',
  }];

  const [row] = review.auditSpotifyArtistIdentities(bands, events, {
    identityState,
    now: '2026-08-06T00:00:00.000Z',
  });

  assert.equal(row.bandId, 'current-band');
  assert.deepEqual(row.affectedListens, {
    allTime: 0,
    twoWeeks: 0,
    threeMonths: 0,
    oneYear: 0,
    spotify: 0,
  });
});
