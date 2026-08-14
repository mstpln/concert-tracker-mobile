const { test, expect } = require('@playwright/test');

async function seedInterruptedPreparation(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const deleteDb = (name) => new Promise((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    for (const name of ['livevault-listening-history-v1', 'bandmarkr-listening-derived-v1', 'bandmarkr-listening-review-v1', 'bandmarkr-listening-preparation-v121']) await deleteDb(name);
    localStorage.removeItem('bandmarkr-listening-derived-migration-v1');
    localStorage.removeItem('bandmarkr-listening-preparation-v121');
    localStorage.removeItem('bandmarkr-listening-canonical-activation-v1');

    const events = Array.from({ length: 700 }, (_, index) => ({
      stableListenId: `qa-gau5-${String(index).padStart(4, '0')}`,
      listenedAt: new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString(),
      listenedDurationMs: 180000,
      artistCreditName: index % 2 ? 'QA Artist One' : 'QA Artist Two',
      recordingTitle: `QA Track ${index}`,
      releaseTitle: 'QA Album',
      spotifyTrackId: `qa-track-${String(index).padStart(4, '0')}`,
      source: index % 2 ? 'listenbrainz' : 'spotify_import',
    }));

    await new Promise((resolve, reject) => {
      const request = indexedDB.open('livevault-listening-history-v1', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('listens')) db.createObjectStore('listens', { keyPath: 'stableListenId' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['listens', 'meta'], 'readwrite');
        for (const event of events) tx.objectStore('listens').put(event);
        tx.objectStore('meta').put({ key: 'spotify-import', eventCount: events.length });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });

    const migration = window.BandmarkrListeningDerivedMigration;
    const checkpoints = migration.checkpointStore(localStorage);
    const first = await migration.runChunk({ bands: [], chunkSize: 500, checkpoints });
    if (first.processed !== 500 || !first.hasMore) throw new Error('Synthetic GAU5 first chunk did not stop at the intended interruption boundary.');

    const gau5 = window.BandmarkrListeningPreparationV121;
    const store = gau5.stateStore(localStorage);
    store.save(gau5.pause(gau5.checkpoint(gau5.begin(gau5.defaultState()), {
      phase: 'migration',
      phaseCursor: first.checkpoint.afterSourceEventId,
      processedEvents: first.checkpoint.processedEvents,
      sourceEventCount: first.checkpoint.sourceEventCountAfter,
      sourceIntegrity: first.checkpoint.integrityStatus,
      phaseCounts: { migrationChunks: 1 },
    })));
    window.BandmarkrListeningCanonicalActivation.stateStore(localStorage).save({ stateVersion: 1, status: 'gau5_preparing', sourceEventCount: 700 });
  });
}

test('GAU5 resumes a persisted listening preparation after reload without activating cleaned totals', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium'
    ? { width: 375, height: 820 }
    : { width: 480, height: 900 });

  await seedInterruptedPreparation(page);
  await page.reload();

  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('bandmarkr-listening-preparation-v121') || '{}').status), { timeout: 30000 }).toBe('complete');
  const states = await page.evaluate(() => ({
    preparation: JSON.parse(localStorage.getItem('bandmarkr-listening-preparation-v121') || '{}'),
    activation: JSON.parse(localStorage.getItem('bandmarkr-listening-canonical-activation-v1') || '{}'),
    migration: JSON.parse(localStorage.getItem('bandmarkr-listening-derived-migration-v1') || '{}'),
  }));
  expect(states.preparation.processedEvents).toBe(700);
  expect(states.preparation.verifiedCanonicalCount).toBe(700);
  expect(states.preparation.verifiedIdentityCount).toBe(700);
  expect(states.preparation.completedPhases).toEqual(['migration', 'candidates', 'persistence', 'verification']);
  expect(states.migration.status).toBe('complete');
  expect(states.activation.status).toBe('ready');
  expect(states.activation.sourceEventCount).toBe(700);
  expect(states.activation.canonicalRecordCount).toBe(700);
  expect(states.activation.activatedAt).toBeNull();

  await page.locator('#settings-btn').click();
  const card = page.locator('[data-canonical-activation]');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-canonical-activation-status]')).toContainText('Preparation complete');
  await expect(card.locator('[data-canonical-activate]')).toBeVisible();
  await expect(card.locator('[data-canonical-deactivate]')).toBeHidden();
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).resolves.toBe(true);
  await card.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-gau5-resumable-preparation.png`) });
});
