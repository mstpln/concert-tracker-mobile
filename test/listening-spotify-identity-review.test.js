'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const identityState = require('../providerIdentityState');
const review = require('../listeningSpotifyIdentityReview');

function band(id, name, spotify) {
  return { id, name, favorite: true, notes: 'preserve', futureField: { keep: true }, musicbrainz: { mbid: `mb-${id}`, status: 'confirmed', ticketmaster: { id: `tm-${id}`, status: 'confirmed', unknownTicketmasterField: true }, ...(spotify ? { spotify } : {}) } };
}

test('audits every unresolved Spotify identity and separates stored candidates from acquisition work', () => {
  const bands = [
    band('trusted', 'Trusted Band', { id: 'spotify-trusted', status: 'confirmed' }),
    band('candidate', 'Candidate Band', { status: 'needs_review', reviewCandidates: [{ id: 'spotify-candidate', artistName: 'Candidate Band' }] }),
    band('missing', 'Missing Band'),
  ];
  const events = [
    { stableListenId: '1', bandId: 'candidate', playedAt: '2026-08-05T00:00:00.000Z', source: 'spotify', spotifyTrackId: 'track-1' },
    { stableListenId: '2', artistName: 'Missing Band', playedAt: '2026-05-10T00:00:00.000Z', source: 'spotify', spotifyTrackId: 'track-2' },
    { stableListenId: '3', artistName: 'Missing Band', playedAt: '2025-01-01T00:00:00.000Z', source: 'listenbrainz' },
  ];

  const rows = review.auditSpotifyArtistIdentities(bands, events, { identityState, now: '2026-08-06T00:00:00.000Z' });
  assert.deepEqual(rows.map((row) => row.bandId), ['missing', 'candidate']);
  assert.equal(rows[0].actionState, 'candidate_acquisition_required');
  assert.deepEqual(rows[0].affectedListens, { allTime: 2, twoWeeks: 0, threeMonths: 1, oneYear: 1, spotify: 1 });
  assert.equal(rows[0].distinctSpotifyTrackIds, 1);
  assert.equal(rows[1].actionState, 'candidate_available');
  assert.equal(rows[1].candidates[0].id, 'spotify-candidate');
  assert.equal(rows[1].affectedListens.twoWeeks, 1);
});

test('uses explicit stable band IDs before names and leaves ambiguous duplicate names unmapped', () => {
  const bands = [band('a', 'Same Name'), band('b', 'Same Name'), band('unique', 'Beyonce')];
  const events = [
    { stableListenId: '1', artistName: 'Same Name', playedAt: '2026-08-05T00:00:00.000Z', source: 'spotify' },
    { stableListenId: '2', localBandId: 'b', artistName: 'Wrong Name', playedAt: '2026-08-05T00:00:00.000Z', source: 'spotify' },
    { stableListenId: '3', artistName: 'Beyonce', playedAt: '2026-08-05T00:00:00.000Z', source: 'spotify' },
  ];
  const rows = review.auditSpotifyArtistIdentities(bands, events, { identityState, now: '2026-08-06T00:00:00.000Z' });
  const byId = new Map(rows.map((row) => [row.bandId, row]));
  assert.equal(byId.get('a').affectedListens.allTime, 0);
  assert.equal(byId.get('b').affectedListens.allTime, 1);
  assert.equal(byId.get('unique').affectedListens.allTime, 1);
});

test('surfaces duplicate trusted Spotify IDs as unresolved conflicts', () => {
  const bands = [
    band('a', 'Alpha', { id: 'same-id', status: 'manual_confirmed' }),
    band('b', 'Beta', { id: 'same-id', status: 'confirmed' }),
  ];
  const rows = review.auditSpotifyArtistIdentities(bands, [], { identityState, now: '2026-08-06T00:00:00.000Z' });
  assert.equal(rows.length, 2);
  assert.equal(rows.every((row) => row.duplicateConflict), true);
  assert.equal(rows.every((row) => row.actionState === 'candidate_acquisition_required'), true);
});

test('deduplicates stored candidates without mutating provider records', () => {
  const spotify = { status: 'needs_review', unknownFutureField: { keep: true }, reviewCandidates: [{ id: 'one', artistName: 'One' }, { id: 'one', artistName: 'Duplicate' }, { id: 'two', artistName: 'Two' }] };
  const bands = [band('a', 'Alpha', spotify)];
  const before = structuredClone(bands);
  const [row] = review.auditSpotifyArtistIdentities(bands, [], { identityState, now: '2026-08-06T00:00:00.000Z' });
  assert.deepEqual(row.candidates.map((candidate) => candidate.id), ['one', 'two']);
  assert.deepEqual(bands, before);
});

