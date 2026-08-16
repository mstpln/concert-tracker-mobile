'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spotifyIdentity, spotifyReviewCandidates } = require('../scripts/lib/spotify');

const NOW = '2026-08-14T06:00:00.000Z';

function candidate(overrides = {}) {
  return {
    id: 'spotify-artist-1',
    name: 'Synthetic Artist',
    external_urls: { spotify: 'https://open.spotify.com/artist/spotify-artist-1' },
    images: [
      { url: 'https://images.example/artist-640.jpg', width: 640, height: 640, futureImageField: 'keep' },
      { url: 'https://images.example/artist-320.jpg', width: 320, height: 320 },
    ],
    ...overrides,
  };
}

test('confirmed Spotify artist identity defers search-result artwork to exact-id maintenance', () => {
  const source = candidate();
  const identity = spotifyIdentity({}, source, NOW);

  assert.equal(identity.status, 'confirmed');
  assert.equal(identity.id, source.id);
  assert.deepEqual(identity.images, []);
});

test('review candidates retain artwork metadata without becoming trusted identities', () => {
  const source = candidate();
  const [review] = spotifyReviewCandidates([source]);

  assert.equal(review.id, source.id);
  assert.equal(review.artistName, source.name);
  assert.deepEqual(review.images, source.images);
  assert.equal(Object.prototype.hasOwnProperty.call(review, 'status'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(review, 'confidence'), false);
});

test('missing image metadata serializes as an empty provider image list', () => {
  assert.deepEqual(spotifyIdentity({}, candidate({ images: undefined }), NOW).images, []);
  assert.deepEqual(spotifyReviewCandidates([candidate({ images: undefined })])[0].images, []);
});
