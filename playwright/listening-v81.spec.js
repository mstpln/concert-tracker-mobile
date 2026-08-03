const { test, expect } = require('@playwright/test');

async function textContents(locator) {
  return (await locator.allTextContents()).map((value) => value.trim());
}

test('v81 listening insights are usable, independent, and persistent at mobile and desktop widths', async ({ page }, testInfo) => {
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

  const allPill = page.locator('[data-v81-year-genre="All"]');
  const allPillContrast = await allPill.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  });
  expect(allPillContrast.color).not.toBe(allPillContrast.background);

  const ytdLabel = page.locator('.yearly-line-chart text').filter({ hasText: 'YTD' });
  await expect(ytdLabel).toHaveCount(1);
  expect(await ytdLabel.evaluate((element) => {
    const label = element.getBoundingClientRect();
    const chart = element.ownerSVGElement.getBoundingClientRect();
    return label.left >= chart.left - 1 && label.right <= chart.right + 1;
  })).toBe(true);

  const initialGenreYears = await textContents(page.locator('[data-v81-genre-year] > span:last-child'));
  await page.getByRole('button', { name: 'Show older listening years' }).click();
  expect(await textContents(page.locator('[data-v81-genre-year] > span:last-child'))).toEqual(initialGenreYears);
  const shiftedListeningYears = await textContents(page.locator('[data-v81-year-point] text'));
  await page.getByRole('button', { name: 'Show older genre years' }).click();
  expect(await textContents(page.locator('[data-v81-year-point] text'))).toEqual(shiftedListeningYears);

  await page.locator('[data-v81-year-point] circle').first().click();
  await expect(page.locator('.year-detail')).toBeVisible();
  await expect(page.locator('.genre-year-detail')).toHaveCount(0);
  await page.locator('[data-v81-genre-year]').first().click();
  await expect(page.locator('.year-detail')).toBeVisible();
  await expect(page.locator('.genre-year-detail')).toBeVisible();

  await page.getByRole('button', { name: 'View full top 100' }).click();
  await expect(page.getByRole('button', { name: '2 weeks' })).toBeVisible();
  await expect(page.getByRole('button', { name: '3 months' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.full-top-bands-card .top-band-row').first().click();
  const profile = page.locator('#screen-profile');
  await expect(profile.getByRole('tab', { name: 'Listening', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(profile.getByRole('button', { name: '1 year' })).toHaveAttribute('aria-pressed', 'true');
  await expect(profile.getByRole('tab', { name: 'Top Tracks' })).toHaveAttribute('aria-selected', 'true');

  await profile.getByRole('button', { name: '3 months' }).click();
  await profile.getByRole('tab', { name: 'Top Albums' }).click();
  await expect(profile.getByRole('tab', { name: 'Top Albums' })).toHaveAttribute('aria-selected', 'true');
  await profile.getByRole('tab', { name: 'Concerts', exact: true }).click();
  await profile.getByRole('tab', { name: 'Listening', exact: true }).click();
  await expect(profile.getByRole('button', { name: '3 months' })).toHaveAttribute('aria-pressed', 'true');
  await expect(profile.getByRole('tab', { name: 'Top Albums' })).toHaveAttribute('aria-selected', 'true');

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
