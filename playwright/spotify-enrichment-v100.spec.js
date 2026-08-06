const { test, expect } = require('@playwright/test');

const LEGACY_SPOTIFY_USER = `'use strict';
(function () {
  const TOKEN_KEY = 'spotifyUserAuthorization';
  const getAuth = async () => (await chrome.storage.local.get(TOKEN_KEY))[TOKEN_KEY] || null;
  const setAuth = async (auth) => chrome.storage.local.set({ [TOKEN_KEY]: auth });
  const clearAuth = async () => chrome.storage.local.remove(TOKEN_KEY);
  const refresh = async (auth) => auth;
  const request = async () => { throw new Error('legacy private request should not be called directly'); };
  window.SpotifyUser = { TOKEN_KEY, getAuth, setAuth, clearAuth, refresh };
})();`;

test('v100 reuses the authorization shown as connected when fetching listening artwork', async ({ page }) => {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await page.addInitScript(({ expiresAt }) => {
    localStorage.setItem('concertTrackerSettings', JSON.stringify({
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
  await page.route('https://api.spotify.com/v1/tracks?**', async (route) => {
    expect(route.request().headers().authorization).toBe('Bearer synthetic-access-token');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tracks: [{
          id: 'V100ExactTrack123',
          external_urls: { spotify: 'https://open.spotify.com/track/V100ExactTrack123' },
          album: {
            id: 'V100ExactAlbum456',
            external_urls: { spotify: 'https://open.spotify.com/album/V100ExactAlbum456' },
            images: [{ url: 'https://fixtures.livevault.test/images/v100-cover.jpg', width: 640 }],
          },
        }],
      }),
    });
  });
  await page.route('**/listening/spotify-metadata.json', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 200, headers: { etag: '"v100-saved"' }, body: '{}' });
      return;
    }
    await route.fulfill({ status: 404, body: '' });
  });

  await page.goto('/');
  await page.evaluate(() => {
    listeningEvents = [{
      id: 'v100-exact-listen',
      listenedAtMs: Date.now(),
      listenedDurationMs: 180000,
      recordingTitle: 'V100 Exact Track',
      artistCreditName: 'Synthetic Artist',
      spotifyTrackId: 'V100ExactTrack123',
    }];
  });

  await page.locator('#settings-btn').click();
  await expect(page.getByRole('button', { name: 'Disconnect' })).toBeVisible();
  const artworkButton = page.getByRole('button', { name: 'Fetch listening artwork' });
  await expect(artworkButton).toBeVisible();
  await artworkButton.click();
  await expect(page.locator('[data-v99-enrich-status]')).toContainText('1 exact Spotify records added');
  await expect(page.getByRole('button', { name: 'Disconnect' })).toBeVisible();

  const stored = await page.evaluate(async () => SpotifyListeningMetadataV99.loadLocal());
  expect(stored.records.V100ExactTrack123).toMatchObject({
    spotifyTrackUrl: 'https://open.spotify.com/track/V100ExactTrack123',
    spotifyAlbumUrl: 'https://open.spotify.com/album/V100ExactAlbum456',
    artworkUrl: 'https://fixtures.livevault.test/images/v100-cover.jpg',
  });
});
