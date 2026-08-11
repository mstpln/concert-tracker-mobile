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

async function setupConnectedSpotify(page) {
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
}

test('v103 accepts relinked artwork metadata while preserving trusted identity and shows simpler progress', async ({ page }) => {
  await setupConnectedSpotify(page);
  await page.goto('/');
  await page.evaluate(() => {
    const qaFetch = window.fetch;
    window.__v103SpotifyRequests = [];
    window.fetch = async (input, options = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.origin === 'https://api.spotify.com' && url.pathname === '/v1/tracks') {
        throw new Error('Removed Spotify batch endpoint must not be called');
      }
      if (url.origin === 'https://api.spotify.com' && url.pathname === '/v1/tracks/V103TrustedTrack123') {
        window.__v103SpotifyRequests.push({
          path: url.pathname,
          market: url.searchParams.get('market'),
          authorization: new Headers(options.headers || {}).get('Authorization'),
        });
        return new Response(JSON.stringify({
          id: 'V103RelinkedTrack789',
          external_urls: { spotify: 'https://open.spotify.com/track/V103RelinkedTrack789' },
          album: {
            id: 'V103ExactAlbum456',
            external_urls: { spotify: 'https://open.spotify.com/album/V103ExactAlbum456' },
            images: [{ url: 'https://fixtures.livevault.test/images/v103-cover.jpg', width: 640 }],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.origin === 'https://qa.invalid' && url.pathname === '/listening/spotify-metadata.json') {
        if ((options.method || 'GET').toUpperCase() === 'PUT') {
          return new Response('{}', { status: 200, headers: { etag: '"v103-saved"' } });
        }
        return new Response('', { status: 404 });
      }
      return qaFetch(input, options);
    };

    listeningEvents = [{
      id: 'v103-relinked-listen',
      listenedAtMs: Date.now(),
      listenedDurationMs: 180000,
      recordingTitle: 'V103 Relinked Track',
      artistCreditName: 'Synthetic Artist',
      releaseTitle: 'V103 Relinked Synthetic Album',
      spotifyTrackId: 'V103TrustedTrack123',
    }];
  });

  await page.locator('#settings-btn').click();
  await page.getByRole('tab', { name: 'Data' }).click();
  const spotifyPlaylistCard = page.locator('.settings-card').filter({
    has: page.getByText('Connected to Spotify', { exact: true }),
  });
  await expect(spotifyPlaylistCard.getByRole('button', { name: 'Disconnect' })).toBeVisible();
  await expect(page.locator('[data-v99-spotify-listening-metadata] .settings-hint').first()).toContainText('Up to 100 tracks');

  const artworkButton = page.getByRole('button', { name: 'Fetch listening artwork' });
  await artworkButton.click();
  const status = page.locator('[data-v99-enrich-status]');
  await expect(status).toContainText('Done. 1 of 1 checked in this run');
  await expect(status).toContainText('1 artwork records added this time');
  await expect(status).toContainText('1 cached in total');
  await expect(spotifyPlaylistCard.getByRole('button', { name: 'Disconnect' })).toBeVisible();

  const requests = await page.evaluate(() => window.__v103SpotifyRequests);
  expect(requests).toEqual([{
    path: '/v1/tracks/V103TrustedTrack123',
    market: 'SE',
    authorization: 'Bearer synthetic-access-token',
  }]);

  const stored = await page.evaluate(async () => SpotifyListeningMetadataV99.loadLocal());
  expect(stored.records.V103TrustedTrack123).toMatchObject({
    spotifyTrackId: 'V103TrustedTrack123',
    spotifyTrackUrl: 'https://open.spotify.com/track/V103TrustedTrack123',
    spotifyAlbumUrl: 'https://open.spotify.com/album/V103ExactAlbum456',
    artworkUrl: 'https://fixtures.livevault.test/images/v103-cover.jpg',
    spotifyProviderResolvedTrackId: 'V103RelinkedTrack789',
    spotifyProviderRelinked: true,
  });
  expect(stored.records.V103RelinkedTrack789).toBeUndefined();
});

test('v103 explains Development Mode quota exhaustion without suggesting reconnect', async ({ page }) => {
  await setupConnectedSpotify(page);
  await page.goto('/');
  await page.evaluate(() => {
    const qaFetch = window.fetch;
    window.fetch = async (input, options = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.origin === 'https://api.spotify.com' && url.pathname === '/v1/tracks/V103QuotaTrack123') {
        return new Response(JSON.stringify({
          error: { status: 429, message: 'Too many requests', reason: 'QUOTA_EXCEEDED' },
        }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '30' } });
      }
      if (url.origin === 'https://qa.invalid' && url.pathname === '/listening/spotify-metadata.json') {
        return new Response('', { status: 404 });
      }
      return qaFetch(input, options);
    };
    listeningEvents = [{
      id: 'v103-quota-listen',
      listenedAtMs: Date.now(),
      listenedDurationMs: 180000,
      recordingTitle: 'V103 Quota Track',
      artistCreditName: 'Synthetic Artist',
      releaseTitle: 'V103 Quota Synthetic Album',
      spotifyTrackId: 'V103QuotaTrack123',
    }];
  });

  await page.locator('#settings-btn').click();
  await page.getByRole('tab', { name: 'Data' }).click();
  await page.getByRole('button', { name: 'Fetch listening artwork' }).click();
  const status = page.locator('[data-v99-enrich-status]');
  await expect(status).toContainText('Spotify has reached its Development Mode quota');
  await expect(status).toContainText('Try again later');
  await expect(status).toContainText('Reconnecting Spotify will not help');
});
