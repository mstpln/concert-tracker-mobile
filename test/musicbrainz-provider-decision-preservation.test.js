'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { identityResult, reviewedProviderDecisions } = require('../scripts/lib/musicbrainz');

const spotifyRejected = {
  id: null,
  url: null,
  artistName: null,
  status: 'manual_rejected',
  matchMethod: 'user_review',
  confidence: null,
  errorCategory: 'known_merged_spotify_profile',
  reviewCandidates: [],
};

const ticketmasterConfirmed = {
  id: 'tm-1',
  attractionName: 'Example',
  status: 'manual_confirmed',
  matchMethod: 'user_review',
};

test('reviewedProviderDecisions keeps only nested manual provider decisions', () => {
  const prior = {
    status: 'pending',
    spotify: spotifyRejected,
    ticketmaster: ticketmasterConfirmed,
    metadata: { status: 'complete', artistName: 'stale metadata' },
    futureProvider: { status: 'manual_rejected', reason: 'user decision' },
    automatedProvider: { status: 'confirmed', id: 'auto' },
  };
  assert.deepEqual(reviewedProviderDecisions(prior), {
    spotify: spotifyRejected,
    ticketmaster: ticketmasterConfirmed,
    futureProvider: prior.futureProvider,
  });
});

test('automatic MusicBrainz confirmation preserves a reviewed Spotify rejection', () => {
  const band = { id: 'dollface', name: 'Dollface', musicbrainz: { status: 'pending', spotify: spotifyRejected } };
  const result = identityResult(band, {
    kind: 'ok',
    automatic: {
      mbid: 'mbid-dollface', artistName: 'Dollface', area: 'Sweden', country: 'SE',
      artistType: 'Group', disambiguation: 'Swedish rock band', score: 95,
    },
    candidates: [],
  }, '2026-08-15T12:00:00.000Z');

  assert.equal(result.status, 'auto_confirmed');
  assert.equal(result.mbid, 'mbid-dollface');
  assert.deepEqual(result.spotify, spotifyRejected);
});

test('no-match and needs-review MusicBrainz outcomes preserve reviewed provider decisions', () => {
  const band = {
    id: 'example',
    name: 'Example',
    musicbrainz: { status: 'pending', spotify: spotifyRejected, ticketmaster: ticketmasterConfirmed },
  };

  const noMatch = identityResult(band, { kind: 'ok', automatic: null, candidates: [] }, '2026-08-15T12:00:00.000Z');
  assert.equal(noMatch.status, 'no_match');
  assert.deepEqual(noMatch.spotify, spotifyRejected);
  assert.deepEqual(noMatch.ticketmaster, ticketmasterConfirmed);

  const review = identityResult(band, {
    kind: 'ok', automatic: null, candidates: [{ mbid: 'candidate', artistName: 'Example', score: 80 }],
  }, '2026-08-15T12:00:00.000Z');
  assert.equal(review.status, 'needs_review');
  assert.deepEqual(review.spotify, spotifyRejected);
  assert.deepEqual(review.ticketmaster, ticketmasterConfirmed);
});

test('ordinary automated nested provider state is not carried across a new MusicBrainz identity result', () => {
  const band = {
    id: 'example',
    name: 'Example',
    musicbrainz: {
      status: 'pending',
      spotify: { id: 'old', status: 'confirmed' },
      metadata: { artistName: 'old identity' },
    },
  };
  const result = identityResult(band, { kind: 'ok', automatic: null, candidates: [] }, '2026-08-15T12:00:00.000Z');
  assert.equal(result.spotify, undefined);
  assert.equal(result.metadata, undefined);
});
