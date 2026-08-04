const { test, expect } = require('@playwright/test');

test('v87 renders the approved BANDMARKR banner and PWA identity', async ({ page }, testInfo) => {
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium'
    ? { width: 375, height: 820 }
    : { width: 480, height: 900 });
  await page.goto('/');

  await expect(page).toHaveTitle('BANDMARKR');
  const banner = page.locator('#brand-banner');
  const wordmark = banner.locator('.brand-wordmark');
  await expect(wordmark).toHaveAttribute('src', 'icons/bandmarkr-wordmark.svg');
  await expect(wordmark).toHaveAttribute('alt', 'BANDMARKR');
  const geometry = await page.evaluate(() => {
    const bannerElement = document.querySelector('#brand-banner');
    const wordmarkElement = document.querySelector('.brand-wordmark');
    const banner = bannerElement.getBoundingClientRect();
    const wordmark = wordmarkElement.getBoundingClientRect();
    const style = getComputedStyle(bannerElement);
    return {
      centerDelta: Math.abs((banner.left + banner.width / 2) - (wordmark.left + wordmark.width / 2)),
      background: style.backgroundColor,
      height: banner.height,
      overflow: wordmark.width > banner.width,
      loaded: wordmarkElement.complete && wordmarkElement.naturalWidth > 0,
      renderedHeight: wordmark.height,
    };
  });
  expect(geometry.centerDelta).toBeLessThanOrEqual(1);
  expect(geometry.background).toBe('rgb(2, 77, 223)');
  expect(geometry.height).toBe(60);
  expect(geometry.overflow).toBe(false);
  expect(geometry.loaded).toBe(true);
  expect(geometry.renderedHeight).toBeGreaterThanOrEqual(18);
  expect(geometry.renderedHeight).toBeLessThanOrEqual(24);

  const manifest = await page.evaluate(async () => fetch('manifest.json').then((response) => response.json()));
  expect(manifest.name).toBe('BANDMARKR');
  expect(manifest.short_name).toBe('BANDMARKR');
  await expect(page.locator('#start-version-refresh')).toContainText('v87');
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-v87-bandmarkr.png`), fullPage: true });
});
