const { test, expect } = require('@playwright/test');

test('v85 ranks tracks and albums by listens and moves concert units into labels', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto('/');

  await expect(page.locator('#start-version-refresh')).toContainText('v85');

  const teaserItems = page.locator('.stats-teaser-item');
  const traveled = teaserItems.filter({ hasText: 'traveled' });
  const spent = teaserItems.filter({ hasText: 'spent' });
  await expect(traveled.locator('.stats-teaser-label')).toHaveText('traveled (km)');
  await expect(spent.locator('.stats-teaser-label')).toHaveText('spent (kr)');
  await expect(traveled.locator('.stats-teaser-value')).not.toContainText('km');
  await expect(spent.locator('.stats-teaser-value')).not.toContainText('kr');

  const ranking = await page.evaluate(() => {
    const now = Date.now();
    const listens = [
      { listenedAtMs: now - 1000, listenedDurationMs: 600000, recordingTitle: 'Long Track', releaseTitle: 'Long Album', artistCreditName: 'Synthetic Artist', localBandId: 'band-a' },
      { listenedAtMs: now - 2000, listenedDurationMs: 60000, recordingTitle: 'Popular Track', releaseTitle: 'Popular Album', artistCreditName: 'Synthetic Artist', localBandId: 'band-a' },
      { listenedAtMs: now - 3000, listenedDurationMs: 60000, recordingTitle: 'Popular Track', releaseTitle: 'Popular Album', artistCreditName: 'Synthetic Artist', localBandId: 'band-a' },
      { listenedAtMs: now - 4000, listenedDurationMs: 60000, recordingTitle: 'Popular Track', releaseTitle: 'Popular Album', artistCreditName: 'Synthetic Artist', localBandId: 'band-a' },
    ];
    const result = ListeningStats.selectedStats(listens, [{ id: 'band-a', name: 'Synthetic Artist' }], 'allTime', new Date(now));
    return {
      track: result.topTracks[0]?.recordingTitle,
      trackCount: result.topTracks[0]?.listenCount,
      album: result.topAlbums[0]?.releaseTitle,
      albumCount: result.topAlbums[0]?.listenCount,
    };
  });
  expect(ranking).toEqual({ track: 'Popular Track', trackCount: 3, album: 'Popular Album', albumCount: 3 });
  expect(browserErrors).toEqual([]);
});
