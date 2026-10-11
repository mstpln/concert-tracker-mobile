'use strict';
const { test, expect } = require('@playwright/test');

async function openSynthetic(page, width, colorScheme = 'dark') {
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}

async function populateConcerts(page) {
  await page.evaluate(() => {
    const now = typeof dlCurrentDate === 'function' ? dlCurrentDate() : new Date();
    const at = days => {
      const day = new Date(now);
      day.setDate(day.getDate() + days);
      return [day.getFullYear(), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0')].join('-');
    };
    const make = (id, band, days, extra = {}) => ({
      id, bandId: band.id, bandName: band.name,
      date: at(days), time: '19:30', venue: 'Synthetic Hall',
      city: 'QA City', country: 'Denmark', venueAddress: '1 Fixture Road',
      attending: true, ownedTickets: [], prepChecklist: {}, ...extra,
    });
    concerts = [
      make('qa-v184-featured', bands[0], 12, { distanceKm: 59 }),
      make('qa-v184-first', bands[1], 24),
      make('qa-v184-second', bands[2], 28),
      make('qa-v184-nextyear', bands[0], 440),
      make('qa-v184-past', bands[1], -30),
      make('qa-v184-pastyear', bands[2], -410),
      make('qa-v184-cancelled', bands[0], -15, { personalLifecycleStatus: 'cancelled', futureField: { keep: true } }),
    ];
    renderMyConcertsScreen();
  });
}

async function assertIntegratedFirstCard(page, key) {
  const tabStrip = page.locator('#screen-myconcerts .music-history-tabs-v183');
  const panel = page.locator('#my-history-' + key);
  const card = panel.locator(':scope > .music-history-first-card-v184');
  await expect(card).toBeVisible();
  const metrics = await page.evaluate((selected) => {
    const strip = document.querySelector('#screen-myconcerts .music-history-tabs-v183');
    const first = document.querySelector('#my-history-' + selected + ' > .music-history-first-card-v184');
    const a = strip.getBoundingClientRect(), b = first.getBoundingClientRect();
    const tabCss = getComputedStyle(strip), cardCss = getComputedStyle(first);
    return {
      gap: b.top - a.bottom, left: b.left - a.left, right: b.right - a.right,
      tabsBottomBorder: tabCss.borderBottomWidth, cardTopBorder: cardCss.borderTopWidth,
      cardTopLeftRadius: cardCss.borderTopLeftRadius, cardTopRightRadius: cardCss.borderTopRightRadius,
    };
  }, key);
  expect(Math.abs(metrics.gap)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.right)).toBeLessThanOrEqual(1);
  expect(metrics.tabsBottomBorder).toBe('0px');
  expect(metrics.cardTopBorder).toBe('0px');
  expect(metrics.cardTopLeftRadius).toBe('0px');
  expect(metrics.cardTopRightRadius).toBe('0px');
}

