'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadCompat(spotify) {
  global.SpotifyUser = spotify;
  delete require.cache[require.resolve('../spotifyUserV100.js')];
  return require('../spotifyUserV100.js');
}

test('adds request support to an existing saved Spotify connection', async () => {
  const spotify = loadCompat({
    getAuth: async () => ({
      clientId: 'client', accessToken: 'token', refreshToken: 'refresh',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    }),
    refresh: async () => { throw new Error('refresh should not run'); },
    clearAuth: async () => {},
  });
  const calls = [];
  const response = await spotify.request('/tracks?ids=TrackABC123', {}, async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200 };
  });
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, 'https://api.spotify.com/v1/tracks?ids=TrackABC123');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token');
});

test('refreshes an expired saved connection before requesting metadata', async () => {
  let refreshed = 0;
  const spotify = loadCompat({
    getAuth: async () => ({
      clientId: 'client', accessToken: 'old', refreshToken: 'refresh',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    }),
    refresh: async () => {
      refreshed += 1;
      return {
        clientId: 'client', accessToken: 'new', refreshToken: 'refresh',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
    },
    clearAuth: async () => {},
  });
  await spotify.request('/tracks?ids=TrackABC123', {}, async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer new');
    return { ok: true, status: 200 };
  });
  assert.equal(refreshed, 1);
});

test('does not overwrite the current Spotify request implementation', () => {
  const existing = async () => 'existing';
  const spotify = loadCompat({ request: existing });
  assert.equal(spotify.request, existing);
});
