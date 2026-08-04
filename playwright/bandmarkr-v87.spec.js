const { test, expect } = require('@playwright/test');

test('v87 renders the approved BANDMARKR banner and PWA identity', async ({ page }, testInfo) => {
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium'
    ? { width: 375, height: 820 }
    : { width: 480, height: 900 });
  await page.goto('/');

  await expect(page).toHaveTitle('BANDMARKR');
  const banner = page.locator('#brand-banner');
  const wordmark = banner.locator('.brand-wordmark');
  await expect(wordmark).toHaveText('BANDMARKR');
  const geometry = await page.evaluate(() => {
    const banner = document.querySelector('#brand-banner').getBoundingClientRect();
    const wordmark = document.querySelector('.brand-wordmark').getBoundingClientRect();
    const style = getComputedStyle(document.querySelector('#brand-banner'));
    return {
      centerDelta: Math.abs((banner.left + banner.width / 2) - (wordmark.left + wordmark.width / 2)),
      background: style.backgroundColor,
      height: banner.height,
      overflow: wordmark.width > banner.width,
    };
  });
  expect(geometry.centerDelta).toBeLessThanOrEqual(1);
  expect(geometry.background).toBe('rgb(2, 77, 223)');
  expect(geometry.height).toBe(60);
  expect(geometry.overflow).toBe(false);

  const manifest = await page.evaluate(async () => fetch('manifest.json').then((response) => response.json()));
  expect(manifest.name).toBe('BANDMARKR');
  expect(manifest.short_name).toBe('BANDMARKR');
  await expect(page.locator('#start-version-refresh')).toContainText('v87');
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-v87-bandmarkr.png`), fullPage: true });
});