test('manual confirmation changes only the Spotify provider record and preserves user, provider, and future fields', () => {
  const original = band('a', 'Alpha', {
    status: 'needs_review',
    reviewCandidates: [{ id: 'spotify-alpha', artistName: 'Alpha', url: 'https://open.spotify.com/artist/spotify-alpha', score: 99 }],
    unknownSpotifyField: { keep: true },
  });
  const result = review.applySpotifyReviewDecision([original], {
    bandId: 'a', status: 'needs_review', candidates: original.musicbrainz.spotify.reviewCandidates,
  }, { action: 'confirm', candidateId: 'spotify-alpha' }, { reviewedAt: '2026-08-06T00:00:00.000Z' });
  assert.equal(result.kind, 'updated');
  assert.notEqual(result.bands, [original]);
  assert.equal(result.bands[0].favorite, true);
  assert.equal(result.bands[0].notes, 'preserve');
  assert.deepEqual(result.bands[0].futureField, { keep: true });
  assert.equal(result.bands[0].musicbrainz.mbid, 'mb-a');
  assert.equal(result.bands[0].musicbrainz.ticketmaster.id, 'tm-a');
  assert.deepEqual(result.bands[0].musicbrainz.spotify.unknownSpotifyField, { keep: true });
  assert.equal(result.bands[0].musicbrainz.spotify.status, 'manual_confirmed');
  assert.equal(result.bands[0].musicbrainz.spotify.id, 'spotify-alpha');
  assert.equal(result.bands[0].musicbrainz.spotify.reviewedBy, 'user');
});

test('manual rejection preserves candidate evidence and records exact rejected candidate IDs', () => {
  const original = band('a', 'Alpha', {
    status: 'needs_review',
    reviewCandidates: [{ id: 'one', artistName: 'One' }, { id: 'two', artistName: 'Two' }],
    unknownSpotifyField: 'keep',
  });
  const result = review.applySpotifyReviewDecision([original], {
    bandId: 'a', status: 'needs_review', candidates: original.musicbrainz.spotify.reviewCandidates,
  }, { action: 'reject' }, { reviewedAt: '2026-08-06T00:00:00.000Z' });
  assert.equal(result.kind, 'updated');
  assert.equal(result.bands[0].musicbrainz.spotify.status, 'manual_rejected');
  assert.deepEqual(result.bands[0].musicbrainz.spotify.rejectedCandidateIds, ['one', 'two']);
  assert.equal(result.bands[0].musicbrainz.spotify.reviewCandidates.length, 2);
  assert.equal(result.bands[0].musicbrainz.spotify.unknownSpotifyField, 'keep');
});

test('stale review cannot recreate a deleted band or replace a newer manual decision', () => {
  const deleted = review.applySpotifyReviewDecision([], { bandId: 'gone', status: 'needs_review', candidates: [] }, { action: 'reject' });
  assert.equal(deleted.kind, 'missing_band');
  assert.deepEqual(deleted.bands, []);

  const latest = band('a', 'Alpha', { id: 'new-manual', status: 'manual_confirmed', reviewedAt: '2026-08-06T01:00:00.000Z' });
  const stale = review.applySpotifyReviewDecision([latest], {
    bandId: 'a', status: 'needs_review', candidates: [{ id: 'old', artistName: 'Old' }],
  }, { action: 'confirm', candidateId: 'old' });
  assert.equal(stale.kind, 'newer_manual_decision');
  assert.equal(stale.bands[0].musicbrainz.spotify.id, 'new-manual');
});

test('stale review cannot confirm a candidate removed from the latest provider record', () => {
  const latest = band('a', 'Alpha', {
    status: 'needs_review',
    reviewCandidates: [{ id: 'replacement', artistName: 'Replacement' }],
  });
  const stale = review.applySpotifyReviewDecision([latest], {
    bandId: 'a', status: 'needs_review', candidates: [{ id: 'removed', artistName: 'Removed' }],
  }, { action: 'confirm', candidateId: 'removed' });
  assert.equal(stale.kind, 'candidate_missing');
  assert.equal(stale.bands[0].musicbrainz.spotify.status, 'needs_review');
  assert.equal(stale.bands[0].musicbrainz.spotify.reviewCandidates[0].id, 'replacement');
});
