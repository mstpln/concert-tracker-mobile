'use strict';
const { test, expect } = require('@playwright/test');

async function setup(page, width, colorScheme = 'dark') {
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
  await page.setViewportSize({ width, height: 880 });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
  await page.evaluate(() => {
    const now = typeof dlCurrentDate === 'function' ? dlCurrentDate() : new Date();
    const at = days => {
      const d = new Date(now);
      d.setDate(d.getDate() + days);
      return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
    };
    const make = (id, band, days, rest = {}) => ({
      id, bandId: band.id, bandName: band.name, date: at(days),
      time: '19:30', venue: 'Synthetic Arena', city: 'Sample City',
      country: 'Denmark', venueAddress: '2 QA Way', attending: true,
      ownedTickets: [], prepChecklist: {}, ...rest,
    });
    concerts = [
      make('qa-v183-next', bands[0], 12, { distanceKm: 59 }),
      make('qa-v183-upcoming', bands[1], 25),
      make('qa-v183-last', bands[2], -38, { distanceKm: 38 }),
      make('qa-v183-older', bands[0], -140),
      make('qa-v183-cancelled', bands[1], -30, {
        personalLifecycleStatus: 'cancelled', unknownFuture: { keep: 'yes' },
      }),
    ];
    renderMyConcertsScreen();
  });
}

for (const width of [320, 375, 390, 480]) {
  test('v183 two-level Music navigation and year totals at ' + width + 'px', async ({ page }, testInfo) => {
    await setup(page, width);
    const screen = page.locator('#screen-myconcerts');
    const primary = screen.locator('.music-primary-tabs-v183');
    const top = await primary.evaluate(node => ({
      height: node.getBoundingClientRect().height,
      font: getComputedStyle(node.querySelector('button')).fontSize,
    }));
    expect(top).toEqual({ height: 33, font: '13px' });
    await expect(screen).toHaveAttribute('data-music-section-v183', 'highlights');
    await expect(screen.locator('.myconcerts-summary')).toBeVisible();
    await expect(screen.locator('.music-last-v183')).toBeHidden();
    await primary.locator('[data-music-section="concerts"]').click();

    await expect(screen.locator('.music-last-v183')).toBeVisible();
    await expect(screen.locator('.music-last-artist-v183')).toContainText('QA');
    await expect(screen.locator('.music-last-elapsed-v183')).toHaveText('38 days ago');
    const alignment = await screen.locator('.music-last-row-v183').evaluate(node => {
      const a = node.querySelector('.music-last-artist-v183').getBoundingClientRect();
      const b = node.querySelector('.music-last-elapsed-v183').getBoundingClientRect();
      return Math.abs(a.bottom - b.bottom);
    });
    expect(alignment).toBeLessThanOrEqual(3);

    const featured = screen.locator(':scope > .next-concert-merged-v167');
    await expect(featured).toBeVisible();
    const stage = featured.locator('.next-concert-stage-v182');
    await expect(stage).toBeVisible();
    const font = await stage.locator('.next-concert-stage-number-v182').evaluate(node => getComputedStyle(node).fontSize);
    expect(font).toBe(width <= 355 ? '57px' : '68px');
    const lower = screen.locator('.music-history-tabs-v183');
    await expect(lower.locator('button')).toHaveText(['Upcoming', 'Past', 'Cancelled']);
    const sizes = await lower.evaluate(node => ({
      heights: [...node.querySelectorAll('button')].map(el => el.getBoundingClientRect().height),
      font: getComputedStyle(node.querySelector('button.active')).fontSize,
    }));
    expect(sizes.heights).toEqual([42, 42, 42]);
    expect(sizes.font).toBe(width <= 355 ? '12px' : '14px');

    const heading = screen.locator('.music-history-year-v183');
    await expect(heading).toBeVisible();
    await expect(heading.locator('.year-divider-count')).toHaveText('1 show');
    const rightOrder = await screen.evaluate(node => {
      const year = node.querySelector(':scope > .music-history-year-v183');
      return year.nextElementSibling === node.querySelector(':scope > .music-history-tabs-v183');
    });
    expect(rightOrder).toBe(true);
    await expect(screen.locator('#my-history-upcoming .row-card-mc')).toHaveCount(1);
    await expect(screen.locator('#my-history-upcoming .delete-corner-btn[data-concert-id="qa-v183-next"]')).toHaveCount(0);

    await lower.locator('[data-my-history-tab="past"]').click();
    await expect(screen.locator('#my-history-past')).toBeVisible();
    await expect(screen.locator('.music-history-year-v183 .year-divider-count')).toHaveText('2 shows');
    await lower.locator('[data-my-history-tab="cancelled"]').click();
    await expect(screen.locator('.music-history-year-v183 .year-divider-count')).toHaveText('1 show');
    await expect(screen.locator('#my-history-cancelled .my-lifecycle-status.cancelled')).toHaveText('CANCELLED');
    await screen.screenshot({ path: testInfo.outputPath('v183-music-' + width + '.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}

test('v183 last attended remains when no next concert is booked', async ({ page }) => {
  await setup(page, 375, 'light');
  await page.evaluate(() => {
    concerts = concerts.filter(c => c.id !== 'qa-v183-next' && c.id !== 'qa-v183-upcoming');
    renderMyConcertsScreen();
  });
  await page.locator('#music-tab-concerts').click();
  await expect(page.locator('.music-last-elapsed-v183')).toHaveText('38 days ago');
  await expect(page.locator('#screen-myconcerts #countdown-card')).toBeVisible();
  await expect(page.locator('#my-history-upcoming')).toContainText('No upcoming concerts.');
  await expect(page.locator('.music-history-year-v183')).toBeHidden();
});

test('v183 Band Detail Listening timeframe integrates into the existing summary card', async ({ page }, testInfo) => {
  await setup(page, 375);
  await page.evaluate(() => openProfile(bands[0].id, { selectedTab: 'listening' }));
  const panel = page.locator('#screen-profile .band-listening-panel');
  const selector = panel.locator('.music-band-summary-v183 > .music-band-timeframe-v183');
  await expect(selector).toBeVisible();
  expect(await selector.evaluate(node =>
    [...node.querySelectorAll('button')].map(b => b.getBoundingClientRect().height)))
    .toEqual([42, 42, 42, 42]);
  await selector.locator('[data-listening-timeframe="threeMonths"]').click();
  await expect(panel.locator('.music-band-summary-v183 .music-band-timeframe-v183 [data-listening-timeframe="threeMonths"]')).toHaveClass(/active/);
  await page.locator('#screen-profile').screenshot({ path: testInfo.outputPath('v183-profile-listening.png') });
});
