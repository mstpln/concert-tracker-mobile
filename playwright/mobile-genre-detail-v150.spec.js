const { test, expect } = require('@playwright/test');

const REPRESENTATIVE_VALUES = {
  Total: '229 h 31 min · 4,307 listens',
  Rock: '200 h 06 min (87 %) · 3,701 listens (86 %)',
  Pop: '23 h 46 min (10 %) · 493 listens (11 %)',
  'Hip-hop/R&B': '2 h 26 min (1 %) · 48 listens (1 %)',
  Electronic: '41 min (0 %) · 14 listens (0 %)',
  Other: '2 h 32 min (1 %) · 51 listens (1 %)',
};

async function openGenreDetail(page) {
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
      await expect(detail).toHaveAttribute('data-v150-genre-rows', 'compact');
      await expect(rows.filter({ hasText: /^Rock/ }).locator('span')).toHaveText('200 h 06 min (87 %) · 3,701 (86 %)');
      await expect(rows.first().locator('span')).toHaveText('229 h 31 min · 4,307 listens');
      await expect(rows.nth(1).locator('span')).not.toContainText('listens');
      await expect(detail).toHaveClass(/v150-genre-fit/);
    } else {
      await expect(detail).toHaveAttribute('data-v150-genre-rows', 'full');
      await expect(rows.filter({ hasText: /^Rock/ }).locator('span')).toHaveText(REPRESENTATIVE_VALUES.Rock);
      await expect(detail).not.toHaveClass(/v150-genre-fit/);
    }

    const geometry = await expectSingleLineDetail(detail);
    if (mobile) expect(geometry.rows.every((row) => row.whiteSpace === 'nowrap')).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await detail.scrollIntoViewIfNeeded();
    await detail.screenshot({ path: testInfo.outputPath(`v150-genre-detail-${colorScheme}.png`) });
    expect(browserErrors).toEqual([]);
  });
}

test('v150 keeps 414px phone rows compact and single-line', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.setViewportSize({ width: 414, height: 896 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');

  const detail = await openGenreDetail(page);
  const rows = detail.locator(':scope > div');
  await expect(detail).toHaveAttribute('data-v150-genre-rows', 'compact');
  await expect(detail).toHaveClass(/v150-genre-fit/);
  await expect(rows.filter({ hasText: /^Rock/ }).locator('span')).toHaveText('200 h 06 min (87 %) · 3,701 (86 %)');
  await expectSingleLineDetail(detail);
  expect(browserErrors).toEqual([]);
});

test('v150 wider fallback measures the original flex layout before compacting', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.setViewportSize({ width: 480, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');

  const detail = await openGenreDetail(page);
  await expect(detail).toHaveAttribute('data-v150-genre-rows', 'full');

  await detail.evaluate((node) => {
    node.style.width = '340px';
    StartStatsV149.applyGenreDetailFit();
  });

  await expect(detail).toHaveAttribute('data-v150-genre-rows', 'compact');
  await expect(detail).toHaveClass(/v150-genre-fit/);
  await expect(detail.locator('div').filter({ hasText: /^Rock/ }).locator('span')).not.toContainText('listens');
  await expectSingleLineDetail(detail);
  expect(browserErrors).toEqual([]);
});
