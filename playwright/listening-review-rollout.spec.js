const { test, expect } = require('@playwright/test');

test('v91 listening review stays local, defers without deciding, and preserves a keep-separate decision', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto('/');

  await page.evaluate(async () => {
    await BandmarkrListeningDerivedStorage.putIdentities([{
      sourceEventId: 'qa-identity-unresolved',
      identityVersion: 1,
      status: 'unresolved',
      source: 'listenbrainz',
    }]);
    await BandmarkrListeningDerivedStorage.putCanonicalBatch([{
      sourceEventId: 'qa-duplicate-candidate',
      dedupeVersion: 1,
      canonicalListenId: 'qa-duplicate-candidate',
      duplicateOf: 'qa-duplicate-representative',
      status: 'probable_duplicate',
      method: 'trusted_release_duration_signature',
      evidenceTier: 4,
      source: 'listenbrainz',
    }]);
  });

  await page.getByTestId('settings-button').click();
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  const card = page.locator('#listening-review-maintenance');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Listening data review');
  await expect(card).toContainText('Unresolved artist identity');
  await expect(card).toContainText('Possible duplicate listen');

  const duplicate = card.locator('.listening-review-item', { hasText: 'Possible duplicate listen' });
  await duplicate.getByRole('button', { name: 'Decide later' }).click();
  await expect(duplicate).toHaveCount(0);
  await expect(card).toContainText('remain available');

  await page.getByRole('tab', { name: 'Research', exact: true }).click();
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  const deferredDuplicate = card.locator('.listening-review-item', { hasText: 'Possible duplicate listen' });
  await expect(deferredDuplicate).toBeVisible();
  await deferredDuplicate.getByRole('button', { name: 'Keep separate' }).click();
  await expect(deferredDuplicate).toHaveCount(0);

  await page.getByRole('tab', { name: 'Research', exact: true }).click();
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  await expect(card.locator('.listening-review-item', { hasText: 'Possible duplicate listen' })).toHaveCount(0);
  const stored = await page.evaluate(() => BandmarkrListeningDerivedStorage.getCanonical('qa-duplicate-candidate'));
  expect(stored.status).toBe('user_reviewed');
  expect(stored.duplicateOf).toBeNull();
  expect(stored.reviewedDecision.action).toBe('keep_separate');
  expect(browserErrors).toEqual([]);
});
