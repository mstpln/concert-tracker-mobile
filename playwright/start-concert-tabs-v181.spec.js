'use strict';
const { test, expect } = require('@playwright/test');

async function syntheticStart(page, width = 375, colorScheme = 'dark') {
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
  await page.setViewportSize({ width, height: 940 });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
  await page.evaluate(() => {
    const now = typeof dlCurrentDate === 'function' ? dlCurrentDate() : new Date();
    const at = (days) => {
      const value = new Date(now);
      value.setDate(value.getDate() + days);
      return [value.getFullYear(), String(value.getMonth() + 1).padStart(2,'0'), String(value.getDate()).padStart(2,'0')].join('-');
    };
    const make = (id, band, date, extra = {}) => ({
      id, bandId: band.id, bandName: band.name,
      date, time: '19:30', venue: 'QA Sample Arena',
      city: 'Sample City', country: 'Denmark', venueAddress: '1 Test Road',
      attending: true, ownedTickets: [], prepChecklist: {}, ...extra,
    });
    concerts = [
      make('qa-v181-featured', bands[0], at(12), { distanceKm: 75 }),
      make('qa-v181-remaining', bands[1], at(25), { distanceKm: 111 }),
      make('qa-v181-past', bands[2], at(-120), { distanceKm: 37 }),
      make('qa-v181-cancelled', bands[0], at(-100), {
        personalLifecycleStatus: 'cancelled', ticketPrice: 1200, ticketQuantity: 2,
        notes: 'Synthetic cancelled show', unknownFuture: { keep: true },
      }),
    ];
    renderMyConcertsScreen();
  });
}

