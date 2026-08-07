const { test, expect } = require('@playwright/test');

test('v99 shows exact Spotify links and identity-backed artwork across listening rankings', async ({ page }, testInfo) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium'
    ? { width: 375, height: 820 }
    : { width: 480, height: 900 });
  await page.goto('/');

  await page.getByRole('button', { name: 'See your listening stats' }).click();
  const preview = page.locator('.top-bands-card.toplist-card');
  await preview.getByRole('tab', { name: 'Top Tracks' }).click();

  const previewRows = preview.locator('.toplist-track-row');
  await expect(previewRows).toHaveCount(7);
  const previewLinkedRow = previewRows.filter({ has: page.locator('.trusted-listening-link') }).first();
  await expect(previewLinkedRow.locator('.trusted-listening-link')).toHaveAttribute('href', /^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]+$/);
  await expect(previewLinkedRow.locator('.track-artwork img')).toBeVisible();
  await expect(previewLinkedRow.locator('.trusted-listening-artist')).toBeVisible();

  await preview.getByRole('button', { name: 'View all' }).click();
  const full = page.locator('.full-top-bands-card.toplist-card');
  await expect(full.getByRole('tab', { name: 'Top Tracks' })).toHaveAttribute('aria-selected', 'true');
  const fullLinkedRow = full.locator('.toplist-track-row').filter({ has: page.locator('.trusted-listening-link') }).first();
  await expect(fullLinkedRow.locator('.trusted-listening-link')).toHaveAttribute('href', /^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]+$/);
  await expect(fullLinkedRow.locator('.track-artwork img')).toBeVisible();

  await fullLinkedRow.locator('.trusted-listening-artist').click();
  const profile = page.locator('#screen-profile');
  await expect(profile.getByRole('tab', { name: 'Listening', exact: true })).toHaveAttribute('aria-selected', 'true');

  await page.evaluate(() => {
    const bandId = activeProfileBandId;
    const band = bands.find((candidate) => candidate.id === bandId);
    const now = Date.now();
    const exact = Array.from({ length: 24 }, (_, index) => ({
      id: `v99-profile-exact-${index}`,
      listenedAtMs: now - index * 1000,
      listenedDurationMs: 240000,
      recordingTitle: 'V99 Exact Profile Track',
      releaseTitle: 'V99 Exact Profile Album',
      artistCreditName: band?.name || 'Synthetic Artist',
      bandId,
      localBandId: bandId,
      spotifyTrackId: 'V99ExactTrack123',
      spotifyTrackUrl: 'https://open.spotify.com/track/V99ExactTrack123',
      spotifyAlbumId: 'V99ExactAlbum456',
      spotifyAlbumUrl: 'https://open.spotify.com/album/V99ExactAlbum456',
      albumArtworkUrl: 'https://fixtures.livevault.test/images/v99-exact-profile.jpg',
      spotifyMetadataSource: 'spotify_exact_track_id',
    }));
    listeningEvents = [...listeningEvents, ...exact];
    renderProfileScreen(bandId);
    TrustedListeningV99.enhanceBandDetail(document);
  });

  const trackCard = profile.locator('.top-tracks-card');
  const linkedTrackRow = trackCard.locator('.top-track-row').filter({ hasText: 'V99 Exact Profile Track' });
  await expect(linkedTrackRow.locator('.trusted-listening-link')).toHaveAttribute('href', 'https://open.spotify.com/track/V99ExactTrack123');
  await expect(linkedTrackRow.locator('.track-artwork img')).toBeVisible();

  await trackCard.getByRole('tab', { name: 'Top Albums' }).click();
  const linkedAlbumRow = profile.locator('.top-tracks-card .top-track-row').filter({ hasText: 'V99 Exact Profile Album' });
  await expect(linkedAlbumRow.locator('.trusted-listening-link')).toHaveAttribute('href', 'https://open.spotify.com/album/V99ExactAlbum456');
  await expect(linkedAlbumRow.locator('.track-artwork img')).toBeVisible();

  const unresolved = await page.evaluate(() => {
    const row = window.TrustedListeningV99.aggregate([
      {
        id: 'synthetic-unresolved-one',
        listenedAtMs: Date.now() - 1000,
        listenedDurationMs: 180000,
        recordingTitle: 'Unresolved Synthetic Track',
        artistCreditName: 'Synthetic Artist',
      },
    ], 'track', 10)[0];
    return { link: row.spotifyTrackUrl, artwork: row.artworkPath, trusted: row.trustedSpotifyIdentity };
  });
  expect(unresolved).toEqual({ link: null, artwork: null, trusted: false });

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(browserErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-v99-trusted-listening.png`), fullPage: true });
});
