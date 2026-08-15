const { test, expect } = require('@playwright/test');

async function openListeningMaintenance(page) {
  const screen = page.locator('#screen-settings');
  await screen.getByRole('tab', { name: 'Data', exact: true }).click();
  const maintenance = screen.locator('.settings-v123-maintenance');
  if (!(await maintenance.getAttribute('open'))) await maintenance.locator('summary').click();
  return maintenance.locator('.settings-v123-maintenance-row').filter({ hasText: 'Listening statistics' });
}

test('v92 activates cleaned listening totals only after explicit confirmation and can restore originals', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto('/');

  await page.evaluate(async () => {
    const events = [
      {
        stableListenId: 'qa-activation-a',
        listenedAt: '2026-01-01T12:00:00.000Z',
        artistCreditName: 'QA Activation Artist',
        recordingTitle: 'QA Activation Track',
        source: 'spotify_import',
        listenedDurationMs: 180000,
      },
      {
        stableListenId: 'qa-activation-b',
        listenedAt: '2026-01-01T12:00:00.500Z',
        artistCreditName: 'QA Activation Artist',
        recordingTitle: 'QA Activation Track',
        source: 'listenbrainz',
        listenedDurationMs: 180000,
      },
    ];
    listeningEvents = structuredClone(events);
    LiveVaultSpotifyHistory = { loadEvents: async () => structuredClone(events) };
    await BandmarkrListeningDerivedStorage.putIdentities(events.map((event) => ({
      sourceEventId: event.stableListenId,
      identityVersion: 1,
      localBandId: null,
      status: 'unresolved',
    })));
    await BandmarkrListeningDerivedStorage.putCanonicalBatch([
      {
        sourceEventId: 'qa-activation-a',
        dedupeVersion: 1,
        canonicalListenId: 'qa-activation-a',
        duplicateOf: null,
        status: 'unique',
      },
      {
        sourceEventId: 'qa-activation-b',
        dedupeVersion: 1,
        canonicalListenId: 'qa-activation-a',
        duplicateOf: 'qa-activation-a',
        status: 'user_reviewed',
      },
    ]);
    localStorage.setItem('bandmarkr-listening-canonical-activation-v1', JSON.stringify({
      stateVersion: 1,
      status: 'ready',
      sourceEventCount: 2,
      canonicalRecordCount: 2,
      duplicateCount: 1,
      reviewGroupCount: 0,
      preparedAt: '2026-01-01T12:05:00.000Z',
      activatedAt: null,
      error: null,
    }));
  });

  await page.getByTestId('settings-button').click();
  let card = await openListeningMaintenance(page);
  await expect(card).toContainText('Reviewed listening totals are ready to use.');
  await expect(card.getByRole('button', { name: 'Use reviewed totals' })).toBeVisible();
  expect(await page.evaluate(() => listeningEvents.length)).toBe(2);

  await card.getByRole('button', { name: 'Use reviewed totals' }).click();
  card = await openListeningMaintenance(page);
  await expect(card).toContainText('Reviewed listening totals are active.');
  await expect(card.getByRole('button', { name: 'Use original totals' })).toBeVisible();
  expect(await page.evaluate(() => listeningEvents.map((event) => event.stableListenId))).toEqual(['qa-activation-a']);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bandmarkr-listening-canonical-activation-v1')).status)).toBe('active');

  await card.getByRole('button', { name: 'Use original totals' }).click();
  card = await openListeningMaintenance(page);
  await expect(card).toContainText('Reviewed listening totals are ready to use.');
  expect(await page.evaluate(() => listeningEvents.map((event) => event.stableListenId))).toEqual(['qa-activation-a', 'qa-activation-b']);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bandmarkr-listening-canonical-activation-v1')).status)).toBe('ready');
  expect(browserErrors).toEqual([]);
});

test('v92 fails closed when listening history changes after activation', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const state = {
      stateVersion: 1,
      status: 'active',
      sourceEventCount: 2,
      canonicalRecordCount: 2,
      duplicateCount: 0,
      activatedAt: '2026-01-01T12:05:00.000Z',
    };
    localStorage.setItem('bandmarkr-listening-canonical-activation-v1', JSON.stringify(state));
    listeningEvents = [{ stableListenId: 'only-one' }];
    return BandmarkrListeningCanonicalActivation.applyToApp({ events: listeningEvents });
  });
  expect(result.applied).toBe(false);
  expect(result.reason).toContain('changed');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bandmarkr-listening-canonical-activation-v1')).status)).toBe('stale');
  expect(await page.evaluate(() => listeningEvents.length)).toBe(1);
});
