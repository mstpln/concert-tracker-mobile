const { test, expect } = require('@playwright/test');

async function openApp(page, testInfo) {
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium'
    ? { width: 375, height: 860 }
    : { width: 480, height: 920 });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}

async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

test('AUB1 Start ticket spacing/content and Music/Stats icon identities match the approved design', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);

  // Move the synthetic clock before the show-day fixture so the normal-day
  // AUB1 ticket is exercised without changing fixture or production data.
  await page.evaluate(() => {
    window.__LIVEVAULT_QA_NOW__ = '2027-07-10T12:00:00.000Z';
    renderMyConcertsScreen();
  });

  const ticket = page.locator('#screen-myconcerts #countdown-card');
  await expect(ticket).toHaveAttribute('data-today', 'false');
  await expect(ticket).toHaveClass(/aub1-next-concert/);
  await expect(ticket.locator('.countdown-v139-label')).toHaveCount(0);
  await expect(ticket.locator('.countdown-v139-band')).toHaveText('QA Artist One');
  await expect(ticket.locator('.countdown-v139-venue')).toHaveText('Example Arena');
  await expect(ticket.locator('.countdown-v139-address')).toContainText(['1 Fictional Avenue', 'Sample City, Exampleland']);

  const textStyles = await ticket.evaluate((node) => ({
    venueWhiteSpace: getComputedStyle(node.querySelector('.countdown-v139-venue')).whiteSpace,
    addressWhiteSpace: getComputedStyle(node.querySelector('.countdown-v139-address')).whiteSpace,
    venueOverflow: getComputedStyle(node.querySelector('.countdown-v139-venue')).textOverflow,
    addressOverflow: getComputedStyle(node.querySelector('.countdown-v139-address')).textOverflow,
  }));
  expect(textStyles).toEqual({
    venueWhiteSpace: 'normal',
    addressWhiteSpace: 'normal',
    venueOverflow: 'clip',
    addressOverflow: 'clip',
  });

  const gaps = await page.evaluate(() => {
    const next = document.querySelector('#screen-myconcerts .section-label-v152-next').getBoundingClientRect();
    const card = document.querySelector('#screen-myconcerts #countdown-card').getBoundingClientRect();
    const upcoming = document.querySelector('#screen-myconcerts .section-label-v143-upcoming').getBoundingClientRect();
    return {
      top: card.top - next.bottom,
      bottom: upcoming.top - card.bottom,
    };
  });
  expect(Math.abs(gaps.top - gaps.bottom)).toBeLessThanOrEqual(1.5);
  expect(gaps.top).toBeGreaterThanOrEqual(27);
  expect(gaps.top).toBeLessThanOrEqual(29);

  const musicPaths = await page.evaluate(() => ({
    nav: document.querySelector('#tabbar [data-tab="myconcerts"] .tab-icon path')?.getAttribute('d'),
    header: document.querySelector('#header-icon path')?.getAttribute('d'),
  }));
  expect(musicPaths.nav).toBe('M5 16v-4M9 18V8M13 16V5M17 18v-8M21 15v-5');
  expect(musicPaths.header).toBe(musicPaths.nav);

  await page.locator('#tabbar [data-tab="stats"]').click();
  const statsGlyphs = await page.evaluate(() => {
    const inspect = (svg) => ({
      pathCount: svg?.querySelectorAll('path').length || 0,
      circles: svg?.querySelectorAll('circle').length || 0,
      rects: svg?.querySelectorAll('rect').length || 0,
      paths: [...(svg?.querySelectorAll('path') || [])].map((path) => path.getAttribute('d')),
    });
    return {
      nav: inspect(document.querySelector('#tabbar [data-tab="stats"] svg.aub1-stats-glyph')),
      header: inspect(document.querySelector('#header-icon svg.aub1-stats-glyph')),
    };
  });
  expect(statsGlyphs.nav).toEqual(statsGlyphs.header);
  expect(statsGlyphs.nav.pathCount).toBe(2);
  expect(statsGlyphs.nav.circles).toBe(0);
  expect(statsGlyphs.nav.rects).toBe(0);
  expect(statsGlyphs.nav.paths[0]).toBe('M3 17l6-6 4 4 8-9');
  expect(statsGlyphs.nav.paths[1]).toBe('M15 6h6v6');
  expect(await noHorizontalOverflow(page)).toBe(true);
  expect(errors).toEqual([]);

  await page.locator('#tabbar [data-tab="myconcerts"]').click();
  await page.screenshot({ path: testInfo.outputPath('aub1-v153-start.png'), fullPage: true });
});

