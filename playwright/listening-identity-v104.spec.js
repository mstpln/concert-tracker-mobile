const { test, expect } = require('@playwright/test');

test('v104 exposes manual bounded listening identity completion without automatic provider calls', async ({ page }) => {
  const externalMetadataRequests = [];
  await page.route('https://api.listenbrainz.org/1/metadata/**', async (route) => {
    externalMetadataRequests.push(route.request().url());
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/');
  await page.locator('#settings-btn').click();
  await page.getByRole('tab', { name: 'Data' }).click();

  const card = page.locator('[data-v104-listening-identity]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Listening identity');
  await expect(card).toContainText('at most 25 unique artist/track/release combinations per run');
  await expect(card).toContainText('Release identity is accepted only when the returned release ID and release name agree exactly');
  await expect(card).toContainText('Release groups never combine editions automatically');
  await expect(card.getByRole('button', { name: 'Complete listening identities' })).toBeVisible();
  await expect(card.locator('[data-v104-identity-status]')).toContainText('No listening timestamps, event IDs or full-history payload is sent');
  expect(externalMetadataRequests).toEqual([]);
});

test('v104 keeps two MusicBrainz releases separate even when they share one release group', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const stats = ListeningStats;
    const releaseGroup = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
    const releases = [
      {
        stableListenId: 'synthetic-edition-a',
        listenedAt: '2026-08-01T10:00:00.000Z',
        listenedDurationMs: 180000,
        artistCreditName: 'Synthetic Artist',
        recordingTitle: 'Synthetic Song',
        releaseTitle: 'Synthetic Album',
        musicbrainzReleaseId: '12345678-1234-4234-8234-123456789abc',
        musicbrainzReleaseGroupId: releaseGroup,
      },
      {
        stableListenId: 'synthetic-edition-b',
        listenedAt: '2026-08-02T10:00:00.000Z',
        listenedDurationMs: 180000,
        artistCreditName: 'Synthetic Artist',
        recordingTitle: 'Synthetic Song',
        releaseTitle: 'Synthetic Album Deluxe',
        musicbrainzReleaseId: '87654321-4321-4321-8321-cba987654321',
        musicbrainzReleaseGroupId: releaseGroup,
      },
    ];
    return {
      policy: ListeningIdentityGroupingV104.ALBUM_EDITION_POLICY,
      rows: ListeningIdentityGroupingV104.aggregateAlbums(releases, 10, stats).map((row) => ({
        title: row.releaseTitle,
        releaseId: row.musicbrainzReleaseId,
        releaseGroupId: row.musicbrainzReleaseGroupId,
      })),
    };
  });

  expect(result.policy).toBe('specific_release');
  expect(result.rows).toHaveLength(2);
  expect(new Set(result.rows.map((row) => row.releaseId)).size).toBe(2);
  expect(new Set(result.rows.map((row) => row.releaseGroupId)).size).toBe(1);
});
