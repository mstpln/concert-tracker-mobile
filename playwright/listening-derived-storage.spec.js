const { test, expect } = require('@playwright/test');

async function resetDerivedDb(page) {
  await page.evaluate(async () => {
    const storage = window.BandmarkrListeningDerivedStorage;
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(storage.DB_NAME);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Derived database deletion was blocked.'));
    });
  });
}

test('v89 rollback restores the reviewed prior derived record', async ({ page }) => {
  await page.goto('/');
  await resetDerivedDb(page);

  const result = await page.evaluate(async () => {
    const storage = window.BandmarkrListeningDerivedStorage;

    await storage.putIdentity({
      sourceEventId: 'qa:reviewed-rollback',
      identityVersion: 1,
      status: 'user_reviewed',
      bandId: 'band-human',
      reviewedDecision: { action: 'assign_band', bandId: 'band-human' },
      reviewedAt: '2026-08-04T10:00:00.000Z',
      evidence: { method: 'manual_review' },
    });

    await storage.putIdentity({
      sourceEventId: 'qa:reviewed-rollback',
      identityVersion: 2,
      status: 'matched',
      bandId: 'band-automatic',
      reviewedDecision: null,
      evidence: { method: 'automated_v2' },
    });

    const beforeRollback = await storage.getIdentity('qa:reviewed-rollback');
    const rollback = await storage.deleteIdentityVersion(2);
    const afterRollback = await storage.getIdentity('qa:reviewed-rollback');

    const db = await storage.openDb();
    const stores = [...db.objectStoreNames];
    const historyCount = await new Promise((resolve, reject) => {
      const request = db.transaction(storage.IDENTITY_HISTORY_STORE, 'readonly')
        .objectStore(storage.IDENTITY_HISTORY_STORE)
        .count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();

    return { beforeRollback, rollback, afterRollback, stores, historyCount };
  });

  expect(result.beforeRollback.identityVersion).toBe(2);
  expect(result.beforeRollback.bandId).toBe('band-human');
  expect(result.beforeRollback.reviewedDecision).toEqual({ action: 'assign_band', bandId: 'band-human' });
  expect(result.rollback).toEqual({ processed: 1, restored: 1, removed: 0, retainedReviewed: 0, remaining: 0, hasMore: false });
  expect(result.afterRollback.identityVersion).toBe(1);
  expect(result.afterRollback.status).toBe('user_reviewed');
  expect(result.afterRollback.bandId).toBe('band-human');
  expect(result.afterRollback.reviewedDecision).toEqual({ action: 'assign_band', bandId: 'band-human' });
  expect(result.afterRollback.evidence).toEqual({ method: 'manual_review' });
  expect(result.stores).toEqual(expect.arrayContaining([
    'listen-identities',
    'listen-identities-history',
    'listen-canonical',
    'listen-canonical-history',
  ]));
  expect(result.historyCount).toBe(1);
});

test('v89 rollback preserves a review made on the target version', async ({ page }) => {
  await page.goto('/');
  await resetDerivedDb(page);

  const result = await page.evaluate(async () => {
    const storage = window.BandmarkrListeningDerivedStorage;

    await storage.putIdentity({
      sourceEventId: 'qa:reviewed-on-v2',
      identityVersion: 1,
      status: 'matched',
      bandId: 'band-v1',
      reviewedDecision: null,
      evidence: { method: 'automated_v1' },
    });

    await storage.putIdentity({
      sourceEventId: 'qa:reviewed-on-v2',
      identityVersion: 2,
      status: 'matched',
      bandId: 'band-v2',
      reviewedDecision: null,
      evidence: { method: 'automated_v2' },
    });

    await storage.putIdentity({
      sourceEventId: 'qa:reviewed-on-v2',
      identityVersion: 2,
      status: 'user_reviewed',
      bandId: 'band-human-v2',
      reviewedDecision: { action: 'assign_band', bandId: 'band-human-v2' },
      reviewedAt: '2026-08-04T12:00:00.000Z',
      evidence: { method: 'manual_review_v2' },
    }, { replaceReviewedDecision: true });

    const rollback = await storage.deleteIdentityVersion(2);
    const afterRollback = await storage.getIdentity('qa:reviewed-on-v2');
    return { rollback, afterRollback };
  });

  expect(result.rollback).toEqual({ processed: 1, restored: 1, removed: 0, retainedReviewed: 0, remaining: 0, hasMore: false });
  expect(result.afterRollback.identityVersion).toBe(1);
  expect(result.afterRollback.status).toBe('user_reviewed');
  expect(result.afterRollback.bandId).toBe('band-human-v2');
  expect(result.afterRollback.reviewedDecision).toEqual({ action: 'assign_band', bandId: 'band-human-v2' });
  expect(result.afterRollback.reviewedAt).toBe('2026-08-04T12:00:00.000Z');
  expect(result.afterRollback.evidence).toEqual({ method: 'automated_v1' });
});

test('v89 rollback retains a reviewed target-version record when no prior snapshot exists', async ({ page }) => {
  await page.goto('/');
  await resetDerivedDb(page);

  const result = await page.evaluate(async () => {
    const storage = window.BandmarkrListeningDerivedStorage;
    await storage.putCanonical({
      sourceEventId: 'qa:reviewed-only-v2',
      canonicalListenId: 'qa:reviewed-only-v2',
      duplicateOf: null,
      dedupeVersion: 2,
      status: 'user_reviewed',
      reviewedDecision: { action: 'keep_separate' },
      reviewedAt: '2026-08-04T13:00:00.000Z',
    });

    const rollback = await storage.deleteDedupeVersion(2);
    const afterRollback = await storage.getCanonical('qa:reviewed-only-v2');
    return { rollback, afterRollback };
  });

  expect(result.rollback).toEqual({ processed: 1, restored: 0, removed: 0, retainedReviewed: 1, remaining: 0, hasMore: false });
  expect(result.afterRollback.dedupeVersion).toBe(2);
  expect(result.afterRollback.status).toBe('user_reviewed');
  expect(result.afterRollback.reviewedDecision).toEqual({ action: 'keep_separate' });
});
