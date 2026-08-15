const { test, expect } = require('@playwright/test');

test('v127 preserves concert listening summaries while indexing a large history once per render', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');

  const result = await page.evaluate(() => {
    const now = new Date('2026-08-15T12:00:00Z');
    window.__LIVEVAULT_QA_NOW__ = now.toISOString();
    bands = Array.from({ length: 100 }, (_, index) => ({
      id: `perf-band-${index}`,
      name: `Performance Band ${index}`,
      genre: 'Rock',
      socials: {},
    }));
    concerts = Array.from({ length: 75 }, (_, index) => ({
      id: `perf-concert-${index}`,
      bandId: `perf-band-${index % 100}`,
      bandName: `Performance Band ${index % 100}`,
      date: index % 2 ? '2026-10-01' : '2026-06-01',
      time: '19:30',
      venue: 'Synthetic Hall',
      city: 'Synthetic City',
      country: 'Sweden',
      attending: true,
      manuallyAdded: false,
    }));
    listeningEvents = Array.from({ length: 50000 }, (_, index) => ({
      id: `perf-listen-${index}`,
      localBandId: `perf-band-${index % 100}`,
      listenedAtMs: now.getTime() - ((index % 240) * 86400000),
      listenedDurationMs: index % 11 === 0 ? null : 180000,
      artistCreditName: `Performance Band ${index % 100}`,
      recordingTitle: `Track ${index % 25}`,
    }));

    const target = concerts[1];
    const expected = LiveVaultV72.concertListeningAggregate(target, false, now, listeningEvents);
    const sourceLength = listeningEvents.length;
    renderMyConcertsScreen();
    const card = document.querySelector(`[data-band-id="${target.bandId}"]`);
    const summary = card?.querySelector('.concert-listening-row small')?.textContent || '';
    const index = LiveVaultUiPerformanceV127.buildListeningIndex(listeningEvents, bands, ListeningStats);

    return {
      expected,
      summary,
      sourceLength,
      restoredLength: listeningEvents.length,
      sourceVisits: index.sourceVisits,
      renderedCards: document.querySelectorAll('#screen-myconcerts .row-card-mc').length,
    };
  });

  expect(result.sourceLength).toBe(50000);
  expect(result.restoredLength).toBe(50000);
  expect(result.sourceVisits).toBe(50000);
  expect(result.renderedCards).toBe(75);
  expect(result.expected).not.toBeNull();
  expect(result.summary).toContain(`${result.expected.listenCount.toLocaleString()} listens`);
  expect(pageErrors).toEqual([]);
});
