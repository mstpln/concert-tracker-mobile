const { test, expect } = require('@playwright/test');

const LOCAL_ORIGIN = 'http://127.0.0.1:4173';
const SYNTHETIC_ORIGINS = new Set([LOCAL_ORIGIN, 'https://qa.invalid', 'https://example.invalid']);

async function installQaGuards(page) {
  const unexpectedRequests = [];
  const pageErrors = [];
  const consoleErrors = [];

  await page.route('https://example.invalid/**', async (route) => {
    if (/\/images\//.test(route.request().url())) {
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" fill="#1261ff"/></svg>' });
      return;
    }
    await route.fulfill({ status: 204, body: '' });
  });

  page.on('request', (request) => {
    const origin = new URL(request.url()).origin;
    if (!SYNTHETIC_ORIGINS.has(origin)) unexpectedRequests.push(request.url());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  return () => {
    expect(unexpectedRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  };
}

async function settleVisual(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test('synthetic app starts, navigates, persists checklist, and resets', async ({ page }, testInfo) => {
  const assertQaGuards = await installQaGuards(page);
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
  await expect(page.locator('#onboarding')).toBeHidden();
  await page.getByRole('button', { name: 'Bands' }).click();
  await expect(page.locator('#screen-mybands')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}.png`), fullPage: true });
  await page.locator('#tabbar [data-tab="myconcerts"]').click();
  const prepGroup = page.locator('.concert-prep-group[data-concert-id="qa-show-day"]');
  await prepGroup.locator('[data-prep-toggle="checklist"]').click();
  const prepKey = await prepGroup.locator('input[data-prep-key]:not(:checked)').first().getAttribute('data-prep-key');
  expect(prepKey).toBeTruthy();
  const targetCheckbox = prepGroup.locator(`input[data-prep-key="${prepKey}"]`);
  await expect(targetCheckbox).toBeVisible();
  await targetCheckbox.click();
  await expect.poll(async () => page.evaluate(({ concertId, key }) => {
    const stored = JSON.parse(localStorage.getItem('livevault-qa:data') || '{}');
    const concert = (stored.concerts || []).find((item) => item.id === concertId);
    return concert?.prepChecklist?.[key] === true;
  }, { concertId: 'qa-show-day', key: prepKey })).toBe(true);
  await page.reload();
  const reloadedGroup = page.locator('.concert-prep-group[data-concert-id="qa-show-day"]');
  await reloadedGroup.locator('[data-prep-toggle="checklist"]').click();
  await expect(reloadedGroup.locator(`input[data-prep-key="${prepKey}"]`)).toBeChecked();
  await page.getByTestId('qa-reset').click();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('qa-banner')).toBeVisible();
  const storageKeys = await page.evaluate(() => Object.keys(localStorage));
  expect(storageKeys).not.toContain('concertTrackerRemoteConnection');
  expect(storageKeys).not.toContain('concertTrackerSettings');
  expect(storageKeys).not.toContain('spotifyUserAuthorization');
  expect(storageKeys).not.toContain('spotifyUserPkcePending');
  assertQaGuards();
  await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
});

test('primary screens, settings, and v135 band profile tabs remain navigable', async ({ page }) => {
  const assertQaGuards = await installQaGuards(page);
  await page.goto('/');
  await expect(page.locator('#screen-myconcerts')).toBeVisible();
  await page.getByRole('button', { name: 'Dates' }).click();
  await expect(page.locator('#screen-concerts')).toBeVisible();
  await page.getByRole('button', { name: 'Alerts' }).click();
  await expect(page.locator('#screen-news')).toBeVisible();
  await expect(page.locator('#screen-news [role="tablist"]')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Releases', exact: true })).toHaveCount(0);
  await expect(page.locator('.release-alert-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Bands' }).click();
  const bandsScreen = page.locator('#screen-mybands');
  await expect(bandsScreen).toBeVisible();
  await bandsScreen.getByText('QA Artist One', { exact: true }).click();
  await expect(page.locator('#screen-profile')).toBeVisible();
  for (const tabName of ['Concerts', 'Alerts', 'Listening', 'Data']) {
    await page.getByRole('tab', { name: tabName, exact: true }).click();
    await expect(page.getByRole('tab', { name: tabName, exact: true })).toHaveAttribute('aria-selected', 'true');
  }
  await expect(page.getByRole('tab', { name: 'Releases', exact: true })).toHaveCount(0);
  await page.getByTestId('back-button').click();
  await expect(page.locator('#screen-mybands')).toBeVisible();
  await page.getByTestId('settings-button').click();
  await expect(page.locator('#screen-settings')).toBeVisible();
  await page.getByTestId('back-button').click();
  await expect(page.locator('#screen-mybands')).toBeVisible();
  assertQaGuards();
  await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
});

test('listening stats navigation, rankings, timeframes, and band drill-down use synthetic local data', async ({ page }, testInfo) => {
  const assertQaGuards = await installQaGuards(page);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium' ? { width: 375, height: 820 } : { width: 480, height: 900 });
  await page.goto('/');
  const navLabels = await page.getByTestId('bottom-navigation').locator('.tabitem').allTextContents();
  expect(navLabels.map((label) => label.trim())).toEqual(['Music', 'Dates', 'Bands', 'Stats', 'Alerts']);
  await expect(page.locator('.start-top-bands-card .top-band-row')).toHaveCount(3);
  await expect(page.locator('.start-top-bands-card')).toContainText('YOUR TOP BANDS · 2 WEEKS');
  await settleVisual(page);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-start-listening.png`) });
  await page.getByRole('button', { name: 'See your full concert stats' }).click();
  await expect(page.getByRole('tab', { name: 'Concerts', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page.locator('#screen-myconcerts')).toBeVisible();
  await page.locator('#start-top-bands-view-all').click();
  await expect(page.locator('#screen-top-bands')).toBeVisible();
  await page.getByTestId('back-button').click();
  await expect(page.locator('#screen-myconcerts')).toBeVisible();
  await page.getByRole('button', { name: 'See your listening stats' }).click();
  await expect(page.locator('#screen-stats')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Listening', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.listening-summary')).toContainText('YOUR LISTENING · 3 MONTHS');
  await expect(page.locator('.genre-card')).toBeVisible();
  await expect(page.locator('.top-bands-card .top-band-row')).toHaveCount(7);
  await expect(page.locator('.top-bands-card .top-band-row-extra')).toHaveCount(0);
  await settleVisual(page);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-listening-stats.png`) });
  await page.getByRole('tab', { name: 'Concerts', exact: true }).click();
  await expect(page.locator('#stats-tab-panel')).toContainText('Overview');
  await expect(page.locator('#stats-tab-panel')).toContainText('concert nights attended');
  await page.getByRole('tab', { name: 'Listening', exact: true }).click();
  await page.getByRole('button', { name: 'View full top 100' }).click();
  await expect(page.locator('#screen-top-bands')).toBeVisible();
  await expect(page.locator('.full-top-bands-card .top-band-row').first()).toContainText('#1');
  await page.getByRole('button', { name: '1 year' }).click();
  await expect(page.getByRole('button', { name: '1 year' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'All time' }).click();
  await expect(page.locator('.full-top-bands-card .rank-movement')).toHaveCount(0);
  await page.getByRole('button', { name: '3 months' }).click();
  await page.locator('.full-top-bands-card .top-band-row').first().click();
  await expect(page.locator('#screen-profile')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Listening', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.band-listening-panel .listening-summary')).toBeVisible();
  await expect(page.locator('.band-listening-panel .listening-line-chart')).toBeVisible();
  await expect(page.locator('.band-listening-panel .top-track-row')).toHaveCount(10);
  const firstTrackArtwork = page.locator('.band-listening-panel .top-track-row img').first();
  await expect(firstTrackArtwork).toBeVisible();
  expect(await firstTrackArtwork.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '1 year' }).click();
  await expect(page.locator('.band-listening-panel .listening-summary')).toContainText('YOUR LISTENING · 1 YEAR');
  await page.getByRole('button', { name: 'All time' }).click();
  await expect(page.locator('.band-listening-panel .listening-summary')).toContainText('YOUR LISTENING · ALL TIME');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  assertQaGuards();
});

test('listening empty and missing-artwork states remain usable', async ({ page }) => {
  const assertQaGuards = await installQaGuards(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Bands' }).click();
  await page.locator('#screen-mybands').getByText('QA Empty Profile Artist', { exact: true }).click();
  await page.getByRole('tab', { name: 'Listening', exact: true }).click();
  await expect(page.locator('.band-listening-panel')).toContainText('No listening data is available for this period.');
  await expect(page.locator('.listening-attribution')).toContainText('Listening data from ListenBrainz');
  await page.getByTestId('back-button').click();
  await page.locator('#screen-mybands').getByText('Synthetic Ensemble', { exact: true }).click();
  await page.getByRole('tab', { name: 'Listening', exact: true }).click();
  await expect(page.locator('.band-listening-panel .track-artwork.is-placeholder').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  assertQaGuards();
});

test('v135 release surfaces stay retired in light and dark mode', async ({ page }) => {
  const assertQaGuards = await installQaGuards(page);
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await page.getByRole('button', { name: 'Alerts' }).click();
    await expect(page.locator('#screen-news [role="tablist"]')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Releases', exact: true })).toHaveCount(0);
    await expect(page.locator('.release-alert-card')).toHaveCount(0);
    await page.getByRole('button', { name: 'Bands' }).click();
    await page.locator('#screen-mybands').getByText('QA Artist One', { exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Releases', exact: true })).toHaveCount(0);
    await expect(page.locator('#screen-profile .release-alert-card')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  assertQaGuards();
});
