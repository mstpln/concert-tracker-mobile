const { test, expect } = require('@playwright/test');

const REPRESENTATIVE_VALUES = {
  Total: '229 h 31 min · 4,307 listens',
  Rock: '200 h 06 min (87 %) · 3,701 listens (86 %)',
  Pop: '23 h 46 min (10 %) · 493 listens (11 %)',
  'Hip-hop/R&B': '2 h 26 min (1 %) · 48 listens (1 %)',
  Electronic: '41 min (0 %) · 14 listens (0 %)',
  Other: '2 h 32 min (1 %) · 51 listens (1 %)',
};

async function prepareGenreStats(page) {
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
}

async function openGenreDetail(page) {
  await prepareGenreStats(page);
  await page.locator('[data-v81-genre-year]').last().click();
  const detail = page.locator('.genre-year-detail');
  await expect(detail).toHaveAttribute('data-v144-genre-detail', 'true');
  // This assertion deliberately happens before the test calls the formatter
  // directly. It protects the real click/render path used by the installed app.
  await expect(detail).toHaveAttribute('data-v150-genre-rows', /^(compact|full)$/);
  await page.evaluate((values) => {
    const detailNode = document.querySelector('.genre-year-detail');
    [...detailNode.querySelectorAll(':scope > div')].forEach((row) => {
      const label = row.querySelector(':scope > b')?.textContent?.trim();
      const value = row.querySelector(':scope > span');
      if (!label || !value || !values[label]) return;
      value.textContent = values[label];
      value.dataset.v150FullValue = values[label];
    });
    StartStatsV149.applyGenreDetailFit();
  }, REPRESENTATIVE_VALUES);
  return detail;
}

async function expectSingleLineDetail(detail) {
  const geometry = await detail.evaluate((node) => ({
    detailOverflow: node.scrollWidth > node.clientWidth + 1,
    rows: [...node.querySelectorAll(':scope > div')].map((row) => {
      const value = row.querySelector(':scope > span');
      const rowBox = row.getBoundingClientRect();
      return {
        rowHeight: rowBox.height,
        valueOverflow: value ? value.scrollWidth > value.clientWidth + 1 : false,
        whiteSpace: value ? getComputedStyle(value).whiteSpace : '',
      };
    }),
  }));
  expect(geometry.detailOverflow).toBe(false);
  expect(geometry.rows.every((row) => row.valueOverflow === false)).toBe(true);
  expect(geometry.rows.every((row) => row.rowHeight < 20)).toBe(true);
  return geometry;
}

async function expectCompactGenreDetail(detail) {
  const rows = detail.locator(':scope > div');
  await expect(detail).toHaveAttribute('data-v150-genre-rows', 'compact');
  await expect(detail).toHaveClass(/v150-genre-fit/);
  await expect(rows.filter({ hasText: /^Rock/ }).locator('span')).toHaveText('200 h 06 min (87 %) · 3,701 (86 %)');
  await expect(rows.first().locator('span')).toHaveText('229 h 31 min · 4,307 listens');
  await expect(rows.nth(1).locator('span')).not.toContainText('listens');
  const geometry = await expectSingleLineDetail(detail);
  expect(geometry.rows.every((row) => row.whiteSpace === 'nowrap')).toBe(true);
}

test('v151 live selected-year click applies compact formatting without a direct formatter call', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.setViewportSize({ width: 375, height: 820 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');

  await prepareGenreStats(page);
  await page.locator('[data-v81-genre-year]').last().click();
  const detail = page.locator('.genre-year-detail');
  const rockValue = detail.locator(':scope > div').filter({ hasText: /^Rock/ }).locator('span');
  await expect(detail).toHaveAttribute('data-v144-genre-detail', 'true');
  await expect(detail).toHaveAttribute('data-v150-genre-rows', 'compact');
  await expect(detail).toHaveClass(/v150-genre-fit/);
  await expect(rockValue).not.toContainText('listens');
  await expectSingleLineDetail(detail);
  expect(browserErrors).toEqual([]);
});

for (const colorScheme of ['dark', 'light']) {
  test(`v150 selected-year genre rows stay single-line in ${colorScheme} mode`, async ({ page }, testInfo) => {
    const browserErrors = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    const mobile = testInfo.project.name === 'mobile-chromium';
    await page.setViewportSize(mobile ? { width: 375, height: 820 } : { width: 480, height: 900 });
    await page.emulateMedia({ colorScheme });
    await page.goto('/');

    const detail = await openGenreDetail(page);
    const rows = detail.locator(':scope > div');
    await expect(rows).toHaveCount(6);

    if (mobile) {
      await expectCompactGenreDetail(detail);
    } else {
      await expect(detail).toHaveAttribute('data-v150-genre-rows', 'full');
      await expect(rows.filter({ hasText: /^Rock/ }).locator('span')).toHaveText(REPRESENTATIVE_VALUES.Rock);
      await expect(detail).not.toHaveClass(/v150-genre-fit/);
      await expectSingleLineDetail(detail);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await detail.scrollIntoViewIfNeeded();
    await detail.screenshot({ path: testInfo.outputPath(`v150-genre-detail-${colorScheme}.png`) });
    expect(browserErrors).toEqual([]);
  });
}

for (const width of [414, 440, 479]) {
  test(`v150 keeps ${width}px phone rows compact and single-line`, async ({ page }) => {
    const browserErrors = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.setViewportSize({ width, height: 896 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');

    const detail = await openGenreDetail(page);
    await expectCompactGenreDetail(detail);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(browserErrors).toEqual([]);
  });
}

test('v150 preserves full desktop wording at 480px', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.setViewportSize({ width: 480, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');

  const detail = await openGenreDetail(page);
  const rockValue = detail.locator('div').filter({ hasText: /^Rock/ }).locator('span');
  await expect(detail).toHaveAttribute('data-v150-genre-rows', 'full');
  await expect(detail).not.toHaveClass(/v150-genre-fit/);
  await expect(rockValue).toHaveText(REPRESENTATIVE_VALUES.Rock);
  await expectSingleLineDetail(detail);
  expect(browserErrors).toEqual([]);
});
