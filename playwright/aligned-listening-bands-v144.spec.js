const { test, expect } = require('@playwright/test');

test('v144 aligns genre drill-down, My Bands return position, and status icons', async ({ page }, testInfo) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  const desktop = testInfo.project.name === 'desktop-chromium';
  await page.setViewportSize(desktop ? { width: 480, height: 900 } : { width: 375, height: 820 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');

  // My Bands: only exceptional favorite / alerts-off states are shown, using
  // the exact 14px profile glyphs in a trailing status area before chevron.
  await page.locator('[data-tab="mybands"]').click();
  const favoriteRow = page.locator('#screen-mybands .row-card[data-band-id="qa-artist-one"]');
  const mutedRow = page.locator('#screen-mybands .row-card[data-band-id="qa-artist-three"]');
  const ordinaryRow = page.locator('#screen-mybands .row-card[data-band-id="qa-artist-two"]');

  await expect(favoriteRow.locator('.mybands-status-icon[data-status="favorite"]')).toHaveCount(1);
  await expect(favoriteRow.locator('.mybands-status-icon[data-status="muted"]')).toHaveCount(0);
  await expect(mutedRow.locator('.mybands-status-icon[data-status="muted"]')).toHaveCount(1);
  await expect(mutedRow.locator('.mybands-status-icon[data-status="favorite"]')).toHaveCount(0);
  await expect(ordinaryRow.locator('.mybands-status-icon')).toHaveCount(0);

  const favoriteIconGeometry = await favoriteRow.locator('.mybands-status-icon[data-status="favorite"] svg').evaluate((svg) => ({
    width: svg.getAttribute('width'),
    height: svg.getAttribute('height'),
    fill: svg.getAttribute('fill'),
  }));
  expect(favoriteIconGeometry).toEqual({ width: '14', height: '14', fill: 'currentColor' });
  const mutedIconGeometry = await mutedRow.locator('.mybands-status-icon[data-status="muted"] svg').evaluate((svg) => ({
    width: svg.getAttribute('width'),
    height: svg.getAttribute('height'),
    stroke: svg.getAttribute('stroke'),
  }));
  expect(mutedIconGeometry).toEqual({ width: '14', height: '14', stroke: 'currentColor' });

  const trailingOrder = await favoriteRow.locator('.row-top').evaluate((rowTop) => [...rowTop.children].map((node) => node.className));
  expect(trailingOrder).toEqual(['row-title-group', 'mybands-row-trailing']);
  expect(await favoriteRow.locator('.mybands-row-trailing').evaluate((trailing) => [...trailing.children].map((node) => node.className))).toEqual(['mybands-status-icons', 'row-chevron']);

  const listFavoriteColor = await favoriteRow.locator('.mybands-status-icons').evaluate((node) => getComputedStyle(node).color);
  await page.screenshot({ path: testInfo.outputPath('v144-mybands-status-dark.png') });
  await favoriteRow.click();
  const profileFavorite = page.locator('#screen-profile .profile-favorite-btn');
  await expect(profileFavorite).toBeVisible();
  expect(await profileFavorite.evaluate((node) => getComputedStyle(node).color)).toBe(listFavoriteColor);
  await page.locator('#back-btn').click();
  await expect(page.locator('#screen-mybands')).toBeVisible();

  // App back arrow restores the same My Bands viewport instead of restarting
  // at the top of the shared #content scroller. Use a deliberately short
  // viewport here so the compact synthetic fixture list has a scrollable
  // range on both desktop and mobile CI runners.
  await page.setViewportSize({ width: desktop ? 480 : 375, height: 420 });
  const returnTarget = page.locator('#screen-mybands .row-card[data-band-id="qa-artist-seven"]');
  await returnTarget.scrollIntoViewIfNeeded();
  const beforeArrowBack = await page.evaluate(() => {
    const content = document.querySelector('#content');
    const row = document.querySelector('#screen-mybands .row-card[data-band-id="qa-artist-seven"]');
    const contentRect = content.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    return { scrollTop: content.scrollTop, offset: rowRect.top - contentRect.top };
  });
  expect(beforeArrowBack.scrollTop).toBeGreaterThan(0);
  await returnTarget.click();
  await expect(page.locator('#screen-profile')).toBeVisible();
  await page.locator('#back-btn').click();
  await expect(page.locator('#screen-mybands')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => document.querySelector('#content').scrollTop)).toBeGreaterThan(0);
  const afterArrowBack = await page.evaluate(() => {
    const content = document.querySelector('#content');
    const row = document.querySelector('#screen-mybands .row-card[data-band-id="qa-artist-seven"]');
    const contentRect = content.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    return { scrollTop: content.scrollTop, offset: rowRect.top - contentRect.top };
  });
  expect(Math.abs(afterArrowBack.offset - beforeArrowBack.offset)).toBeLessThanOrEqual(2);

  // Browser/system history uses the same popstate route as a phone back swipe.
  await returnTarget.click();
  await expect(page.locator('#screen-profile')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#screen-mybands')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => document.querySelector('#content').scrollTop)).toBeGreaterThan(0);
  const afterHistoryBack = await page.evaluate(() => {
    const content = document.querySelector('#content');
    const row = document.querySelector('#screen-mybands .row-card[data-band-id="qa-artist-seven"]');
    const contentRect = content.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    return { offset: rowRect.top - contentRect.top };
  });
  expect(Math.abs(afterHistoryBack.offset - beforeArrowBack.offset)).toBeLessThanOrEqual(2);

  // The return snapshot is one-shot. After the profile return is consumed,
  // later history navigation back to My Bands must not jump to that old band.
  await page.evaluate(() => { document.querySelector('#content').scrollTop = 0; });
  await page.locator('[data-tab="stats"]').click();
  await expect(page.locator('#screen-stats')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#screen-mybands')).toBeVisible();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => document.querySelector('#content').scrollTop)).toBe(0);

  // Favorite can change on the profile while the v126 My Bands DOM cache is
  // otherwise reusable; the v144 decorator must still refresh the list icon.
  const ordinaryFavoriteRow = page.locator('#screen-mybands .row-card[data-band-id="qa-artist-two"]');
  await ordinaryFavoriteRow.click();
  await page.locator('#screen-profile .profile-favorite-btn').click();
  await page.locator('#back-btn').click();
  await expect(page.locator('#screen-mybands .row-card[data-band-id="qa-artist-two"] .mybands-status-icon[data-status="favorite"]')).toHaveCount(1);

  // Genre bars and selected-year detail use the same stored band genres.
  // The fixture assignment is browser-local synthetic QA only.
  await page.locator('[data-tab="stats"]').click();
  await page.evaluate(() => {
    const assignments = {
      'qa-artist-one': 'alternative rock',
      'qa-artist-two': 'pop',
      'qa-artist-three': 'hip-hop',
      'qa-artist-four': 'electronic',
      'qa-artist-five': 'ambient',
      'qa-artist-six': 'rock',
      'qa-artist-seven': 'pop',
    };
    bands.forEach((band) => { if (assignments[band.id]) band.genre = assignments[band.id]; });
    renderStatsScreen();
  });
  const genreYear = page.locator('[data-v81-genre-year]').last();
  const selectedYear = Number(await genreYear.getAttribute('data-v81-genre-year'));
  await genreYear.click();
  const detail = page.locator('.genre-year-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toHaveAttribute('data-v144-genre-detail', 'true');
  await expect(detail).toHaveAttribute('data-v150-genre-rows', desktop ? 'full' : 'compact');
  await expect(detail.locator('div')).toHaveCount(6);
  expect(await page.evaluate(() => ListeningStats.genreDistributionByYear.__liveVaultV144 === true)).toBe(true);

  const expectedRockFull = await page.evaluate((year) => {
    const item = ListeningStats.genreDistributionByYear(listeningEvents).find((candidate) => candidate.year === year);
    const duration = ListeningStats.formatDuration(item.durations.Rock);
    const timePct = Math.round(item.percentages.Rock || 0);
    const listens = item.listenCounts.Rock || 0;
    const listenPct = Math.round(item.listenPercentages.Rock || 0);
    return `${duration} (${timePct} %) · ${listens.toLocaleString()} listen${listens === 1 ? '' : 's'} (${listenPct} %)`;
  }, selectedYear);
  const expectedRock = desktop
    ? expectedRockFull
    : expectedRockFull.replace(/\s+listens?(?=\s+\()/, '');
  const rockRow = detail.locator('div').filter({ hasText: /^Rock/ });
  await expect(rockRow.locator('span')).toHaveText(expectedRock);
  await expect(detail.locator('div').first().locator('span')).not.toContainText('%');

  const consistency = await page.evaluate((year) => {
    const item = ListeningStats.genreDistributionByYear(listeningEvents).find((candidate) => candidate.year === year);
    const groups = ListeningStats.GENRE_GROUPS;
    return {
      durationTotal: groups.reduce((sum, group) => sum + item.durations[group], 0),
      declaredDuration: item.totalDurationMs,
      listenTotal: groups.reduce((sum, group) => sum + item.listenCounts[group], 0),
      declaredListens: item.totalListenCount,
      nonZeroNamedGroups: groups.filter((group) => group !== 'Other' && item.listenCounts[group] > 0).length,
    };
  }, selectedYear);
  expect(consistency.durationTotal).toBe(consistency.declaredDuration);
  expect(consistency.listenTotal).toBe(consistency.declaredListens);
  expect(consistency.nonZeroNamedGroups).toBeGreaterThan(0);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await detail.scrollIntoViewIfNeeded();
  await detail.screenshot({ path: testInfo.outputPath('v144-genre-detail-dark.png') });
  await page.screenshot({ path: testInfo.outputPath('v144-aligned-listening-bands-dark.png'), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test('v144 visible additions remain contained in light mode', async ({ page }, testInfo) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  const desktop = testInfo.project.name === 'desktop-chromium';
  await page.setViewportSize(desktop ? { width: 480, height: 900 } : { width: 375, height: 820 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');

  await page.locator('[data-tab="mybands"]').click();
  const favoriteStatus = page.locator('#screen-mybands .row-card[data-band-id="qa-artist-one"] .mybands-status-icons');
  const mutedStatus = page.locator('#screen-mybands .row-card[data-band-id="qa-artist-three"] .mybands-status-icons');
  await expect(favoriteStatus.locator('[data-status="favorite"]')).toBeVisible();
  await expect(mutedStatus.locator('[data-status="muted"]')).toBeVisible();
  expect(await favoriteStatus.evaluate((node) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--text-secondary)';
    document.body.appendChild(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(node).color === expected;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('v144-mybands-status-light.png') });

  await page.locator('[data-tab="stats"]').click();
  await page.evaluate(() => {
    const assignments = {
      'qa-artist-one': 'alternative rock',
      'qa-artist-two': 'pop',
      'qa-artist-three': 'hip-hop',
      'qa-artist-four': 'electronic',
      'qa-artist-five': 'ambient',
      'qa-artist-six': 'rock',
      'qa-artist-seven': 'pop',
    };
    bands.forEach((band) => { if (assignments[band.id]) band.genre = assignments[band.id]; });
    renderStatsScreen();
  });
  await page.locator('[data-v81-genre-year]').last().click();
  const detail = page.locator('.genre-year-detail');
  await expect(detail).toHaveAttribute('data-v144-genre-detail', 'true');
  await expect(detail).toHaveAttribute('data-v150-genre-rows', desktop ? 'full' : 'compact');
  await expect(detail.locator('div')).toHaveCount(6);
  expect(await detail.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await detail.scrollIntoViewIfNeeded();
  await detail.screenshot({ path: testInfo.outputPath('v144-genre-detail-light.png') });

  await page.screenshot({ path: testInfo.outputPath('v144-aligned-listening-bands-light.png'), fullPage: true });
  expect(browserErrors).toEqual([]);
});
