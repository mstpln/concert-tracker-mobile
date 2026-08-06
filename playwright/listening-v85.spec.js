const { test, expect } = require('@playwright/test');

test('v85 ranks tracks and albums by listens and moves concert units into labels', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto('/');

  await expect(page.locator('#start-version-refresh')).toContainText('v96');

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
    const tracks = ListeningStats.topTracks(listens, 10);
    const albums = ListeningStats.topAlbums(listens, 10);
    return {
      track: tracks[0]?.recordingTitle,
      trackCount: tracks[0]?.listenCount,
      album: albums[0]?.releaseTitle,
      albumCount: albums[0]?.listenCount,
    };
  });
  expect(ranking).toEqual({ track: 'Popular Track', trackCount: 3, album: 'Popular Album', albumCount: 3 });

  await page.getByRole('button', { name: 'View all' }).first().click();
  await page.locator('.full-top-bands-card .top-band-row').first().click();
  const profile = page.locator('#screen-profile');
  await expect(profile.getByRole('tab', { name: 'Top Tracks' })).toHaveAttribute('aria-selected', 'true');
  await expect(profile.locator('.top-track-row').first()).toContainText(/listen/i);
  await profile.getByRole('tab', { name: 'Top Albums' }).click();
  await expect(profile.getByRole('tab', { name: 'Top Albums' })).toHaveAttribute('aria-selected', 'true');
  await expect(profile.locator('.top-track-row').first()).toContainText(/listen/i);

  expect(browserErrors).toEqual([]);
});
