const { test, expect } = require('@playwright/test');

test('v99 shows exact Spotify links and identity-backed artwork across listening rankings', async ({ page }, testInfo) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium'
    ? { width: 375, height: 820 }
    : { width: 480, height: 900 });
  await page.goto('/');

  await page.getByRole('button', { name: 'See your listening stats' }).click();
  const preview = page.locator('.top-bands-card.toplist-card');
  await preview.getByRole('tab', { name: 'Top Tracks' }).click();

  const previewRows = preview.locator('.toplist-track-row');
  await expect(previewRows).toHaveCount(7);
  const previewLink = previewRows.first().locator('.trusted-listening-link');
  await expect(previewLink).toHaveAttribute('href', /^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]+$/);
  await expect(previewRows.first().locator('.track-artwork img')).toBeVisible();
  await expect(previewRows.first().locator('.trusted-listening-artist')).toBeVisible();

  await preview.getByRole('button', { name: 'View all' }).click();
  const full = page.locator('.full-top-bands-card.toplist-card');
  await expect(full.getByRole('tab', { name: 'Top Tracks' })).toHaveAttribute('aria-selected', 'true');
  const fullRow = full.locator('.toplist-track-row').first();
  await expect(fullRow.locator('.trusted-listening-link')).toHaveAttribute('href', /^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]+$/);
  await expect(fullRow.locator('.track-artwork img')).toBeVisible();

  await fullRow.locator('.trusted-listening-artist').click();
  const profile = page.locator('#screen-profile');
  await expect(profile.getByRole('tab', { name: 'Listening', exact: true })).toHaveAttribute('aria-selected', 'true');

  const trackCard = profile.locator('.top-tracks-card');
  const trackRow = trackCard.locator('.top-track-row').first();
  await expect(trackRow.locator('.trusted-listening-link')).toHaveAttribute('href', /^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]+$/);
  await expect(trackRow.locator('.track-artwork img')).toBeVisible();

  await trackCard.getByRole('tab', { name: 'Top Albums' }).click();
  const albumRow = profile.locator('.top-tracks-card .top-track-row').first();
  await expect(albumRow.locator('.trusted-listening-link')).toHaveAttribute('href', /^https:\/\/open\.spotify\.com\/album\/[A-Za-z0-9]+$/);
  await expect(albumRow.locator('.track-artwork img')).toBeVisible();

  const unresolved = await page.evaluate(() => {
    const api = window.TrustedListeningV99;
    const row = api.aggregate([
      {
        id: 'synthetic-unresolved-one',
        listenedAtMs: Date.now() - 1000,
        listenedDurationMs: 180000,
        recordingTitle: 'Unresolved Synthetic Track',
        artistCreditName: 'Synthetic Artist',
      },
    ], 'track', 10)[0];
    return {
      link: row.spotifyTrackUrl,
      artwork: row.artworkPath,
      trusted: row.trustedSpotifyIdentity,
    };
  });
  expect(unresolved).toEqual({ link: null, artwork: null, trusted: false });

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(browserErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-v99-trusted-listening.png`), fullPage: true });
});
