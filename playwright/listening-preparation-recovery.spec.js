const { test, expect } = require('@playwright/test');

async function openListeningMaintenance(page) {
  const screen = page.locator('#screen-settings');
  await screen.getByRole('tab', { name: 'Data', exact: true }).click();
  const maintenance = screen.locator('.settings-v123-maintenance');
  if (!(await maintenance.getAttribute('open'))) await maintenance.locator('summary').click();
  return maintenance.locator('.settings-v123-maintenance-row').filter({ hasText: 'Listening statistics' });
}

test('v93 recovers a stalled preparation after a lock-style resume without reloading', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('settings-button').click();

  const result = await page.evaluate(async () => {
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
    recovery.checkForStalledPreparation(localStorage, 1000);
    const recovered = recovery.checkForStalledPreparation(localStorage, 1000 + recovery.STALL_TIMEOUT_MS);
    await BandmarkrSettingsV123.renderUnifiedSettings();
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

  const card = await openListeningMaintenance(page);
  await expect(card).toContainText('Preparation stopped safely:');
  await expect(card).toContainText('Preparation was interrupted');
  await expect(card.getByRole('button', { name: 'Prepare again' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Use reviewed totals' })).toBeHidden();
});

test('v93 keeps active post-migration work running while its heartbeat is fresh', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('settings-button').click();

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
    recovery.checkForStalledPreparation(localStorage, now - recovery.STALL_TIMEOUT_MS);
    const checked = recovery.checkForStalledPreparation(localStorage, now);
    await BandmarkrSettingsV123.renderUnifiedSettings();
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

  const card = await openListeningMaintenance(page);
  await expect(card).toContainText('Saving confirmed and possible duplicate matches');
  await expect(card.getByRole('button', { name: 'Update listening statistics' })).toBeHidden();
  await expect(card.getByRole('button', { name: 'Use reviewed totals' })).toBeHidden();
});
