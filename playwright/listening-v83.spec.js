const { test, expect } = require('@playwright/test');

const DAY_LABEL = /^(?:\d{1,2} [A-Z][a-z]{2}|[A-Z][a-z]{2} \d{1,2})$/;

test('v84 renders the selected two-week chart as visible daily points and keeps the yearly axis fixed', async ({ page }, testInfo) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto('/');

  await expect(page.locator('#start-version-refresh')).toContainText('v100');
  await page.getByRole('button', { name: 'View all' }).first().click();
  await page.getByRole('button', { name: '2 weeks' }).click();
  await page.locator('.full-top-bands-card .top-band-row').first().click();
  const profile = page.locator('#screen-profile');
  await profile.getByRole('button', { name: '2 weeks' }).click();

  const chartCard = profile.locator('[data-v84-visible-two-week-chart="true"]');
  await expect(chartCard).toBeVisible();
  await expect(chartCard).toContainText('Most active day:');
  const chart = chartCard.locator('svg[data-listening-chart-timeframe="twoWeeks"]');
  await expect(chart).toHaveAttribute('data-listening-bucket-kind', 'day');
  const pointCount = await chart.locator('[data-listening-point]').count();
  expect(pointCount).toBeGreaterThanOrEqual(14);
  expect(pointCount).toBeLessThanOrEqual(15);
  const declaredCount = Number(await chart.getAttribute('data-listening-bucket-count'));
  expect(declaredCount).toBe(pointCount);
  const labels = (await chart.locator('[data-listening-day-label="true"]').allTextContents()).map((value) => value.trim());
  expect(labels.length).toBeGreaterThanOrEqual(4);
  expect(labels.every((label) => DAY_LABEL.test(label))).toBe(true);
  expect(labels.some((label) => /^20\d{2}$/.test(label))).toBe(false);
  await expect(chart).toHaveAttribute('aria-label', /2 weeks listening chart with (14|15) day periods/i);
  await profile.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-v84-two-week-chart.png`), fullPage: true });

  const twoWeekPoints = await chart.locator('.chart-line').getAttribute('points');
  await profile.getByRole('button', { name: 'All time' }).click();
  const allTimeChart = profile.locator('.listening-chart-card .listening-line-chart');
  await expect(allTimeChart).toBeVisible();
  expect(await allTimeChart.getAttribute('data-listening-chart-timeframe')).not.toBe('twoWeeks');
  expect(await allTimeChart.locator('.chart-line').getAttribute('points')).not.toBe(twoWeekPoints);

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