test('AUB1 listening activity metrics and both Overview modes retain all yearly data', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await openApp(page, testInfo);
  await page.locator('#tabbar [data-tab="stats"]').click();

  await expect(page.locator('.genre-card .listening-card-note')).toContainText('Most listened genre all time:');
  const allTime = page.locator('.aub1-alltime-activity');
  await expect(allTime).toContainText('active days per year');
  await expect(allTime).toContainText('daily average');
  await expect(allTime).toHaveAttribute('data-aub1-completed-years', /\d+/);
  const footerLayout = await allTime.evaluate((node) => {
    const style = getComputedStyle(node);
    const heading = node.querySelector('.aub1-activity-heading').getBoundingClientRect();
    const metrics = [...node.querySelectorAll('.aub1-activity-metric')].map((metric) => metric.getBoundingClientRect());
    const card = node.closest('.yearly-listening-card').getBoundingClientRect();
    const bounds = node.getBoundingClientRect();
    return {
      marginTop: parseFloat(style.marginTop),
      paddingTop: parseFloat(style.paddingTop),
      paddingBottom: parseFloat(style.paddingBottom),
      headingGap: metrics[0].top - heading.bottom,
      metricsAligned: Math.abs(metrics[0].top - metrics[1].top) <= 1,
      leftInside: bounds.left >= card.left,
      rightInside: bounds.right <= card.right,
      bottomGap: card.bottom - Math.max(...metrics.map((metric) => metric.bottom)),
    };
  });
  expect(footerLayout.marginTop).toBeGreaterThanOrEqual(18);
  expect(footerLayout.paddingTop).toBeGreaterThanOrEqual(18);
  expect(footerLayout.paddingBottom).toBeGreaterThanOrEqual(17);
  expect(footerLayout.headingGap).toBeGreaterThanOrEqual(12);
  expect(footerLayout.metricsAligned).toBe(true);
  expect(footerLayout.leftInside).toBe(true);
  expect(footerLayout.rightInside).toBe(true);
  expect(footerLayout.bottomGap).toBeGreaterThanOrEqual(16);
  await page.screenshot({ path: testInfo.outputPath('aub1-v154-stats-footer-light.png'), fullPage: true });
  await allTime.screenshot({ path: testInfo.outputPath('aub1-v154-stats-footer-light-detail.png') });

  const firstPoint = page.locator('.yearly-listening-card [data-v81-year-point]').first();
  await firstPoint.locator('circle').click();
  const yearDetail = page.locator('.yearly-listening-card .year-detail');
  await expect(yearDetail).toContainText('Days active:');
  await expect(yearDetail).toContainText('Daily average:');

  const expectedYears = await page.evaluate(() => ListeningStats.yearlyListening(listeningEvents, listeningNow(), 'All').length);
  const yearlyCard = page.locator('.yearly-listening-card');
  const yearlyOverview = yearlyCard.getByRole('button', { name: 'Overview' });
  await expect(yearlyOverview).toBeVisible();
  await yearlyOverview.click();
  await expect(yearlyCard.locator('[data-v81-year-point]')).toHaveCount(expectedYears);
  await expect(yearlyCard.getByRole('button', { name: 'Focused' })).toBeVisible();
  await expect(yearlyCard.locator('.genre-range-controls')).toHaveClass(/aub1-hidden-focused-controls/);
  const ytdLabel = yearlyCard.locator('svg[data-aub1-overview="true"] text').filter({ hasText: 'YTD' });
  await expect(ytdLabel).toHaveCount(1);
  await expect(ytdLabel).toHaveText(/^\d{4} · YTD$/);
  expect(await ytdLabel.evaluate((node) => {
    const bounds = node.getBBox();
    const viewBox = node.ownerSVGElement.viewBox.baseVal;
    const overlapsAnotherLabel = [...node.ownerSVGElement.querySelectorAll('text')]
      .filter((candidate) => candidate !== node)
      .some((candidate) => {
        const other = candidate.getBBox();
        return bounds.x < other.x + other.width
          && bounds.x + bounds.width > other.x
          && bounds.y < other.y + other.height
          && bounds.y + bounds.height > other.y;
      });
    return {
      anchor: node.getAttribute('text-anchor'),
      leftInside: bounds.x >= viewBox.x,
      rightInside: bounds.x + bounds.width <= viewBox.x + viewBox.width,
      overlapsAnotherLabel,
    };
  })).toEqual({ anchor: 'end', leftInside: true, rightInside: true, overlapsAnotherLabel: false });
  await page.screenshot({ path: testInfo.outputPath('aub1-v153-yearly-overview-light.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  expect(await ytdLabel.evaluate((node) => {
    const bounds = node.getBBox();
    const viewBox = node.ownerSVGElement.viewBox.baseVal;
    return bounds.x >= viewBox.x && bounds.x + bounds.width <= viewBox.x + viewBox.width;
  })).toBe(true);
  await allTime.screenshot({ path: testInfo.outputPath('aub1-v154-stats-footer-dark-detail.png') });
  await page.screenshot({ path: testInfo.outputPath('aub1-v153-yearly-overview-dark.png'), fullPage: true });

  // Return to focused rendering, then exercise the genre Overview separately.
  await yearlyCard.getByRole('button', { name: 'Focused' }).click();
  const expectedGenreYears = await page.evaluate(() => ListeningStats.genreDistributionByYear(listeningEvents).length);
  const genreCard = page.locator('.genre-card');
  const genreOverview = genreCard.getByRole('button', { name: 'Overview' });
  await genreOverview.click();
  await expect(genreCard.locator('[data-v81-genre-year]')).toHaveCount(expectedGenreYears);
  await expect(genreCard.getByRole('button', { name: 'Focused' })).toBeVisible();
  await expect(genreCard.locator('.genre-range-controls')).toHaveClass(/aub1-hidden-focused-controls/);

  expect(await noHorizontalOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('aub1-v153-stats-overview.png'), fullPage: true });
});

