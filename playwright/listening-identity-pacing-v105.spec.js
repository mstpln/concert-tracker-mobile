const { test, expect } = require('@playwright/test');

test('v106 loads the identity guard without starting provider work', async ({ page }) => {
  const externalProviderRequests = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/api\.listenbrainz\.org|musicbrainz\.org/.test(url)) externalProviderRequests.push(url);
  });

  await page.goto('/');
  await expect(page.locator('#start-version-refresh')).toContainText('v106');

  const pacing = await page.evaluate(() => ({
    loaded: Boolean(window.BandmarkrListeningIdentityPacingV105),
    installed: window.__bandmarkrIdentityPacingV105Installed === true,
    recordingOnlyInstalled: window.__bandmarkrIdentityRecordingOnlyV106Installed === true,
    intervalMs: window.BandmarkrListeningIdentityPacingV105?.MUSICBRAINZ_MIN_INTERVAL_MS,
  }));
  expect(pacing).toEqual({ loaded: true, installed: true, recordingOnlyInstalled: true, intervalMs: 2000 });
  expect(externalProviderRequests).toEqual([]);
});
