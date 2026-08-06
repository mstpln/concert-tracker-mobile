const { test, expect } = require('@playwright/test');

test('v96 Toplist switches bands and tracks across all shared timeframes', async ({ page }, testInfo) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium'
    ? { width: 375, height: 820 }
    : { width: 480, height: 900 });
  await page.goto('/');

  await page.getByRole('button', { name: 'View all' }).first().click();
  await expect(page.locator('#header-title')).toHaveText('Toplist');
  await expect(page.getByRole('tab', { name: 'Top Bands' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: '3 months' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('tab', { name: 'Top Tracks' }).click();
  await expect(page.getByRole('tab', { name: 'Top Tracks' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.toplist-track-row').first()).toContainText('#1');
  await expect(page.locator('.toplist-track-row').first()).toContainText(/listens/i);

  for (const timeframe of ['2 weeks', '1 year', 'All time']) {
    await page.getByRole('button', { name: timeframe }).click();
    await expect(page.getByRole('button', { name: timeframe })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.toplist-track-row').first()).toBeVisible();
  }
  await expect(page.locator('.toplist-track-row .rank-movement')).toHaveCount(0);

  await page.getByRole('button', { name: '1 year' }).click();
  await page.getByRole('tab', { name: 'Top Bands' }).click();
  await expect(page.getByRole('tab', { name: 'Top Bands' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: '1 year' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.full-top-bands-card .top-band-row').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Top Tracks' }).click();
  await expect(page.getByRole('button', { name: '1 year' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.toplist-track-row').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(browserErrors).toEqual([]);

  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-v96-toplist.png`), fullPage: true });
});
