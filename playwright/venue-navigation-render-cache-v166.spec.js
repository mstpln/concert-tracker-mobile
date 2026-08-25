const { test, expect } = require('@playwright/test');

async function openApp(page, testInfo) {
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium' ? { width: 375, height: 900 } : { width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: testInfo.project.name === 'mobile-chromium' ? 'light' : 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}

test('v166 Dates cache key invalidates when displayed band name changes', async ({ page }, testInfo) => {
  await openApp(page, testInfo);

  const result = await page.evaluate(() => {
    const concert = concerts.find((item) => item?.bandId && bands.some((band) => band.id === item.bandId));
    if (!concert) throw new Error('QA fixture must contain a tracked-band concert');

    const before = LiveVaultVenueNavigationRenderPerformanceV166.concertsViewDataKey();
    const originalBandName = concert.bandName;
    concert.bandName = `${originalBandName || 'QA Band'} renamed`;
    const after = LiveVaultVenueNavigationRenderPerformanceV166.concertsViewDataKey();
    concert.bandName = originalBandName;

    return { before, after };
  });

  expect(result.after).not.toBe(result.before);
});
