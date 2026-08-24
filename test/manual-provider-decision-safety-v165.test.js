'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const MusicbrainzState = require('../musicbrainzState');
const UiCorrections = require('../appUpdateAub3CorrectionV157');

const manualTicketmaster = {
  id: 'K8vZ917test',
  attractionName: 'Example Artist',
  status: 'manual_confirmed',
  matchMethod: 'user_approved_exact_id',
  confidence: 'user_confirmed',
  reviewedAt: '2026-08-24T18:00:00.000Z',
  reviewedBy: 'user',
  futureField: { keep: true },
};

const manualSpotifyRejection = {
  id: null,
  status: 'manual_rejected',
  reviewedAt: '2026-08-24T18:00:00.000Z',
  reason: 'known_wrong_artist',
  futureField: { keep: true },
};

function previousMusicbrainz() {
  return {
    status: 'needs_review',
    mbid: null,
    source: 'MusicBrainz',
    lastAttemptedAt: '2026-08-24T17:00:00.000Z',
    reviewCandidates: [{ mbid: 'candidate-1', artistName: 'Example Artist', score: 90 }],
    rejectedCandidateMbids: ['old-rejection'],
    ticketmaster: manualTicketmaster,
    spotify: manualSpotifyRejection,
    futureProvider: { id: 'future-user', status: 'manual_confirmed', futureField: 42 },
    automatedProvider: { id: 'automatic', status: 'confirmed' },
    metadata: { artistName: 'stale metadata' },
  };
}

function assertReviewedProvidersPreserved(next) {
  assert.deepEqual(next.ticketmaster, manualTicketmaster);
  assert.deepEqual(next.spotify, manualSpotifyRejection);
  assert.deepEqual(next.futureProvider, { id: 'future-user', status: 'manual_confirmed', futureField: 42 });
  assert.equal(next.automatedProvider, undefined);
  assert.equal(next.metadata, undefined);
}

test('manual MusicBrainz confirmation preserves nested reviewed provider decisions', () => {
  const previous = previousMusicbrainz();
  const next = MusicbrainzState.confirmedIdentity(
    { mbid: 'candidate-1', artistName: 'Example Artist', score: 90 },
    previous,
    '2026-08-24T19:00:00.000Z'
  );
  assert.equal(next.status, 'manual_confirmed');
  assert.equal(next.mbid, 'candidate-1');
  assertReviewedProvidersPreserved(next);
});

test('manual MusicBrainz rejection preserves nested reviewed provider decisions', () => {
  const next = MusicbrainzState.rejectCandidates(previousMusicbrainz(), '2026-08-24T19:00:00.000Z');
  assert.equal(next.status, 'manual_rejected');
  assert.equal(next.mbid, null);
  assert.deepEqual(next.rejectedCandidateMbids, ['old-rejection', 'candidate-1']);
  assertReviewedProvidersPreserved(next);
});

test('MusicBrainz retry preserves nested reviewed provider decisions', () => {
  const next = MusicbrainzState.retryIdentity(previousMusicbrainz(), '2026-08-24T19:00:00.000Z');
  assert.equal(next.status, 'pending');
  assert.equal(next.mbid, null);
  assertReviewedProvidersPreserved(next);
});

test('manual provider presentation formats semantic confidence without a percent suffix', () => {
  assert.equal(UiCorrections.providerIdentityConfidenceText('user_confirmed'), 'User confirmed');
  assert.equal(UiCorrections.providerIdentityConfidenceText(100), '100%');
  assert.equal(UiCorrections.providerIdentityConfidenceText(null), null);
  const html = '<span>user_confirmed%</span><span>user approved exact id</span>';
  assert.equal(
    UiCorrections.providerIdentityHtmlCorrections(html),
    '<span>User confirmed</span><span>User-approved exact ID</span>'
  );
});