for (const width of [320, 375, 480]) {
  for (const colorScheme of ['dark', 'light']) {
    test('v184 integrated history at ' + width + 'px / ' + colorScheme, async ({ page }, testInfo) => {
      await openSynthetic(page, width, colorScheme);
      await populateConcerts(page);
      await page.locator('#music-tab-concerts').click();

      const screen = page.locator('#screen-myconcerts');
      await expect(screen.locator('.music-history-year-v183')).toBeVisible();
      await expect(screen.locator('.music-history-year-v183 .year-divider-count')).toHaveText('2 more shows');
      await expect(screen.locator('.music-history-tabs-v183 button')).toHaveText(['Upcoming','Past','Cancelled']);
      const yearOutside = await screen.evaluate(node => {
        const heading = node.querySelector(':scope > .music-history-year-v183');
        const tabs = node.querySelector(':scope > .music-history-tabs-v183');
        return heading.nextElementSibling === tabs && heading.getBoundingClientRect().bottom <= tabs.getBoundingClientRect().top;
      });
      expect(yearOutside).toBe(true);
      await assertIntegratedFirstCard(page, 'upcoming');

      const rows = screen.locator('#my-history-upcoming .row-card-mc');
      await expect(rows).toHaveCount(3);
      await expect(rows.nth(1)).not.toHaveClass(/music-history-first-card-v184/);
      await expect(screen.locator('#my-history-upcoming .year-divider')).toHaveCount(2);
      await expect(screen.locator('#my-history-upcoming .year-divider').nth(1)).toBeVisible();
      await expect(screen.locator(':scope > .next-concert-merged-v167')).toBeVisible();

      const tabs = screen.locator('.music-history-tabs-v183');
      await tabs.locator('[data-my-history-tab="past"]').click();
      await expect(screen.locator('.music-history-year-v183 .year-divider-count')).toHaveText('1 show');
      await assertIntegratedFirstCard(page, 'past');
      await expect(screen.locator('#my-history-past .year-divider').nth(1)).toBeVisible();

      await tabs.locator('[data-my-history-tab="cancelled"]').click();
      await expect(screen.locator('.music-history-year-v183 .year-divider-count')).toHaveText('1 show');
      await expect(screen.locator('#my-history-cancelled .my-lifecycle-status.cancelled')).toHaveText('CANCELLED');
      await assertIntegratedFirstCard(page, 'cancelled');
      const canceled = screen.locator('#my-history-cancelled .music-history-first-card-v184');
      await expect(canceled.locator('.my-lifecycle-action')).toContainText('Restore');
      await page.screenshot({ path: testInfo.outputPath('v184-concert-card-' + width + '-' + colorScheme + '.png') });

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }
}

for (const width of [375, 480]) {
  for (const colorScheme of ['dark', 'light']) {
    test('v184 band listening unified frame at ' + width + 'px / ' + colorScheme, async ({ page }, testInfo) => {
      await openSynthetic(page, width, colorScheme);
      await page.evaluate(() => openProfile(bands[0].id, { selectedTab: 'listening' }));
      const panel = page.locator('#screen-profile .band-listening-panel');
      const wrapper = panel.locator(':scope > .music-band-combined-v184');
      await expect(wrapper).toHaveCount(1);
      await expect(wrapper.locator(':scope > .listening-summary')).toBeVisible();
      const chart = wrapper.locator(':scope > .listening-chart-card');
      await expect(chart).toBeVisible();
      await expect(chart.locator('svg.listening-line-chart')).toBeVisible();
      await expect(panel.locator(':scope > .top-tracks-card')).toBeVisible();

      const layout = await wrapper.evaluate(node => {
        const summary = node.querySelector(':scope > .listening-summary');
        const chart = node.querySelector(':scope > .listening-chart-card');
        const outer = getComputedStyle(node);
        const a = getComputedStyle(summary), b = getComputedStyle(chart);
        const rect = node.getBoundingClientRect(), chartRect = chart.getBoundingClientRect();
        return {
          border: outer.borderTopWidth, radius: outer.borderTopLeftRadius,
          innerSummaryBorder: a.borderTopWidth, innerChartBorder: b.borderTopWidth,
          innerSummaryMargin: a.marginBottom, innerChartMargin: b.marginTop,
          sameLeft: Math.abs(rect.left + 1 - chartRect.left) <= 1,
          sameRight: Math.abs(rect.right - 1 - chartRect.right) <= 1,
        };
      });
      expect(layout.border).toBe('1px');
      expect(layout.radius).toBe('10px');
      expect(layout.innerSummaryBorder).toBe('0px');
      expect(layout.innerChartBorder).toBe('0px');
      expect(layout.innerSummaryMargin).toBe('0px');
      expect(layout.innerChartMargin).toBe('0px');
      expect(layout.sameLeft).toBe(true);
      expect(layout.sameRight).toBe(true);

      const timeframe = wrapper.locator('.music-band-timeframe-v183');
      await expect(timeframe.locator('button')).toHaveCount(4);
      await timeframe.locator('[data-listening-timeframe="threeMonths"]').click();
      await expect(panel.locator(':scope > .music-band-combined-v184')).toHaveCount(1);
      await expect(panel.locator('.music-band-combined-v184 .music-band-timeframe-v183 [data-listening-timeframe="threeMonths"]')).toHaveClass(/active/);
      await expect(panel.locator('.music-band-combined-v184 .listening-chart-card svg')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('v184-listening-' + width + '-' + colorScheme + '.png') });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }
}

test('v184 empty concert lists and missing listening data remain usable', async ({ page }) => {
  await openSynthetic(page, 375, 'dark');
  await page.evaluate(() => { concerts = []; renderMyConcertsScreen(); });
  await page.locator('#music-tab-concerts').click();
  const screen = page.locator('#screen-myconcerts');
  await expect(screen.locator('.music-history-year-v183')).toBeHidden();
  const tabs = screen.locator('.music-history-tabs-v183');
  for (const key of ['upcoming','past','cancelled']) {
    await tabs.locator('[data-my-history-tab="' + key + '"]').click();
    const panel = screen.locator('#my-history-' + key);
    await expect(panel.locator(':scope > .screen-empty')).toBeVisible();
    const gap = await page.evaluate(selected => {
      const a = document.querySelector('#screen-myconcerts .music-history-tabs-v183').getBoundingClientRect();
      const b = document.querySelector('#my-history-' + selected + ' > .screen-empty').getBoundingClientRect();
      return Math.abs(b.top - a.bottom);
    }, key);
    expect(gap).toBeLessThanOrEqual(1);
  }
  await page.evaluate(() => { listeningEvents = []; openProfile(bands[0].id, { selectedTab: 'listening' }); });
  await expect(page.locator('#screen-profile .band-listening-panel .screen-empty')).toBeVisible();
  await expect(page.locator('#screen-profile .music-band-combined-v184')).toHaveCount(0);
});
