const { test, expect } = require('@playwright/test');

test('v98 keeps ranking semantics and aligns Band Detail listening tabs', async ({ page }) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto('/');

  await expect(page.locator('#start-version-refresh')).toContainText('v100');

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
  const tabs = profile.locator('.ranked-list-tabs');
  await expect(profile.getByRole('tab', { name: 'Top Tracks' })).toHaveAttribute('aria-selected', 'true');
  await expect(profile.locator('.top-track-row').first()).toContainText(/listen/i);

  const geometry = await tabs.evaluate((control) => {
    const card = control.closest('.listening-card');
    const controlBox = control.getBoundingClientRect();
    const cardBox = card.getBoundingClientRect();
    const next = control.nextElementSibling;
    const style = getComputedStyle(control);
    return {
      leftInset: Math.round(controlBox.left - cardBox.left),
      rightInset: Math.round(cardBox.right - controlBox.right),
      gapBelow: next ? Math.round(next.getBoundingClientRect().top - controlBox.bottom) : null,
      height: Math.round(control.querySelector('button').getBoundingClientRect().height),
      radius: style.borderRadius,
      padding: style.padding,
    };
  });
  expect(geometry.leftInset).toBeLessThanOrEqual(3);
  expect(geometry.rightInset).toBeLessThanOrEqual(3);
  expect(geometry.gapBelow).toBe(10);
  expect(geometry.height).toBeGreaterThanOrEqual(42);
  expect(geometry.radius).toBe('12px');
  expect(geometry.padding).toBe('4px');

  await profile.getByRole('tab', { name: 'Top Albums' }).click();
  await expect(profile.getByRole('tab', { name: 'Top Albums' })).toHaveAttribute('aria-selected', 'true');
  await expect(profile.locator('.top-track-row').first()).toContainText(/listen/i);

  expect(browserErrors).toEqual([]);
});