test('AUB1 My Bands search is live, composes with existing filters, and clears when leaving', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);
  await page.locator('#tabbar [data-tab="mybands"]').click();

  const input = page.getByRole('searchbox', { name: 'Search bands' });
  await expect(input).toBeVisible();
  const placement = await page.evaluate(() => {
    const total = document.querySelector('#screen-mybands .bands-total-header');
    const search = document.querySelector('#screen-mybands .aub1-band-search');
    const filter = document.querySelector('#screen-mybands .filter-row');
    return !!total && !!search && !!filter && total.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING && search.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(Boolean(placement)).toBe(true);

  await input.fill('qA aRtIsT tHrEe');
  const visibleRows = page.locator('#screen-mybands .row-card[data-band-id]:not(.aub1-search-hidden)');
  await expect(visibleRows).toHaveCount(1);
  await expect(visibleRows.first()).toContainText('QA Artist Three');
  await expect(page.getByRole('button', { name: 'Clear band search' })).toBeVisible();

  await page.locator('#muted-filter-toggle').click();
  await expect(page.getByRole('searchbox', { name: 'Search bands' })).toHaveValue('qA aRtIsT tHrEe');
  await expect(page.locator('#screen-mybands .row-card[data-band-id]:not(.aub1-search-hidden)')).toHaveCount(1);

  await page.getByRole('button', { name: 'Clear band search' }).click();
  await expect(page.getByRole('searchbox', { name: 'Search bands' })).toHaveValue('');
  await page.getByRole('searchbox', { name: 'Search bands' }).fill('definitely no synthetic band');
  await expect(page.getByText('No bands found', { exact: true })).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search bands' }).fill('QA Artist Three');
  await page.locator('#screen-mybands .row-card[data-band-id="qa-artist-three"]').click();
  await expect(page.locator('#screen-profile')).toBeVisible();
  await page.getByTestId('back-button').click();
  await expect(page.locator('#screen-mybands')).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search bands' })).toHaveValue('');

  expect(await noHorizontalOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('aub1-v153-my-bands.png'), fullPage: true });
});

