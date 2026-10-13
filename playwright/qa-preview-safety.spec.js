const { test, expect } = require('@playwright/test');

test('synthetic preview keeps common navigation, state profiles, and storage local', async ({ page }) => {
  const externalRequests = [];
  page.on('request', (request) => {
    if (!new URL(request.url()).origin.startsWith('http://127.0.0.1')) {
      externalRequests.push(request.url());
    }
  });

  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('QA PREVIEW');
  await expect(page.locator('#screen-myconcerts')).toBeVisible();
  await expect(page.getByTestId('bottom-navigation').locator('.tabitem')).toHaveCount(5);
  await expect(page.locator('.start-top-bands-card .top-band-row')).toHaveCount(3);
  await expect(page.locator('#screen-settings')).toBeAttached();

  const databases = await page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name));
  expect(databases.every((name) => name.startsWith('livevault-qa:') || name === 'live-vault-qa-owned-tickets')).toBe(true);

  await page.evaluate(async () => {
    await window.chrome.storage.local.set({
      listenbrainzToken: 'qa-synthetic-listenbrainz-token',
      spotifyUserAuthorization: {
        clientId: 'synthetic-public-client-id',
        accessToken: 'synthetic-access-token',
        refreshToken: 'synthetic-refresh-token',
      },
      spotifyApiSecret: 'real-secret-value',
      externalServiceToken: 'real-token-value',
    });
  });
  const storedSettings = await page.evaluate(() => JSON.parse(localStorage.getItem('livevault-qa:settings')));
  expect(storedSettings.listenbrainzToken).toBe('qa-synthetic-listenbrainz-token');
  expect(storedSettings.spotifyUserAuthorization.accessToken).toBe('synthetic-access-token');
  expect(storedSettings.spotifyApiSecret).toBeUndefined();
  expect(storedSettings.externalServiceToken).toBeUndefined();

  await Promise.all([
    page.waitForNavigation(),
    page.getByTestId('qa-state').selectOption('empty'),
  ]);
  await expect.poll(() => page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('livevault-qa:data'));
    return [data.bands.length, data.concerts.length, data.news.length];
  })).toEqual([0, 0, 0]);

  await Promise.all([
    page.waitForNavigation(),
    page.getByTestId('qa-state').selectOption('error'),
  ]);
  await expect(page.locator('#screen-connection-error')).toBeVisible();

  const guardResult = await page.evaluate(async () => {
    const link = document.createElement('a');
    link.href = 'https://example.com/private';
    document.body.append(link);
    link.click();
    link.remove();
    let blocked = false;
    try { await fetch('https://example.com/private'); } catch (error) { blocked = /QA blocked external request/.test(error.message); }
    return { blocked, href: location.href };
  });
  expect(guardResult.blocked).toBe(true);
  expect(new URL(guardResult.href).origin).toBe('http://127.0.0.1:4173');
  expect(externalRequests).toEqual([]);
});
