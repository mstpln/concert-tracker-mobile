const { test, expect } = require('@playwright/test');

test('v91 listening review keeps group metadata separate from canonical listens', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto('/');

  await page.evaluate(async () => {
    const events = [
      { stableListenId: 'qa-review-a', listenedAt: '2026-01-01T12:00:00.000Z', artistCreditName: 'QA Review Artist', recordingTitle: 'QA Review Track', source: 'spotify_import', spotifyTrackId: 'qa-track', listenedDurationMs: 180000 },
      { stableListenId: 'qa-review-b', listenedAt: '2026-01-01T12:00:00.500Z', artistCreditName: 'QA Review Artist', recordingTitle: 'QA Review Track', source: 'listenbrainz', listenedDurationMs: 180000 },
      { stableListenId: 'qa-review-c', listenedAt: '2026-01-01T12:00:00.700Z', artistCreditName: 'QA Review Artist', recordingTitle: 'QA Review Track', source: 'listenbrainz', listenedDurationMs: 180000 },
    ];
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('livevault-listening-history-v1');
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
      request.onblocked = resolve;
    });
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('livevault-listening-history-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('listens', { keyPath: 'stableListenId' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('listens', 'readwrite');
      events.forEach((event) => tx.objectStore('listens').put(event));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    await BandmarkrListeningDerivedStorage.putCanonicalBatch(events.map((event) => ({
      sourceEventId: event.stableListenId,
      dedupeVersion: 1,
      canonicalListenId: event.stableListenId,
      duplicateOf: null,
      status: 'unique',
    })));
    await BandmarkrListeningReviewRollout.reviewStorage.putGroups([{
      reviewId: 'duplicate-group:qa-review-a|qa-review-b|qa-review-c',
      reviewVersion: 1,
      status: 'probable_duplicate',
      sourceEventIds: ['qa-review-a', 'qa-review-b', 'qa-review-c'],
      candidatePairs: [
        { pairKey: 'qa-review-a|qa-review-b', leftSourceEventId: 'qa-review-a', rightSourceEventId: 'qa-review-b', evidence: { tier: 4, outcome: 'probable_duplicate' } },
        { pairKey: 'qa-review-a|qa-review-c', leftSourceEventId: 'qa-review-a', rightSourceEventId: 'qa-review-c', evidence: { tier: 4, outcome: 'probable_duplicate' } },
      ],
    }]);
  });

  await page.getByTestId('settings-button').click();
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  const card = page.locator('#listening-review-maintenance');
  await expect(card).toContainText('QA Review Artist');
  await expect(card).toContainText('QA Review Track');
  await expect(card.getByRole('button', { name: 'These are the same listen' })).toHaveCount(2);
  await expect(card).not.toContainText('Unresolved artist identity');

  const group = card.locator('.listening-review-item');
  await group.getByRole('button', { name: 'Decide later' }).click();
  await expect(group).toHaveCount(0);
  await page.getByRole('tab', { name: 'Research', exact: true }).click();
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  await expect(card.getByRole('button', { name: 'These are the same listen' })).toHaveCount(2);

  await card.getByRole('button', { name: 'Keep all separate' }).click();
  await page.getByRole('tab', { name: 'Research', exact: true }).click();
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  await expect(card.locator('.listening-review-item')).toHaveCount(0);
  const stored = await page.evaluate(async () => ({
    canonical: await Promise.all(['qa-review-a', 'qa-review-b', 'qa-review-c'].map((id) => BandmarkrListeningDerivedStorage.getCanonical(id))),
    review: await BandmarkrListeningReviewRollout.reviewStorage.getGroup('duplicate-group:qa-review-a|qa-review-b|qa-review-c'),
  }));
  expect(stored.canonical.every((record) => record.status === 'unique' && record.duplicateOf === null)).toBe(true);
  expect(stored.review.status).toBe('user_reviewed');
  expect(stored.review.reviewedDecision.action).toBe('keep_separate');
  expect(browserErrors).toEqual([]);
});
