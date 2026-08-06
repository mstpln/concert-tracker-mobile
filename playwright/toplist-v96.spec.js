const { test, expect } = require('@playwright/test');

test('v97 Toplist keeps tabs and dynamic timeframe headings inside ranking cards', async ({ page }, testInfo) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium'
    ? { width: 375, height: 820 }
    : { width: 480, height: 900 });
  await page.goto('/');

  await page.getByRole('button', { name: 'See your listening stats' }).click();
  const preview = page.locator('.top-bands-card.toplist-card');
  await expect(preview.getByRole('tab', { name: 'Top Bands' })).toHaveAttribute('aria-selected', 'true');
  await expect(preview.locator('#stats-toplist-title')).toHaveText('TOP BANDS · 3 MONTHS');
  await expect(preview.locator('.top-band-row')).toHaveCount(7);
  await preview.getByRole('tab', { name: 'Top Tracks' }).click();
  await expect(page.locator('.top-bands-card.toplist-card #stats-toplist-title')).toHaveText('TOP TRACKS · 3 MONTHS');
  await expect(page.locator('.top-bands-card.toplist-card .toplist-track-row')).toHaveCount(7);
  await page.locator('.top-bands-card.toplist-card').getByRole('button', { name: 'View all' }).click();

  await expect(page.locator('#header-title')).toHaveText('Toplist');
  const fullCard = page.locator('.full-top-bands-card.toplist-card');
  await expect(fullCard.getByRole('tab', { name: 'Top Tracks' })).toHaveAttribute('aria-selected', 'true');
  await expect(fullCard.locator('#toplist-title')).toHaveText('TOP TRACKS · 3 MONTHS');
  await expect(fullCard.locator('.toplist-tabs')).toBeVisible();

  const hierarchy = await fullCard.evaluate((card) => {
    const tabs = card.querySelector('.toplist-tabs');
    const heading = card.querySelector('.listening-card-heading');
    const list = card.querySelector('.top-bands-list, .toplist-track-list');
    return {
      tabsInsideCard: !!tabs && tabs.parentElement === card,
      headingAfterTabs: !!tabs && !!heading && tabs.nextElementSibling === heading,
      listAfterHeading: !!heading && !!list && heading.nextElementSibling === list,
    };
  });
  expect(hierarchy).toEqual({ tabsInsideCard: true, headingAfterTabs: true, listAfterHeading: true });

  await page.getByRole('button', { name: '1 year' }).click();
  await expect(fullCard.locator('#toplist-title')).toHaveText('TOP TRACKS · 1 YEAR');
  await fullCard.getByRole('tab', { name: 'Top Bands' }).click();
  await expect(fullCard.locator('#toplist-title')).toHaveText('TOP BANDS · 1 YEAR');
  await fullCard.getByRole('tab', { name: 'Top Tracks' }).click();
  await page.getByRole('button', { name: 'All time' }).click();
  await expect(fullCard.locator('#toplist-title')).toHaveText('TOP TRACKS · ALL TIME');
  await expect(fullCard.locator('.toplist-track-row .rank-movement')).toHaveCount(0);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(browserErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-v97-toplist-card-layout.png`), fullPage: true });
});
