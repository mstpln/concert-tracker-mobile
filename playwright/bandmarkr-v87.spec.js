const { test, expect } = require('@playwright/test');

test('Bandmarkr keeps its banner and installs the branded Music waveform icons', async ({ page }, testInfo) => {
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
      const oppositeCorner = [...context.getImageData(expected - 1, expected - 1, 1, 1).data];
      // Sample inside each of the five strokes from the Music navigation mark.
      const bars = [[96, 306], [176, 286], [256, 236], [336, 306], [416, 276]]
        .map(([x, y]) => [...context.getImageData(Math.floor(x * expected / 512), Math.floor(y * expected / 512), 1, 1).data]);
      const gap = [...context.getImageData(Math.floor(136 * expected / 512), Math.floor(306 * expected / 512), 1, 1).data];
      const result = { src, expected, width: bitmap.width, height: bitmap.height, center, corner, oppositeCorner, bars, gap };
      bitmap.close();
      return result;
    }));
  });
  for (const icon of decodedIcons) {
    expect(icon.width, icon.src).toBe(icon.expected);
    expect(icon.height, icon.src).toBe(icon.expected);
    expect(icon.center, `${icon.src} has a white central waveform stroke`).toEqual([255, 255, 255, 255]);
    for (const bar of icon.bars) expect(bar, `${icon.src} renders all five white waveform strokes`).toEqual([255, 255, 255, 255]);
    expect(icon.gap, `${icon.src} keeps the strokes separate`).not.toEqual([255, 255, 255, 255]);
    expect(icon.corner[3], `${icon.src} keeps an opaque safe area`).toBe(255);
    expect(icon.corner[0], `${icon.src} keeps the gold safe area`).toBeGreaterThan(icon.corner[1]);
    expect(icon.corner[1]).toBeGreaterThan(icon.corner[2]);
    expect(icon.oppositeCorner[3]).toBe(255);
    expect(icon.corner, `${icon.src} retains the gold gradient toning`).not.toEqual(icon.oppositeCorner);
  }

  await expect(page.locator('#start-version-refresh')).toHaveText(/^v\d+$/);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-bandmarkr.png`), fullPage: true });
});
