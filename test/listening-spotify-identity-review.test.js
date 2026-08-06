'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const identityState = require('../providerIdentityState');
const review = require('../listeningSpotifyIdentityReview');

function band(id, name, spotify) {
  return { id, name, favorite: true, notes: 'preserve', futureField: { keep: true }, musicbrainz: { mbid: `mb-${id}`, status: 'confirmed', ...(spotify ? { spotify } : {}) } };
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
