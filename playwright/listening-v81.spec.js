const { test, expect } = require('@playwright/test');

async function textContents(locator) {
  return (await locator.allTextContents()).map((value) => value.trim());
}

async function summaryGeometry(card) {
  return card.evaluate((element) => {
    const metrics = [...element.querySelectorAll('.listening-summary-metric')].map((node) => node.getBoundingClientRect());
    const overlap = metrics.some((a, index) => metrics.some((b, other) => other > index && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1));
    const textOverflow = [...element.querySelectorAll('.listening-summary-metric strong, .listening-summary-metric > span:last-child')]
      .some((node) => node.scrollWidth > node.clientWidth + 1);
    return { overlap, overflow: element.scrollWidth > element.clientWidth + 1, textOverflow };
  });
}

test('v82 listening corrections remain usable, bounded, independent, and responsive', async ({ page }, testInfo) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  const desktop = testInfo.project.name === 'desktop-chromium';
  await page.setViewportSize(desktop ? { width: 480, height: 900 } : { width: 375, height: 820 });
  await page.goto('/');

  await expect(page.locator('.start-top-bands-card')).toContainText('YOUR TOP BANDS · 2 WEEKS');
  await expect(page.locator('#start-version-refresh')).toContainText('v92');
  const refreshButton = page.getByRole('button', { name: 'Check for app update and reload' });
  await expect(refreshButton).toBeVisible();
  const refreshGeometry = await page.evaluate(() => {
    const button = document.querySelector('.start-refresh-btn');
    const svg = button?.querySelector('svg');
    const settings = document.querySelector('#settings-btn');
    if (!button || !svg || !settings) return null;
    const b = button.getBoundingClientRect();
    const s = svg.getBoundingClientRect();
    const g = settings.getBoundingClientRect();
    return {
      contained: s.left >= b.left - 1 && s.right <= b.right + 1 && s.top >= b.top - 1 && s.bottom <= b.bottom + 1,
      centerDelta: Math.abs((b.top + b.height / 2) - (g.top + g.height / 2)),
      pathCount: svg.querySelectorAll('path').length,
      viewBox: svg.getAttribute('viewBox'),
    };
  });
  expect(refreshGeometry).not.toBeNull();
  expect(refreshGeometry.contained).toBe(true);
  expect(refreshGeometry.centerDelta).toBeLessThanOrEqual(1);
  expect(refreshGeometry.pathCount).toBe(2);
  expect(refreshGeometry.viewBox).toBe('0 0 24 24');

  const startFortnightText = await page.locator('.start-top-bands-card .top-band-row').first().innerText();
  await page.getByRole('button', { name: 'View all' }).first().click();
  await expect(page.getByRole('button', { name: '3 months' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '2 weeks' }).click();
  const topFortnightText = await page.locator('.full-top-bands-card .top-band-row').first().innerText();
  expect(topFortnightText).toBe(startFortnightText);
  await page.getByRole('button', { name: 'All time' }).click();
  const allTimeText = await page.locator('.full-top-bands-card .top-band-row').first().innerText();
  expect(allTimeText).not.toBe(topFortnightText);

  await page.getByRole('button', { name: '2 weeks' }).click();
  await page.locator('.full-top-bands-card .top-band-row').first().click();
  const profile = page.locator('#screen-profile');
  await expect(profile.getByRole('tab', { name: 'Listening', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(profile.getByRole('button', { name: '1 year' })).toHaveAttribute('aria-pressed', 'true');
  await expect(profile.getByRole('tab', { name: 'Top Tracks' })).toHaveAttribute('aria-selected', 'true');

  await profile.getByRole('button', { name: '2 weeks' }).click();
  const profileFortnight = await profile.locator('.listening-summary-band').innerText();
  const topValues = topFortnightText.split('\n').map((value) => value.trim()).filter(Boolean);
  const topValueLine = topValues.find((value) => /\blistens?\b/.test(value) && /\b(?:h|min)\b/.test(value));
  expect(topValueLine).toBeTruthy();
  const [topDuration, topCount] = topValueLine.split('·').map((value) => value.trim());
  expect(profileFortnight).toContain(topDuration);
  expect(profileFortnight).toContain(topCount.replace(/ listens?$/, ''));

  await profile.getByRole('button', { name: 'All time' }).click();
  const profileAllTime = await profile.locator('.listening-summary-band').innerText();
  expect(profileAllTime).not.toBe(profileFortnight);

  const profileCard = profile.locator('.listening-summary-band');
  expect(await summaryGeometry(profileCard)).toEqual({ overlap: false, overflow: false, textOverflow: false });

  await profileCard.evaluate((card) => {
    const values = ['1,234 h 56 min', '12,345', '#87 ↑12', 'September 30, 2009', 'September 30, 2027'];
    card.querySelectorAll('.listening-summary-metric strong').forEach((node, index) => { node.textContent = values[index]; });
  });
  const widths = desktop ? [480, 768, 1024] : [375];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    expect(await summaryGeometry(profileCard)).toEqual({ overlap: false, overflow: false, textOverflow: false });
  }

  await profile.getByRole('button', { name: '3 months' }).click();
  await profile.getByRole('tab', { name: 'Top Albums' }).click();
  await expect(profile.getByRole('tab', { name: 'Top Albums' })).toHaveAttribute('aria-selected', 'true');
  await profile.getByRole('tab', { name: 'Concerts', exact: true }).click();
  await profile.getByRole('tab', { name: 'Listening', exact: true }).click();
  await expect(profile.getByRole('button', { name: '3 months' })).toHaveAttribute('aria-pressed', 'true');
  await expect(profile.getByRole('tab', { name: 'Top Albums' })).toHaveAttribute('aria-selected', 'true');

  await page.locator('[data-tab="stats"]').click();
  await expect(page.locator('.listening-summary-global .listening-summary-metric')).toHaveCount(3);
  await expect(page.locator('.yearly-listening-card')).toContainText('LISTENING HOURS BY YEAR');
  await expect(page.locator('.genre-card')).toContainText('LISTENING BY GENRE (ALL TIME)');
  await expect(page.locator('.full-top-bands-card, .top-bands-card').first()).toBeVisible();
  await expect(page.locator('.year-genre-pill')).toHaveCount(6);

  await page.evaluate(() => {
    window.__v82OriginalGenreDistribution = ListeningStats.genreDistributionByYear;
    ListeningStats.genreDistributionByYear = () => { throw new Error('Synthetic forced chart failure'); };
    renderStatsScreen();
  });
  await expect(page.locator('.listening-summary-global .listening-summary-metric')).toHaveCount(3);
  await expect(page.locator('.top-bands-card')).toContainText('TOP BANDS · 3 MONTHS');
  await expect(page.locator('.top-bands-card')).toContainText('Some listening charts could not be displayed');
  await page.evaluate(() => {
    ListeningStats.genreDistributionByYear = window.__v82OriginalGenreDistribution;
    delete window.__v82OriginalGenreDistribution;
    renderStatsScreen();
  });
  await expect(page.locator('.yearly-listening-card')).toContainText('LISTENING HOURS BY YEAR');
  await expect(page.locator('.genre-card')).toContainText('LISTENING BY GENRE (ALL TIME)');

  const allPill = page.locator('[data-v81-year-genre="All"]');
  const allPillContrast = await allPill.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  });
  expect(allPillContrast.color).not.toBe(allPillContrast.background);

  const initialGenreYears = await textContents(page.locator('[data-v81-genre-year] > span:last-child'));
  await page.getByRole('button', { name: 'Show older listening years' }).click();
  expect(await textContents(page.locator('[data-v81-genre-year] > span:last-child'))).toEqual(initialGenreYears);
  const shiftedListeningYears = await textContents(page.locator('[data-v81-year-point] text'));
  await page.getByRole('button', { name: 'Show older genre years' }).click();
  expect(await textContents(page.locator('[data-v81-year-point] text'))).toEqual(shiftedListeningYears);

  await page.locator('[data-v81-year-point] circle').first().click();
  await expect(page.locator('.year-detail')).toBeVisible();
  await page.locator('[data-v81-genre-year]').first().click();
  await expect(page.locator('.year-detail')).toBeVisible();
  await expect(page.locator('.genre-year-detail')).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(browserErrors).toEqual([]);
});
