const { test, expect } = require('@playwright/test');

test('v106 exposes recording-only manual identity completion without automatic provider calls', async ({ page }) => {
  const externalMetadataRequests = [];
  await page.route('https://api.listenbrainz.org/1/metadata/**', async (route) => {
    externalMetadataRequests.push(route.request().url());
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/');
  await page.locator('#settings-btn').click();
  await page.getByRole('tab', { name: 'Review', exact: true }).click();

  const card = page.locator('[data-v104-listening-identity]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Listening identity');
  await expect(card).toContainText('at most 25 unique recording combinations per run');
  await expect(card).toContainText('Release-group enrichment is deferred and does not block recording identity completion');
  await expect(card.getByRole('button', { name: 'Complete listening identities' })).toBeVisible();
  await expect(card.locator('[data-v104-identity-status]')).toContainText('uses ListenBrainz for recording identity only');
  await expect(card.locator('[data-v104-identity-status]')).toContainText('does not call MusicBrainz release context');
  await expect(card.locator('[data-v104-identity-status]')).toContainText('does not call MusicBrainz release context or send listening timestamps, event IDs, or full-history payloads');
  expect(externalMetadataRequests).toEqual([]);
});

test('v106 manual button resolves recording identity without calling MusicBrainz release context', async ({ page }) => {
  const providerRequests = [];
  const artistMbid = 'fedcbafe-dcba-4fed-8cba-fedcbafedcba';
  const recordingMbid = '11111111-2222-4333-8444-555555555555';
  const releaseMbid = '12345678-1234-4234-8234-123456789abc';

  page.on('request', (request) => {
    const url = request.url();
    if (/api\.listenbrainz\.org|musicbrainz\/release-context/.test(url)) providerRequests.push(url);
  });
  await page.route('https://api.listenbrainz.org/1/metadata/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        artist_credit_name: 'Synthetic Identity Artist',
        recording_name: 'Synthetic Identity Song',
        artist_mbids: [artistMbid],
        recording_mbid: recordingMbid,
      }),
    });
  });

  await page.goto('/');
  await page.evaluate(({ artistMbid, releaseMbid }) => {
    window.LiveVaultSpotifyHistory = {
      loadEvents: async () => [{
        stableListenId: 'v106-browser-identity-1',
        localBandId: 'band-a',
        musicbrainzArtistIds: [artistMbid],
        musicbrainzReleaseId: releaseMbid,
        artistCreditName: 'Synthetic Identity Artist',
        recordingTitle: 'Synthetic Identity Song',
        releaseTitle: 'Synthetic Identity Album',
      }],
    };
    const stored = new Map();
    window.BandmarkrListeningDerivedStorage = {
      listIdentities: async () => ({ items: [...stored.values()], nextAfterSourceEventId: null }),
      putIdentities: async (records) => records.forEach((record) => stored.set(record.sourceEventId, record)),
    };
    window.LiveVaultListenBrainz = { connection: () => ({ token: 'synthetic-token' }) };
    window.__v106BrowserIdentityRecords = stored;
  }, { artistMbid, releaseMbid });

  await page.locator('#settings-btn').click();
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  const card = page.locator('[data-v104-listening-identity]');
  await card.getByRole('button', { name: 'Complete listening identities' }).click();
  await expect(card.locator('[data-v104-identity-status]')).toContainText('Done. Checked 1 recording combinations');
  await expect(card.locator('[data-v104-identity-status]')).toContainText('1 recording IDs added');
  await expect(card.locator('[data-v104-identity-status]')).toContainText('Release-group enrichment is deferred and did not run');

  expect(providerRequests).toHaveLength(1);
  expect(providerRequests[0]).toContain('api.listenbrainz.org');
  expect(providerRequests.some((url) => url.includes('/musicbrainz/release-context'))).toBe(false);
  const record = await page.evaluate(() => [...window.__v106BrowserIdentityRecords.values()][0]);
  expect(record.recordingMbid).toBe(recordingMbid);
  expect(record.releaseMbid).toBe(releaseMbid);
  expect(record.releaseGroupMbid).toBeUndefined();
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
