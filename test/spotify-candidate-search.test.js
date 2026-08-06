'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const search = require('../scripts/lib/spotifyCandidateSearch');

function usage(limit = 10) {
  let calls = 0;
  return {
    canCallSpotify() { return calls < limit; },
    async recordSpotifyCall() { calls += 1; },
    calls() { return calls; },
  };
}

function response(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return payload; },
  };
}

test('artist candidate search keeps only exact accepted names and full provider metadata', async () => {
  const tracker = usage();
  const fetchImpl = async () => response(200, {
    artists: {
      items: [
        {
          id: 'spotify-2',
          name: 'Synthetic Artist',
          external_urls: { spotify: 'https://open.spotify.com/artist/spotify-2' },
          genres: ['synthetic rock'],
          images: [{ url: 'https://images.example/2.jpg', width: 640, height: 640 }],
          followers: { total: 200 },
          popularity: 60,
          future_provider_field: { preserve: true },
        },
        {
          id: 'spotify-1',
          name: 'The Synthetic Artist',
          external_urls: { spotify: 'https://open.spotify.com/artist/spotify-1' },
          genres: ['synthetic metal'],
          images: [],
          followers: { total: 500 },
          popularity: 70,
        },
        { id: 'wrong-name', name: 'Synthetic Artists' },
        { id: 'tribute', name: 'Synthetic Artist Tribute' },
      ],
    },
  });

  const result = await search.searchArtistCandidates({
    band: { name: 'Synthetic Artist' },
    metadata: { artistName: 'Synthetic Artist', aliases: ['The Synthetic Artist'] },
    usage: tracker,
    tokenProvider: async () => 'synthetic-token',
    fetchImpl,
  });

  assert.equal(result.kind, 'ok');
  assert.deepEqual(result.candidates.map((candidate) => candidate.id), ['spotify-1', 'spotify-2']);
  assert.equal(result.candidates[0].followers, 500);
  assert.deepEqual(result.candidates[1].genres, ['synthetic rock']);
  assert.equal(result.candidates[1].images[0].url, 'https://images.example/2.jpg');
  assert.deepEqual(result.candidates[1].future_provider_field, { preserve: true });
  assert.equal(tracker.calls(), 1);
});

test('candidate search fails closed on ambiguous text and impersonators', async () => {
  const tracker = usage();
  const result = await search.searchArtistCandidates({
    band: { name: 'Synthetic Artist' },
    metadata: { aliases: [] },
    usage: tracker,
    tokenProvider: async () => 'synthetic-token',
    fetchImpl: async () => response(200, {
      artists: { items: [
        { id: 'near', name: 'Synthetic Artists' },
        { id: 'cover', name: 'Synthetic Artist', description: 'cover experience' },
      ] },
    }),
  });
  assert.equal(result.kind, 'no_match');
  assert.deepEqual(result.candidates, []);
});

test('candidate search has no hidden retry on provider errors', async () => {
  const tracker = usage();
  let requests = 0;
  const result = await search.searchArtistCandidates({
    band: { name: 'Synthetic Artist' },
    metadata: {},
    usage: tracker,
    tokenProvider: async () => 'synthetic-token',
    fetchImpl: async () => { requests += 1; return response(429, {}); },
  });
  assert.equal(result.kind, 'error');
  assert.equal(result.status, 429);
  assert.equal(requests, 1);
  assert.equal(tracker.calls(), 1);
});

test('candidate search stops before a request when the Spotify cap is exhausted', async () => {
  const tracker = usage(0);
  let requests = 0;
  const result = await search.searchArtistCandidates({
    band: { name: 'Synthetic Artist' },
    metadata: {},
    usage: tracker,
    tokenProvider: async () => 'synthetic-token',
    fetchImpl: async () => { requests += 1; return response(200, {}); },
  });
  assert.equal(result.kind, 'skipped');
  assert.equal(requests, 0);
});
