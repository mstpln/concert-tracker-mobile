const { test, expect } = require('@playwright/test');

test('v93 recovers a stalled preparation after a lock-style resume without reloading', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('settings-button').click();
  await page.getByRole('tab', { name: 'Review', exact: true }).click();

  const result = await page.evaluate(() => {
    const recovery = BandmarkrListeningPreparationRecovery;
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
    recovery.renderCurrentProgress(localStorage);
    recovery.checkForStalledPreparation(localStorage, 1000);
    const recovered = recovery.checkForStalledPreparation(localStorage, 1000 + recovery.STALL_TIMEOUT_MS);
    if (recovered.recovered) recovery.renderInterruptedState();
    return {
      recovered: recovered.recovered,
      state: JSON.parse(localStorage.getItem('bandmarkr-listening-canonical-activation-v1')),
      checkpoint: JSON.parse(localStorage.getItem('bandmarkr-listening-derived-migration-v1')),
    };
  });

  expect(result.recovered).toBe(true);
  expect(result.state.status).toBe('error');
  expect(result.state.error).toContain('interrupted');
  expect(result.checkpoint.processedEvents).toBe(1500);

  const card = page.locator('[data-canonical-activation]');
  await expect(card).toContainText('Preparation stopped safely: Preparation was interrupted');
  await expect(card.getByRole('button', { name: 'Prepare again' })).toBeVisible();
});

test('v93 keeps active post-migration work running while its heartbeat is fresh', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('settings-button').click();
  await page.getByRole('tab', { name: 'Review', exact: true }).click();

  const result = await page.evaluate(() => {
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
    recovery.checkForStalledPreparation(localStorage, now - recovery.STALL_TIMEOUT_MS);
    const checked = recovery.checkForStalledPreparation(localStorage, now);
    return {
      recovered: checked.recovered,
      state: JSON.parse(localStorage.getItem('bandmarkr-listening-canonical-activation-v1')),
      checkpoint: JSON.parse(localStorage.getItem('bandmarkr-listening-derived-migration-v1')),
    };
  });

  expect(result.recovered).toBe(false);
  expect(result.state.status).toBe('preparing');
  expect(result.state.preparationPhase).toBe('persisting-candidates');
  expect(result.checkpoint.status).toBe('complete');

  const card = page.locator('[data-canonical-activation]');
  await expect(card.getByRole('button', { name: 'Prepare again' })).toBeHidden();
});
