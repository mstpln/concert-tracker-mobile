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

test('QA-only card view selector switches countdown and concert-day without changing fixture data', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
  await expect(page.locator('#screen-myconcerts')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-qa-preview', 'true');
  await page.getByRole('tab', { name: 'Concerts' }).click();

  const view = page.getByTestId('qa-concert-view');
  await expect(view).toHaveValue('concert-day');
  await expect(page.locator('#screen-myconcerts .next-concert-banner-v167.is-concert-day')).toHaveCount(1);
  const seededConcertCount = await page.evaluate(() => JSON.parse(localStorage.getItem('livevault-qa:data')).concerts.length);

  await Promise.all([
    page.waitForNavigation(),
    view.selectOption('countdown'),
  ]);
  await page.getByRole('tab', { name: 'Concerts' }).click();
  await expect(page.getByTestId('qa-concert-view')).toHaveValue('countdown');
  await expect(page.locator('#screen-myconcerts .next-concert-banner-v167.next-concert-stage-v182')).toBeVisible();
  await expect(page.locator('#screen-myconcerts .next-concert-banner-v167.is-concert-day')).toHaveCount(0);
  expect(await page.evaluate(() => dlCurrentDate().toISOString())).toBe('2027-07-15T12:00:00.000Z');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('livevault-qa:data')).concerts.length)).toBe(seededConcertCount);

  await Promise.all([
    page.waitForNavigation(),
    page.getByTestId('qa-concert-view').selectOption('concert-day'),
  ]);
  await page.getByRole('tab', { name: 'Concerts' }).click();
  await expect(page.locator('#screen-myconcerts .next-concert-banner-v167.is-concert-day')).toHaveCount(1);
  expect(await page.evaluate(() => dlCurrentDate().toISOString())).toBe('2027-07-16T12:00:00.000Z');
});
