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

test('v102 accepts relinked artwork metadata through the supported single-track endpoint while preserving trusted identity', async ({ page }) => {
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
  await page.evaluate(() => {
    const qaFetch = window.fetch;
    window.__v102SpotifyRequests = [];
    window.fetch = async (input, options = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.origin === 'https://api.spotify.com' && url.pathname === '/v1/tracks') {
        throw new Error('Removed Spotify batch endpoint must not be called');
      }
      if (url.origin === 'https://api.spotify.com' && url.pathname === '/v1/tracks/V102TrustedTrack123') {
        window.__v102SpotifyRequests.push({
          path: url.pathname,
          market: url.searchParams.get('market'),
          authorization: new Headers(options.headers || {}).get('Authorization'),
        });
        return new Response(JSON.stringify({
          id: 'V102RelinkedTrack789',
          external_urls: { spotify: 'https://open.spotify.com/track/V102RelinkedTrack789' },
          album: {
            id: 'V102ExactAlbum456',
            external_urls: { spotify: 'https://open.spotify.com/album/V102ExactAlbum456' },
            images: [{ url: 'https://fixtures.livevault.test/images/v102-cover.jpg', width: 640 }],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.origin === 'https://qa.invalid' && url.pathname === '/listening/spotify-metadata.json') {
        if ((options.method || 'GET').toUpperCase() === 'PUT') {
          return new Response('{}', { status: 200, headers: { etag: '"v102-saved"' } });
        }
        return new Response('', { status: 404 });
      }
      return qaFetch(input, options);
    };

    listeningEvents = [{
      id: 'v102-relinked-listen',
      listenedAtMs: Date.now(),
      listenedDurationMs: 180000,
      recordingTitle: 'V102 Relinked Track',
      artistCreditName: 'Synthetic Artist',
      spotifyTrackId: 'V102TrustedTrack123',
    }];
  });

  await page.locator('#settings-btn').click();
  await page.getByRole('tab', { name: 'Data' }).click();
  const spotifyPlaylistCard = page.locator('.settings-card').filter({
    has: page.getByText('Connected to Spotify', { exact: true }),
  });
  await expect(spotifyPlaylistCard.getByRole('button', { name: 'Disconnect' })).toBeVisible();
  await expect(page.locator('[data-v99-spotify-listening-metadata] .settings-hint').first()).toContainText('Up to 500 tracks');

  const artworkButton = page.getByRole('button', { name: 'Fetch listening artwork' });
  await artworkButton.click();
  await expect(page.locator('[data-v99-enrich-status]')).toContainText('1 exact Spotify records added');
  await expect(spotifyPlaylistCard.getByRole('button', { name: 'Disconnect' })).toBeVisible();

  const requests = await page.evaluate(() => window.__v102SpotifyRequests);
  expect(requests).toEqual([{
    path: '/v1/tracks/V102TrustedTrack123',
    market: 'SE',
    authorization: 'Bearer synthetic-access-token',
  }]);

  const stored = await page.evaluate(async () => SpotifyListeningMetadataV99.loadLocal());
  expect(stored.records.V102TrustedTrack123).toMatchObject({
    spotifyTrackId: 'V102TrustedTrack123',
    spotifyTrackUrl: 'https://open.spotify.com/track/V102TrustedTrack123',
    spotifyAlbumUrl: 'https://open.spotify.com/album/V102ExactAlbum456',
    artworkUrl: 'https://fixtures.livevault.test/images/v102-cover.jpg',
    spotifyProviderResolvedTrackId: 'V102RelinkedTrack789',
    spotifyProviderRelinked: true,
  });
  expect(stored.records.V102RelinkedTrack789).toBeUndefined();
});
