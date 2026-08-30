const { test, expect } = require('@playwright/test');

function viewportFor(testInfo) {
  return testInfo.project.name === 'mobile-chromium'
    ? { width: 375, height: 820 }
    : { width: 480, height: 900 };
}

async function openApp(page, testInfo) {
  await page.setViewportSize(viewportFor(testInfo));
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}

test('v173 reorders only the existing bottom navigation destinations', async ({ page }, testInfo) => {
  await openApp(page, testInfo);

  const tabs = page.locator('#tabbar .tabitem');
  await expect(tabs).toHaveCount(5);

  const order = await tabs.evaluateAll((items) => items.map((item) => ({
    tab: item.dataset.tab,
    label: item.textContent.trim(),
  })));
  expect(order).toEqual([
    { tab: 'myconcerts', label: 'Music' },
    { tab: 'mybands', label: 'Bands' },
    { tab: 'concerts', label: 'Discover' },
    { tab: 'stats', label: 'Stats' },
    { tab: 'news', label: 'Alerts' },
  ]);

  await page.locator('#tabbar [data-tab="mybands"]').click();
  await expect(page.locator('#screen-mybands')).toBeVisible();
  await expect(page.locator('#tabbar [data-tab="mybands"]')).toHaveClass(/active/);

  await page.locator('#tabbar [data-tab="concerts"]').click();
  await expect(page.locator('#screen-concerts')).toBeVisible();
  await expect(page.locator('#tabbar [data-tab="concerts"]')).toHaveClass(/active/);

  await page.locator('#tabbar [data-tab="stats"]').click();
  await expect(page.locator('#screen-stats')).toBeVisible();

  await page.locator('#tabbar [data-tab="news"]').click();
  await expect(page.locator('#screen-news')).toBeVisible();
  await expect(page.locator('#news-unread-dot')).toHaveCount(1);

  await page.locator('#tabbar [data-tab="myconcerts"]').click();
  await expect(page.locator('#screen-myconcerts')).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
