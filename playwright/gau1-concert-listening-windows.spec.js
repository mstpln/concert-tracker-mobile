const { test, expect } = require('@playwright/test');

const SAFE_ORIGINS = new Set(['http://127.0.0.1:4173', 'https://qa.invalid', 'https://example.invalid']);

test('visible concert listening rows use GAU1 upcoming and recent-past windows', async ({ page }, testInfo) => {
  const pageErrors = [];
  const consoleErrors = [];
  const unexpectedRequests = [];
  await page.route('https://example.invalid/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" fill="#1261ff"/></svg>',
  }));
  page.on('request', (request) => {
    if (!SAFE_ORIGINS.has(new URL(request.url()).origin)) unexpectedRequests.push(request.url());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium'
    ? { width: 375, height: 820 }
    : { width: 480, height: 900 });
  await page.goto('/');

  await page.evaluate(() => {
    const listen = (id, localBandId, listenedAt) => ({
      id,
      localBandId,
      listenedAt,
      listenedDurationMs: 60000,
      recordingTitle: id,
      artistCreditName: localBandId === 'qa-artist-one' ? 'QA Artist One' : 'QA Artist Two',
    });
    const pastConcert = concerts.find((concert) => concert.id === 'qa-past-attended');
    pastConcert.bandId = 'qa-artist-two';
    pastConcert.bandName = 'QA Artist Two';
    listeningEvents = [
      listen('upcoming-lower-edge', 'qa-artist-one', '2027-01-16T12:00:00.000Z'),
      listen('before-upcoming-window', 'qa-artist-one', '2027-01-16T11:59:59.999Z'),
      listen('upcoming-current-edge', 'qa-artist-one', '2027-07-16T12:00:00.000Z'),
      listen('upcoming-future', 'qa-artist-one', '2027-07-16T12:00:00.001Z'),
      listen('past-lower-edge', 'qa-artist-two', '2027-02-01T00:00:00.000Z'),
      listen('before-past-window', 'qa-artist-two', '2027-01-31T23:59:59.999Z'),
      listen('past-current-edge', 'qa-artist-two', '2027-07-16T12:00:00.000Z'),
      listen('past-future', 'qa-artist-two', '2027-07-16T12:00:00.001Z'),
    ];
    renderMyConcertsScreen();
  });

  const upcomingCard = page.locator('.concert-prep-group[data-concert-id="qa-show-day"]').locator('xpath=ancestor::div[contains(@class,"row-card-mc")]');
  const pastCard = page.locator('.past-concert-details-group[data-concert-id="qa-past-attended"]').locator('xpath=ancestor::div[contains(@class,"row-card-mc")]');
  await expect(upcomingCard.locator('.concert-listening-row')).toContainText('2 min · 2 listens');
  await expect(pastCard.locator('.concert-listening-row')).toContainText('2 min · 2 listens');
  await expect(upcomingCard.locator('.concert-listening-row')).toBeVisible();
  await expect(pastCard.locator('.concert-listening-row')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(unexpectedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);

  await upcomingCard.locator('.concert-listening-row').screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-gau1-upcoming-listening-row.png`),
  });
  await pastCard.locator('.concert-listening-row').screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-gau1-past-listening-row.png`),
  });
});
