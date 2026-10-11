const { test, expect } = require('@playwright/test');

function viewportFor(testInfo) {
  return testInfo.project.name === 'mobile-chromium'
    ? { width: 375, height: 820 }
    : { width: 480, height: 900 };
}

async function expectNextConcertPlacement(page) {
  // v181 hides the old separator without collapsing its geometry and moves
  // the remaining list beneath the three equal-width concert tabs.
  const state = await page.evaluate(() => {
    const screen = document.querySelector('#screen-myconcerts');
    const spacer = screen.querySelector(':scope > .section-label-v167-next');
    const featured = screen.querySelector(':scope > .next-concert-merged-v167');
    const tabs = screen.querySelector(':scope > .myconcerts-history-tabs');
    return {
      spacer: spacer && {
        visibility: getComputedStyle(spacer).visibility,
        height: spacer.getBoundingClientRect().height,
        bottom: spacer.getBoundingClientRect().bottom,
      },
      featuredTop: featured?.getBoundingClientRect().top,
      tabsTop: tabs?.getBoundingClientRect().top,
      sourceUpcomingLabels: screen.querySelectorAll(':scope > .section-label-v143-upcoming').length,
      retiredCountdownCount: screen.querySelectorAll('#countdown-card').length,
    };
  });
  expect(state.spacer.visibility).toBe('hidden');
  expect(state.spacer.height).toBe(0);
  expect(state.featuredTop).toBeGreaterThanOrEqual(state.spacer.bottom);
  expect(state.tabsTop).toBeGreaterThan(state.featuredTop);
  expect(state.sourceUpcomingLabels).toBe(0);
  expect(state.retiredCountdownCount).toBe(0);
}

for (const colorScheme of ['dark', 'light']) {
  test(`v181 Start Music chrome and hidden separator preserve shared navigation in ${colorScheme} mode`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.setViewportSize(viewportFor(testInfo));
    await page.goto('/');

    const musicTab = page.locator('#tabbar [data-tab="myconcerts"]');
    const datesTab = page.locator('#tabbar [data-tab="concerts"]');

    await expect(page.locator('#header-title')).toHaveText('MYMUSIC');
    await expect(page.locator('#header-title .brand-blue')).toHaveText('MUSIC');
    await expect(musicTab).toHaveText('Music');
    await expect(musicTab.locator('.tab-icon path')).toHaveAttribute('d', 'M5 16v-4M9 18V8M13 16V5M17 18v-8M21 15v-5');
    await expect(musicTab).toHaveClass(/active/);
    await expect(musicTab).toHaveAttribute('aria-current', 'page');

    await expect(page.locator('#screen-myconcerts .section-label-v152-next')).toHaveText(/Next concert/i);
    await page.locator('#music-tab-concerts').click();
    await expectNextConcertPlacement(page);

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
    await expect(page.locator('#header-title .brand-blue')).toHaveText('MUSIC');

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}