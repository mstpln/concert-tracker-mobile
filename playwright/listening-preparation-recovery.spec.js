const { test, expect } = require('@playwright/test');

test('v93 recovers a stalled preparation after a lock-style resume without reloading', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('settings-button').click();
  await page.getByRole('tab', { name: 'Review', exact: true }).click();

  await page.evaluate(() => {
    localStorage.setItem('bandmarkr-listening-canonical-activation-v1', JSON.stringify({
      stateVersion: 1,
      status: 'preparing',
      sourceEventCount: 0,
      canonicalRecordCount: 0,
      duplicateCount: 0,
      reviewGroupCount: 0,
      preparedAt: null,
      activatedAt: null,
      error: null,
    }));
    localStorage.setItem('bandmarkr-listening-derived-migration-v1', JSON.stringify({
      migrationVersion: 1,
      status: 'pending',
      processedEvents: 1500,
      sourceEventCountAfter: 5000,
    }));
    BandmarkrListeningPreparationRecovery.renderCurrentProgress(localStorage);
  });

  const card = page.locator('[data-canonical-activation]');
  await expect(card).toContainText('Preparing cleaned totals on this device');

  const result = await page.evaluate(async () => {
    const recovery = BandmarkrListeningPreparationRecovery;
    await recovery.monitorTick(localStorage, 1000);
    return recovery.monitorTick(localStorage, 1000 + recovery.STALL_TIMEOUT_MS);
  });

  expect(result.recovered).toBe(true);
  await expect(card).toContainText('Preparation stopped safely: Preparation was interrupted');
  await expect(card.getByRole('button', { name: 'Prepare again' })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bandmarkr-listening-derived-migration-v1')).processedEvents)).toBe(1500);
});

test('v93 keeps active post-migration work running while its heartbeat is fresh', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('settings-button').click();
  await page.getByRole('tab', { name: 'Review', exact: true }).click();

  const result = await page.evaluate(async () => {
    const recovery = BandmarkrListeningPreparationRecovery;
    const now = Date.now();
    localStorage.setItem('bandmarkr-listening-canonical-activation-v1', JSON.stringify({
      stateVersion: 1,
      status: 'preparing',
      preparationPhase: 'persisting-candidates',
      preparationHeartbeatAt: new Date(now - 1000).toISOString(),
      error: null,
    }));
    localStorage.setItem('bandmarkr-listening-derived-migration-v1', JSON.stringify({
      migrationVersion: 1,
      status: 'complete',
      processedEvents: 5000,
      sourceEventCountAfter: 5000,
      integrityStatus: 'passed',
    }));
    recovery.renderCurrentProgress(localStorage);
    await recovery.monitorTick(localStorage, now - recovery.STALL_TIMEOUT_MS);
    return recovery.monitorTick(localStorage, now);
  });

  expect(result.recovered).toBe(false);
  expect(result.state.status).toBe('preparing');
  const card = page.locator('[data-canonical-activation]');
  await expect(card).toContainText('Saving confirmed and possible duplicate matches');
  await expect(card.getByRole('button', { name: 'Prepare again' })).toBeHidden();
});
