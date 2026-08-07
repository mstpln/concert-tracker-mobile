const { test, expect } = require('@playwright/test');

const LEGACY_SPOTIFY_USER = `'use strict';
(function () {
  const TOKEN_KEY = 'spotifyUserAuthorization';
  const getAuth = async () => (await chrome.storage.local.get(TOKEN_KEY))[TOKEN_KEY] || null;
  const setAuth = async (auth) => chrome.storage.local.set({ [TOKEN_KEY]: auth });
  const clearAuth = async () => chrome.storage.local.remove(TOKEN_KEY);
  const refresh = async (auth) => auth;
  const handleCallback = async () => ({ kind: 'none' });
  const beginAuthorization = async () => {};
  const createPrivatePlaylist = async () => ({ playlist: null, added: 0 });
  window.SpotifyUser = {
    TOKEN_KEY,
    getAuth,
    setAuth,
    clearAuth,
    refresh,
    handleCallback,
    beginAuthorization,
    createPrivatePlaylist,
  };
})();`;

test('v100 bridge reuses the authorization shown as connected', async ({ page }) => {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await page.addInitScript(({ expiresAt }) => {
    localStorage.setItem('livevault-qa:settings', JSON.stringify({
      spotifyUserClientId: 'synthetic-public-client-id',
      spotifyUserAuthorization: {
        clientId: 'synthetic-public-client-id',
        accessToken: 'synthetic-access-token',
        refreshToken: 'synthetic-refresh-token',
        expiresAt,
        scope: 'playlist-modify-private',
        tokenType: 'Bearer',
      },
    }));
  }, { expiresAt });

  await page.route('**/spotifyUser.js', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: LEGACY_SPOTIFY_USER });
  });

  await page.goto('/');
  await page.locator('#settings-btn').click();
  await page.getByRole('tab', { name: 'Data' }).click();
  const spotifyPlaylistCard = page.locator('.settings-card').filter({
    has: page.getByText('Connected to Spotify', { exact: true }),
  });
  await expect(spotifyPlaylistCard.getByRole('button', { name: 'Disconnect' })).toBeVisible();

  const bridgeResult = await page.evaluate(async () => {
    if (typeof SpotifyUser.validAuth !== 'function' || typeof SpotifyUser.request !== 'function') {
      return { helpersPresent: false };
    }
    const calls = [];
    const response = await SpotifyUser.request('/tracks/V100BridgeTrack', {}, async (url, options = {}) => {
      calls.push({
        url: String(url),
        authorization: new Headers(options.headers || {}).get('Authorization'),
      });
      return new Response(JSON.stringify({ id: 'V100BridgeTrack' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    return {
      helpersPresent: true,
      ok: response.ok,
      calls,
    };
  });

  expect(bridgeResult).toEqual({
    helpersPresent: true,
    ok: true,
    calls: [{
      url: 'https://api.spotify.com/v1/tracks/V100BridgeTrack',
      authorization: 'Bearer synthetic-access-token',
    }],
  });
  await expect(spotifyPlaylistCard.getByRole('button', { name: 'Disconnect' })).toBeVisible();
});