for (const width of [320, 375, 480]) {
  test(`v181: approved 80px option-02 banner, equal 33px tabs and compact year totals at ${width}px`, async ({ page }, testInfo) => {
    await syntheticStart(page, width);
    const screen = page.locator('#screen-myconcerts');
    const featured = screen.locator(':scope > .next-concert-merged-v167');
    await expect(featured).toHaveCount(1);
    const banner = featured.locator('.next-concert-banner-v167');
    await expect(banner).toContainText('NEXT CONCERT');
    await expect(banner).toContainText('DAYS LEFT');
    await expect(banner).toContainText('75 km');
    await expect(banner.locator('.next-concert-live-v167')).toContainText(/\d+d \d{2}h \d{2}m \d{2}s/);

    const bannerGeometry = await banner.evaluate((node) => {
      const title = node.querySelector('.next-concert-banner-label-v181');
      const days = node.querySelector('strong');
      const distance = node.querySelector('.next-concert-distance-v167');
      const ticker = node.querySelector('.next-concert-live-v167');
      const right = node.querySelector('.next-concert-banner-right-v181');
      return {
        height: node.getBoundingClientRect().height,
        titleSize: getComputedStyle(title).fontSize,
        daysSize: getComputedStyle(days).fontSize,
        text: days.textContent.trim(),
        distanceAbove: distance.getBoundingClientRect().bottom < ticker.getBoundingClientRect().top,
        border: getComputedStyle(right).borderLeftWidth,
        noOverflow: node.scrollWidth <= node.clientWidth + 1,
      };
    });
    expect(bannerGeometry.height).toBe(80);
    expect(bannerGeometry.daysSize).toBe(width <= 355 ? '12px' : '13px');
    expect(bannerGeometry.text).toMatch(/^\d+ DAYS LEFT$/);
    expect(bannerGeometry.distanceAbove).toBe(true);
    expect(bannerGeometry.border).toBe('1px');
    expect(bannerGeometry.noOverflow).toBe(true);

    const spacer = screen.locator(':scope > .section-label-v167-next');
    await expect(spacer).toHaveCSS('visibility', 'hidden');
    const position = await screen.evaluate((node) => {
      const label = node.querySelector(':scope > .section-label-v167-next');
      const card = node.querySelector(':scope > .next-concert-merged-v167');
      return {
        spacerHeight: label.getBoundingClientRect().height,
        labelBottom: label.getBoundingClientRect().bottom,
        cardTop: card.getBoundingClientRect().top,
      };
    });
    expect(position.spacerHeight).toBeGreaterThan(0);
    expect(position.cardTop).toBeGreaterThanOrEqual(position.labelBottom);

    const tabs = screen.locator('.myconcerts-history-tabs');
    const sizes = await tabs.evaluate((node) => {
      const row = node.getBoundingClientRect();
      return {
        height: row.height,
        width: row.width,
        children: [...node.querySelectorAll('button')].map((b) => ({
          width: b.getBoundingClientRect().width,
          height: b.getBoundingClientRect().height,
          font: getComputedStyle(b).fontSize,
        })),
      };
    });
    expect(sizes.height).toBe(33);
    expect(sizes.children).toHaveLength(3);
    expect(sizes.children.every((s) => s.font === '13px')).toBe(true);
    expect(Math.max(...sizes.children.map((s) => s.width)) - Math.min(...sizes.children.map((s) => s.width))).toBeLessThanOrEqual(1);
    await expect(tabs.locator('button')).toHaveText(['Upcoming concerts', 'Past concerts', 'Cancelled']);
    await expect(tabs.locator('button').first()).toHaveAttribute('aria-selected', 'true');

    await expect(screen.locator('#my-history-upcoming')).toBeVisible();
    await expect(screen.locator('#my-history-upcoming .row-card-mc')).toHaveCount(1);
    await expect(screen.locator('#my-history-upcoming .delete-corner-btn[data-concert-id="qa-v181-remaining"]')).toHaveCount(1);
    await expect(screen.locator('#my-history-upcoming .delete-corner-btn[data-concert-id="qa-v181-featured"]')).toHaveCount(0);
    await expect(screen.locator('#my-history-upcoming .year-divider-count')).toHaveText('1 more show');

    const yearStyle = await screen.locator('#my-history-upcoming .year-divider').evaluate((node) => ({
      line: getComputedStyle(node.querySelector('.year-divider-line')).display,
      count: node.querySelector('.year-divider-count')?.textContent,
      countRightAligned: node.querySelector('.year-divider-count').getBoundingClientRect().right >=
        node.getBoundingClientRect().right - 1,
    }));
    expect(yearStyle.line).toBe('none');
    expect(yearStyle.count).toBe('1 more show');
    expect(yearStyle.countRightAligned).toBe(true);

    await tabs.locator('[data-my-history-tab="past"]').click();
    await expect(screen.locator('#my-history-past')).toBeVisible();
    await expect(screen.locator('#my-history-upcoming')).toBeHidden();
    await expect(screen.locator('#my-history-past .row-card-mc')).toHaveCount(1);
    await expect(screen.locator('#my-history-past .year-divider-count')).toHaveText('1 show');

    await tabs.locator('[data-my-history-tab="cancelled"]').click();
    await expect(screen.locator('#my-history-cancelled')).toBeVisible();
    await expect(screen.locator('#my-history-past')).toBeHidden();
    await expect(screen.locator('#my-history-cancelled .my-lifecycle-status.cancelled')).toHaveText('CANCELLED');
    await expect(screen.locator('#my-history-cancelled .year-divider-line')).toHaveCSS('display', 'none');
    await expect(screen.locator('#my-history-cancelled .year-divider-count')).toHaveText('1 show');

    await screen.screenshot({ path: testInfo.outputPath(`start-v181-tabs-${width}.png`), fullPage: false });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}

test('v181: same 33px/13px segmented tabs on Stats, Discover, Profile and Settings', async ({ page }) => {
  await syntheticStart(page, 375, 'light');
  const geometry = async (selector) => page.locator(selector).evaluate((node) => {
    const button = node.querySelector('button');
    return { height: node.getBoundingClientRect().height, font: getComputedStyle(button).fontSize };
  });
  const start = await geometry('#screen-myconcerts .myconcerts-history-tabs');
  await page.locator('#tabbar [data-tab="concerts"]').click();
  const discover = await geometry('#screen-concerts .news-subtab-switch');
  // The v135 Alerts surface intentionally retired its Alerts/News selector.
  // Only existing main segmented controls participate in this consistency rule.
  await page.locator('#tabbar [data-tab="news"]').click();
  await expect(page.locator('#screen-news .news-subtab-switch')).toHaveCount(0);
  await page.locator('#tabbar [data-tab="stats"]').click();
  const stats = await geometry('#screen-stats .stats-subtabs');
  await page.evaluate(() => openProfile(bands[0].id));
  const profile = await geometry('#screen-profile .profile-tab-switch');
  await page.locator('#settings-btn').click();
  const settings = await geometry('#screen-settings .settings-v123-tabs');
  for (const [name, got] of Object.entries({ start, discover, stats, profile, settings })) {
    expect(got.height, name).toBe(33);
    expect(got.font, name).toBe('13px');
  }
});

test('v181: three tabs are usable when there are no attending concerts', async ({ page }) => {
  await syntheticStart(page);
  await page.evaluate(() => {
    concerts = concerts.map((c) => ({ ...c, attending: false }));
    renderMyConcertsScreen();
  });
  await expect(page.locator('#my-history-upcoming')).toContainText('No upcoming concerts.');
  await page.locator('[data-my-history-tab="cancelled"]').click();
  await expect(page.locator('#my-history-cancelled')).toContainText('No cancelled concerts.');
  await page.locator('[data-my-history-tab="past"]').click();
  await expect(page.locator('#my-history-past')).toContainText('No past concerts yet.');
});
