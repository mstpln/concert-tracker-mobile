'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const review = require('../listeningSpotifyIdentityReview');

function band(spotify) {
  return {
    id: 'band-a',
    name: 'Synthetic Artist',
    notes: 'preserve',
    futureField: { keep: true },
    musicbrainz: {
      mbid: 'mb-band-a',
      status: 'confirmed',
      ticketmaster: { id: 'tm-band-a', status: 'confirmed' },
      spotify,
    },
  };
}

test('stale rejection cannot reject replacement candidates the user did not review', () => {
  const latest = band({
    status: 'needs_review',
    reviewCandidates: [{ id: 'replacement', artistName: 'Replacement Candidate' }],
    unknownSpotifyField: { keep: true },
  });
  const before = structuredClone(latest);
  const result = review.applySpotifyReviewDecision([latest], {
    bandId: 'band-a',
    status: 'needs_review',
    candidates: [{ id: 'old', artistName: 'Old Candidate' }],
  }, { action: 'reject' }, { reviewedAt: '2026-08-06T00:00:00.000Z' });

  assert.equal(result.kind, 'candidate_set_changed');
  assert.deepEqual(result.bands, [before]);
  assert.equal(result.bands[0].musicbrainz.spotify.status, 'needs_review');
  assert.equal(result.bands[0].musicbrainz.spotify.reviewCandidates[0].id, 'replacement');
  assert.equal(result.bands[0].musicbrainz.spotify.rejectedCandidateIds, undefined);
});

test('candidate set comparison is order-independent and deduplicates repeated IDs', () => {
  assert.equal(review.sameCandidateSet(
    [{ id: 'two' }, { id: 'one' }, { id: 'one' }],
    [{ id: 'one' }, { id: 'two' }],
  ), true);
  assert.equal(review.sameCandidateSet([{ id: 'one' }], [{ id: 'one' }, { id: 'two' }]), false);
});