test('AUB1 concert alert cards show exactly one highest-priority location tag', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await openApp(page, testInfo);

  await page.evaluate(() => {
    const foundAt = '2027-07-16T11:30:00.000Z';
    const common = { date: '2027-09-01', sourceProvider: 'ticketmaster', foundAt, manuallyAdded: false };
    concerts.push(
      { ...common, id: 'aub1-nearby-a', bandId: 'qa-artist-one', bandName: 'QA Artist One With A Long Synthetic Tour Name', venue: 'Nearby One', city: 'Malmo', country: 'Sweden', distanceKm: 50 },
      { ...common, id: 'aub1-nearby-b', bandId: 'qa-artist-one', bandName: 'QA Artist One With A Long Synthetic Tour Name', venue: 'Tour Peer', city: 'Berlin', country: 'Germany', distanceKm: 500 },
      { ...common, id: 'aub1-se', bandId: 'qa-artist-five', bandName: 'Synthetic Ensemble', venue: 'Sweden Far', city: 'Stockholm', country: 'Sweden', distanceKm: 600 },
      { ...common, id: 'aub1-eu', bandId: 'qa-artist-two', bandName: 'QA Artist Two', venue: 'EU Hall', city: 'Berlin', country: 'Germany', distanceKm: 500 },
      { ...common, id: 'aub1-none', bandId: 'qa-artist-six', bandName: 'Example Soloist', venue: 'Elsewhere', city: 'Toronto', country: 'Canada', distanceKm: 5000 },
    );
  });
  await page.locator('#tabbar [data-tab="news"]').click();
  await expect(page.locator('#screen-news')).toBeVisible();

  const tour = page.locator('#screen-news .row-card').filter({ hasText: 'New tour announced · QA Artist One With A Long Synthetic Tour Name' }).first();
  await expect(tour.locator('.aub1-location-tag')).toHaveText('Nearby');
  await expect(tour.locator('.aub1-location-tag')).toHaveCount(1);
  await expect(tour.locator('.alert-favorite-badge')).toBeVisible();
  const assertNoTitleBadgeOverlap = async () => {
    expect(await tour.evaluate((card) => {
      const title = card.querySelector('.alert-title');
      const location = card.querySelector('.aub1-location-tag');
      const favorite = card.querySelector('.alert-favorite-badge');
      if (!title || !location || !favorite) return false;
      const range = document.createRange();
      range.selectNodeContents(title);
      const titleRects = [...range.getClientRects()];
      const badgeRects = [location.getBoundingClientRect(), favorite.getBoundingClientRect()];
      return titleRects.every((titleRect) => badgeRects.every((badgeRect) => !(
        titleRect.left < badgeRect.right
        && titleRect.right > badgeRect.left
        && titleRect.top < badgeRect.bottom
        && titleRect.bottom > badgeRect.top
      )));
    })).toBe(true);
  };
  await assertNoTitleBadgeOverlap();

  const sweden = page.locator('#screen-news .row-card').filter({ hasText: 'Synthetic Ensemble' }).first();
  await expect(sweden.locator('.aub1-location-tag')).toHaveText('SE');
  await expect(sweden.locator('.aub1-location-tag')).toHaveCount(1);

  const europe = page.locator('#screen-news .row-card').filter({ hasText: 'QA Artist Two' }).first();
  await expect(europe.locator('.aub1-location-tag')).toHaveText('EU');
  await expect(europe.locator('.aub1-location-tag')).toHaveCount(1);

  const none = page.locator('#screen-news .row-card').filter({ hasText: 'Example Soloist' }).first();
  await expect(none.locator('.aub1-location-tag')).toHaveCount(0);

  expect(await noHorizontalOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('aub1-v153-alert-tags-light.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect(page.locator('#screen-news')).toBeVisible();
  await assertNoTitleBadgeOverlap();
  expect(await noHorizontalOverflow(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('aub1-v153-alert-tags-dark.png'), fullPage: true });
});
