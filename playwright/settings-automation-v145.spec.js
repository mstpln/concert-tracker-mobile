const { test, expect } = require('@playwright/test');

async function openSettings(page) {
  await page.goto('/');
  await page.getByTestId('settings-button').click();
  await expect(page.locator('#screen-settings')).toBeVisible();
}

async function applyAutomationFixture(page) {
  await page.evaluate(() => {
    const activity = (status, workCount, changeCount, extra = {}) => ({
      status,
      startedAt:'2027-07-16T01:00:00.000Z',
      finishedAt:'2027-07-16T01:15:00.000Z',
      result:{ workCount, changeCount },
      ...extra,
    });
    apiUsage = {
      automationRuns:{
        structuredResearch:{
          startedAt:'2027-07-16T01:00:00.000Z', finishedAt:'2027-07-16T01:15:00.000Z', status:'ok',
          activities:{
            concerts:activity('ok',370,31),
            artistArtwork:activity('ok',10,3),
            setlists:activity('ok',4,0),
          },
        },
        focusedTavilyConcert:{
          startedAt:'2027-07-15T02:00:00.000Z', finishedAt:'2027-07-15T02:10:00.000Z', status:'attention',
          activities:{
            webConcertSearch:activity('attention',8,1,{
              failureCode:'provider_unavailable',
              failureReason:'Web concert search temporarily unavailable (HTTP 503)',
            }),
          },
        },
        providerIdentity:{
          startedAt:'2027-07-15T10:00:00.000Z', finishedAt:'2027-07-15T10:10:00.000Z', status:'ok',
          activities:{ artistInformation:activity('ok',12,2) },
        },
      },
    };
    window.LiveVaultListenBrainz = { connection:() => ({
      lastSyncAt:'2027-07-16T06:00:00.000Z',
      lastSyncResult:{ processed:24, added:24, skipped:0 },
    }) };
    window.BandmarkrSettingsAutomationReportingV145.applyCurrent();
  });
}

async function expectNoHorizontalOverflow(locator) {
  expect(await locator.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
}

for (const colorScheme of ['dark','light']) {
  test(`v145 Update activity shows truthful standardized results and safe failure copy in ${colorScheme} mode`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    await openSettings(page);
    await applyAutomationFixture(page);
    const screen = page.locator('#screen-settings');
    const update = screen.locator('.settings-v123-section').filter({ hasText:'UPDATE ACTIVITY' });

    await expect(update).toContainText('370 artists checked · 31 concerts added');
    await expect(update).toContainText('8 artists checked · 1 concert added');
    await expect(update).toContainText('24 listens processed · 24 listens added');
    await expect(update).toContainText('12 artists checked · 2 artists updated');
    await expect(update).toContainText('10 artists checked · 3 images added');
    await expect(update).toContainText('4 shows checked · 0 setlists added');
    await expect(update).not.toContainText('Artwork scheduler state is not reported to this device.');
    await expect(update).not.toContainText('Not reported');

    const problems = update.locator('.settings-v123-problem');
    await expect(problems).toHaveCount(1);
    await expect(problems).toHaveText('Web concert search temporarily unavailable (HTTP 503)');
    await expectNoHorizontalOverflow(update);

    await update.screenshot({ path:testInfo.outputPath(`settings-update-activity-${colorScheme}.png`) });
  });
}

test('v145 Album artwork coverage reads separate synthetic Spotify metadata after source-clean listening hydration', async ({ page }, testInfo) => {
  await openSettings(page);
  const screen = page.locator('#screen-settings');
  await screen.getByRole('tab', { name:'Data' }).click();
  await expect(screen.getByText('Album artwork', { exact:true })).toBeVisible();

  await page.evaluate(() => {
    bands = [{ id:'qa-a', name:'QA A' }, { id:'qa-b', name:'QA B' }];
    listeningEvents = [
      { stableListenId:'qa-1', localBandId:'qa-a', releaseTitle:'Shared Synthetic Album', recordingTitle:'One', spotifyTrackId:'qa-track-1' },
      { stableListenId:'qa-2', localBandId:'qa-a', releaseTitle:'Shared Synthetic Album', recordingTitle:'Two', spotifyTrackId:'qa-track-2' },
      { stableListenId:'qa-3', localBandId:'qa-b', releaseTitle:'Shared Synthetic Album', recordingTitle:'Three', spotifyTrackId:'qa-track-3' },
    ];
    window.SpotifyListeningMetadataV99.recordForTrack = (id) => id === 'qa-track-1'
      ? { artworkUrl:'https://example.invalid/synthetic-art.jpg' }
      : null;
    window.BandmarkrSettingsAutomationReportingV145.applyCurrent();
  });

  const album = screen.locator('[data-v123-metric="Album artwork"]');
  await expect(album).toContainText('1 of 2 listened albums');
  await expect(album.locator('.settings-v123-metric-value')).toContainText('50%');
  await expectNoHorizontalOverflow(album);
  await album.screenshot({ path:testInfo.outputPath('settings-album-artwork-derived-metadata.png') });
});

test('v145 long safe failure reason wraps without changing the existing Settings row structure', async ({ page }) => {
  await page.setViewportSize({ width:360, height:900 });
  await openSettings(page);
  await page.evaluate(() => {
    apiUsage = { automationRuns:{ structuredResearch:{ status:'ok', activities:{
      concerts:{ status:'ok', result:{ workCount:1, changeCount:0 } },
      artistArtwork:{ status:'attention', result:{ workCount:10, changeCount:0 }, failureCode:'update_failed', failureReason:'Artist artwork update could not be completed safely because the provider response could not be used.' },
      setlists:{ status:'ok', result:{ workCount:4, changeCount:0 } },
    } } } };
    window.LiveVaultListenBrainz = { connection:()=>null };
    window.BandmarkrSettingsAutomationReportingV145.applyCurrent();
  });
  const update = page.locator('#screen-settings .settings-v123-section').filter({ hasText:'UPDATE ACTIVITY' });
  await expect(update.locator('.settings-v123-problem')).toHaveCount(1);
  await expectNoHorizontalOverflow(update);
  expect(await update.evaluate((node) => node.querySelectorAll(':scope > .settings-v123-card > .settings-v123-row').length)).toBe(6);
});
