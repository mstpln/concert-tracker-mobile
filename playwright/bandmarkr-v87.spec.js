const { test, expect } = require('@playwright/test');

test('v88 keeps the BANDMARKR banner and exposes the simplified installed identity', async ({ page }, testInfo) => {
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium'
    ? { width: 375, height: 820 }
    : { width: 480, height: 900 });
  await page.goto('/');

  await expect(page).toHaveTitle('Bandmarkr');
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
  expect(manifest.name).toBe('Bandmarkr');
  expect(manifest.short_name).toBe('Bandmarkr');

  const decodedIcons = await page.evaluate(async () => {
    const icons = [
      ['icons/icon-192.png', 192],
      ['icons/icon-192-maskable.png', 192],
      ['icons/icon-512.png', 512],
      ['icons/icon-512-maskable.png', 512],
    ];
    return Promise.all(icons.map(async ([src, expected]) => {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`${src} returned ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = new OffscreenCanvas(expected, expected);
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      const center = [...context.getImageData(Math.floor(expected / 2), Math.floor(expected * 0.38), 1, 1).data];
      const corner = [...context.getImageData(0, 0, 1, 1).data];
      const result = { src, expected, width: bitmap.width, height: bitmap.height, center, corner };
      bitmap.close();
      return result;
    }));
  });
  for (const icon of decodedIcons) {
    expect(icon.width, icon.src).toBe(icon.expected);
    expect(icon.height, icon.src).toBe(icon.expected);
    expect(icon.center, `${icon.src} has a solid white bookmark interior`).toEqual([255, 255, 255, 255]);
    expect(icon.corner, `${icon.src} keeps the blue safe area`).toEqual([2, 77, 223, 255]);
  }

  await expect(page.locator('#start-version-refresh')).toContainText('v94');
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-v94-bandmarkr.png`), fullPage: true });
});
