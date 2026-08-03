const { test, expect } = require('@playwright/test');

test('v81 listening insights are usable at mobile and desktop widths', async ({ page }, testInfo) => {
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium' ? { width: 375, height: 820 } : { width: 480, height: 900 });
  await page.goto('/');
  await expect(page.locator('.start-top-bands-card')).toContainText('YOUR TOP BANDS · 2 WEEKS');
  await expect(page.locator('#start-version-refresh')).toContainText('v81');
  await expect(page.getByRole('button', { name: 'Check for app update and reload' })).toBeVisible();
  await page.getByRole('button', { name: 'See your listening stats' }).click();
  await expect(page.locator('.listening-summary-global .listening-summary-metric')).toHaveCount(3);
  await expect(page.locator('.yearly-listening-card')).toContainText('LISTENING HOURS BY YEAR');
  await expect(page.locator('.genre-card')).toContainText('LISTENING BY GENRE (ALL TIME)');
  await expect(page.locator('.year-genre-pill')).toHaveCount(6);
  await page.getByRole('button', { name: 'View full top 100' }).click();
  await expect(page.getByRole('button', { name: '2 weeks' })).toBeVisible();
  await expect(page.getByRole('button', { name: '3 months' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.full-top-bands-card .top-band-row').first().click();
  await expect(page.getByRole('tab', { name: 'Listening', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: '1 year' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('tab', { name: 'Top Tracks' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Top Albums' }).click();
  await expect(page.getByRole('tab', { name: 'Top Albums' })).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
