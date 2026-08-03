const { test, expect } = require('@playwright/test');

const DAY_LABEL = /^(?:\d{1,2} [A-Z][a-z]{2}|[A-Z][a-z]{2} \d{1,2})$/;

test('v83 uses daily two-week chart buckets and one fixed labelled yearly axis', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto('/');

  await expect(page.locator('#start-version-refresh')).toContainText('v83');
  await page.getByRole('button', { name: 'View all' }).first().click();
  await page.getByRole('button', { name: '2 weeks' }).click();
  await page.locator('.full-top-bands-card .top-band-row').first().click();
  const profile = page.locator('#screen-profile');
  await profile.getByRole('button', { name: '2 weeks' }).click();

  const bucketContract = await page.evaluate(() => {
    const values = ListeningStats.selectedStats(listeningEvents, bands, 'twoWeeks', listeningNow()).buckets;
    return {
      count: values.length,
      labels: values.map((item) => item.label),
      listenCount: values.reduce((sum, item) => sum + (item.listenCount || 0), 0),
    };
  });
  expect(bucketContract.count).toBeGreaterThanOrEqual(14);
  expect(bucketContract.count).toBeLessThanOrEqual(15);
  expect(bucketContract.labels.every((label) => DAY_LABEL.test(label))).toBe(true);
  expect(bucketContract.labels.some((label) => /^20\d{2}$/.test(label))).toBe(false);
  expect(bucketContract.listenCount).toBeGreaterThan(0);

  await page.locator('[data-tab="stats"]').click();
  const yearly = page.locator('.yearly-line-chart');
  await expect(yearly).toBeVisible();
  await expect(yearly.locator('text', { hasText: 'Listening hours' })).toHaveCount(1);
  const initialMax = await yearly.getAttribute('data-v83-y-axis-max');
  expect(Number(initialMax)).toBeGreaterThan(0);

  const older = page.getByRole('button', { name: 'Show older listening years' });
  if (await older.isEnabled()) await older.click();
  await expect(page.locator('.yearly-line-chart')).toHaveAttribute('data-v83-y-axis-max', initialMax);
  await expect(page.locator('.yearly-line-chart')).toHaveAttribute('data-v83-y-axis-genre', 'All');

  const yTickTexts = await page.locator('.yearly-line-chart > text').allTextContents();
  expect(yTickTexts.some((value) => value.trim() === '0')).toBe(true);
  expect(browserErrors).toEqual([]);
});
