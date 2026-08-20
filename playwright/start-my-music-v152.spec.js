const { test, expect } = require('@playwright/test');

function viewportFor(testInfo) {
  return testInfo.project.name === 'mobile-chromium'
    ? { width: 375, height: 820 }
    : { width: 480, height: 900 };
}

async function expectDividerStylesMatch(page) {
  const result = await page.evaluate(() => {
    const next = document.querySelector('#screen-myconcerts .section-label-v152-next');
    const upcoming = [...document.querySelectorAll('#screen-myconcerts .section-label-v143-upcoming')]
      .find((node) => /upcoming concerts/i.test(node.textContent));
    const read = (node) => ({
      display: getComputedStyle(node).display,
      gap: getComputedStyle(node).gap,
      margin: getComputedStyle(node).margin,
      color: getComputedStyle(node).color,
      whiteSpace: getComputedStyle(node).whiteSpace,
      beforeHeight: getComputedStyle(node, '::before').height,
      beforeColor: getComputedStyle(node, '::before').backgroundColor,
      beforeOpacity: getComputedStyle(node, '::before').opacity,
      afterHeight: getComputedStyle(node, '::after').height,
      afterColor: getComputedStyle(node, '::after').backgroundColor,
      afterOpacity: getComputedStyle(node, '::after').opacity,
    });
    return { next: read(next), upcoming: read(upcoming), immediatelyBeforeCountdown: next?.nextElementSibling?.id === 'countdown-card' };
  });
  expect(result.next).toEqual(result.upcoming);
  expect(result.immediatelyBeforeCountdown).toBe(true);
}

for (const colorScheme of ['dark', 'light']) {
  test(`v152 Start Music chrome and separator preserve shared navigation in ${colorScheme} mode`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.setViewportSize(viewportFor(testInfo));
    await page.goto('/');

    const musicTab = page.locator('#tabbar [data-tab="myconcerts"]');
    const datesTab = page.locator('#tabbar [data-tab="concerts"]');

    await expect(page.locator('#header-title')).toHaveText('MYMUSIC');
    await expect(page.locator('#header-title .brand-blue')).toHaveText('MY');
    await expect(musicTab).toHaveText('Music');
    await expect(musicTab.locator('.tab-icon path')).toHaveAttribute('d', 'M5 16v-4M9 18V8M13 16V5M17 18v-8M21 15v-5');
    await expect(musicTab).toHaveClass(/active/);
    await expect(musicTab).toHaveAttribute('aria-current', 'page');

    await expect(page.locator('#screen-myconcerts .section-label-v152-next')).toHaveText(/Next concert/i);
    await expectDividerStylesMatch(page);

    if (colorScheme === 'dark') {
      await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-v152-start-music.png`), fullPage: true });
    }

    await datesTab.click();
    await expect(datesTab).toHaveClass(/active/);
    await expect(datesTab).toHaveAttribute('aria-current', 'page');
    await expect(musicTab).not.toHaveClass(/active/);
    await expect(musicTab).not.toHaveAttribute('aria-current', 'page');

    await musicTab.click();
    await expect(musicTab).toHaveClass(/active/);
    await expect(musicTab).toHaveAttribute('aria-current', 'page');
    await expect(datesTab).not.toHaveClass(/active/);
    await expect(page.locator('#header-title')).toHaveText('MYMUSIC');

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
