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
  test(`v182: Compact Hero Split #21, equal 33px tabs and compact year totals at ${width}px`, async ({ page }, testInfo) => {
    await syntheticStart(page, width);
    const screen = page.locator('#screen-myconcerts');
    const featured = screen.locator(':scope > .next-concert-merged-v167');
    await expect(featured).toHaveCount(1);
    const banner = featured.locator('.next-concert-banner-v167');
    await expect(banner).toContainText('NEXT CONCERT');
    await expect(banner).toContainText('DAYS LEFT');
    await expect(banner).toContainText('75 km');
    await expect(banner.locator('.next-concert-live-v167')).toContainText(/\d+d \d{2}h \d{2}m/);
    await expect(banner.locator('.next-concert-live-v167')).not.toContainText(/\d{2}s/);
    await expect(banner.locator('.next-concert-stage-eyebrow-v182')).toHaveText('NEXT CONCERT');
    await expect(banner.locator('.next-concert-stage-dayslabel-v182')).toHaveText('DAYS LEFT');

    const bannerGeometry = await banner.evaluate((node) => {
      const title = node.querySelector('.next-concert-stage-eyebrow-v182');
      const days = node.querySelector('strong');
      const distance = node.querySelector('.next-concert-distance-v167');
      const ticker = node.querySelector('.next-concert-live-v167');
      const right = node.querySelector('.next-concert-stage-right-v182');
      return {
        height: node.getBoundingClientRect().height,
        titleSize: getComputedStyle(title).fontSize,
        daysSize: getComputedStyle(days).fontSize,
        text: days.textContent.trim(),
        distanceAbove: distance.getBoundingClientRect().bottom < ticker.getBoundingClientRect().top,
        border: getComputedStyle(right).borderLeftWidth,
        noOverflow: node.scrollWidth <= node.clientWidth + 1,
        rightWithin: right.getBoundingClientRect().right <= node.getBoundingClientRect().right + 1,
        numberWithin: days.getBoundingClientRect().right <= node.getBoundingClientRect().right + 1,
      };
    });
    expect(bannerGeometry.height).toBe(width <= 355 ? 88 : 100);
    expect(bannerGeometry.daysSize).toBe(width <= 355 ? '55px' : '66px');
    expect(bannerGeometry.text).toMatch(/^\d+$/);
    expect(bannerGeometry.titleSize).toBe(width <= 355 ? '8px' : '10px');
    expect(bannerGeometry.distanceAbove).toBe(true);
    expect(bannerGeometry.border).toBe('1px');
    expect(bannerGeometry.noOverflow).toBe(true);
    expect(bannerGeometry.rightWithin).toBe(true);
    expect(bannerGeometry.numberWithin).toBe(true);

    const spacer = screen.locator(':scope > .section-label-v167-next');
    await expect(spacer).toHaveCSS('visibility', 'hidden');
    const position = await screen.evaluate((node) => {
      const label = node.querySelector(':scope > .section-label-v167-next');
      const card = node.querySelector(':scope > .next-concert-merged-v167');
      return {
        spacerHeight: label.getBoundingClientRect().height,
        labelBottom: label.getBoundingClientRect().bottom,
        cardTop: card.getBoundingClientRect().top,
        bannerTop: card.querySelector('.next-concert-banner-v167').getBoundingClientRect().top,
        navTop: document.querySelector('#tabbar').getBoundingClientRect().top,
      };
    });
    expect(position.spacerHeight).toBeGreaterThan(0);
    expect(position.cardTop).toBeGreaterThanOrEqual(position.labelBottom);
    expect(position.bannerTop).toBeGreaterThanOrEqual(position.cardTop - 1);

    // The 110px prototype is scaled to this real card, but the upper edge is
    // independent of banner height. Emulate the previous 80px v181 header
    // without touching the spacer or parent card; neither top edge may move.
    const oldBannerPosition = await banner.evaluate((node) => {
      const card = node.closest('.next-concert-merged-v167');
      node.style.height = '80px';
      node.style.minHeight = '80px';
      return {
        cardTop: card.getBoundingClientRect().top,
        bannerTop: node.getBoundingClientRect().top,
      };
    });
    expect(Math.abs(oldBannerPosition.cardTop - position.cardTop)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(oldBannerPosition.bannerTop - position.bannerTop)).toBeLessThanOrEqual(0.5);
    await banner.evaluate((node) => { node.style.removeProperty('height'); node.style.removeProperty('min-height'); });

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

    await screen.screenshot({ path: testInfo.outputPath(`start-v182-compact-hero-${width}.png`), fullPage: false });
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
  // The Settings gear is correctly hidden while viewing a band profile.
  // Return to the main Music screen before using that control.
  await page.evaluate(() => goToTab('myconcerts', { fromHistory: true }));
  await expect(page.locator('#settings-btn')).toBeVisible();
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


test('v182: taller internal banner never moves the featured card upward at initial scroll', async ({ page }) => {
  await syntheticStart(page, 375);
  const banner = page.locator('#screen-myconcerts .next-concert-stage-v182');
  await expect(banner).toBeVisible();
  for (const height of [640, 740, 820, 940]) {
    await page.setViewportSize({ width: 375, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    const positions = await banner.evaluate((node) => {
      const card = node.closest('.next-concert-merged-v167');
      const before = { card: card.getBoundingClientRect().top, banner: node.getBoundingClientRect().top };
      node.style.height = '80px';
      node.style.minHeight = '80px';
      const legacyHeight = { card: card.getBoundingClientRect().top, banner: node.getBoundingClientRect().top };
      node.style.removeProperty('height');
      node.style.removeProperty('min-height');
      return {
        before, legacyHeight, restoredCardTop: card.getBoundingClientRect().top,
        scrollY: window.scrollY,
      };
    });
    expect(positions.scrollY).toBe(0);
    expect(Math.abs(positions.before.card - positions.legacyHeight.card), `card top at ${height}px`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(positions.before.banner - positions.legacyHeight.banner), `banner top at ${height}px`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(positions.before.card - positions.restoredCardTop)).toBeLessThanOrEqual(0.5);
  }
});

test('v182: three-digit counts and missing distances stay readable at narrow width', async ({ page }, testInfo) => {
  await syntheticStart(page, 320);
  await page.evaluate(() => {
    const now = typeof dlCurrentDate === 'function' ? dlCurrentDate() : new Date();
    const at = (days) => {
      const d = new Date(now); d.setDate(d.getDate() + days);
      return [d.getFullYear(), String(d.getMonth() + 1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
    };
    const first = concerts.find((c) => c.id === 'qa-v181-featured');
    const second = concerts.find((c) => c.id === 'qa-v181-remaining');
    first.date = at(130);
    first.distanceKm = null;
    second.date = at(180);
    renderMyConcertsScreen();
  });
  const banner = page.locator('#screen-myconcerts .next-concert-stage-v182');
  const number = banner.locator('.next-concert-stage-number-v182');
  await expect(number).toHaveClass(/is-three-digits/);
  await expect(number).toHaveText(/^\d{3}$/);
  await expect(banner.locator('.next-concert-live-v167')).toContainText(/\d{3}d/);
  const positions = await banner.evaluate((node) => {
    const number = node.querySelector('.next-concert-stage-number-v182');
    const label = node.querySelector('.next-concert-stage-label-v182');
    const right = node.querySelector('.next-concert-stage-right-v182');
    const title = label.querySelector('.next-concert-stage-eyebrow-v182');
    return {
      bannerOverflow: node.scrollWidth - node.clientWidth,
      titleBeforeRight: title.getBoundingClientRect().right <= right.getBoundingClientRect().left + 1,
      numberBeforeTitle: number.getBoundingClientRect().right <= label.getBoundingClientRect().left + 1,
      numberFont: getComputedStyle(number).fontSize,
      viewportOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(positions.bannerOverflow).toBeLessThanOrEqual(1);
  expect(positions.viewportOverflow).toBeLessThanOrEqual(1);
  expect(positions.titleBeforeRight).toBe(true);
  expect(positions.numberBeforeTitle).toBe(true);
  expect(positions.numberFont).toBe('35px');
  await banner.screenshot({ path: testInfo.outputPath('v182-long-days-missing-distance-320.png') });
});
