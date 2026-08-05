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
    BandmarkrListeningCanonicalActivation.renderSettingsCard(document.querySelector('[data-canonical-activation]'));
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
