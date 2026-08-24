const { test, expect } = require('@playwright/test');

async function openApp(page, testInfo) {
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium' ? { width: 375, height: 900 } : { width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: testInfo.project.name === 'mobile-chromium' ? 'light' : 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}

async function seedCanonicalVenueCases(page) {
  await page.evaluate(() => {
    const band = bands[0];
    if (!band) throw new Error('QA fixture must contain at least one band');

    concerts.splice(0, concerts.length,
      {
        id: 'qa-v164-unknown', bandId: band.id, bandName: band.name,
        venue: 'Unknown venue', city: 'Sundsvall', country: 'Sweden', date: '2027-08-01', attending: false,
      },
      {
        id: 'qa-v164-royal-copenhagen', bandId: band.id, bandName: band.name,
        venue: 'Royal Arena', city: 'Copenhagen', country: 'Denmark', date: '2027-08-02', attending: false,
      },
      {
        id: 'qa-v164-royal-kobenhavn', bandId: band.id, bandName: band.name,
        venue: 'Royal Arena', city: 'København S', country: 'Denmark', date: '2027-08-03', attending: false,
      },
      {
        id: 'qa-v164-pumpe-copenhagen', bandId: band.id, bandName: band.name,
        venue: 'Pumpehuset', city: 'Copenhagen', country: 'Denmark', date: '2027-08-04', attending: false,
      },
      {
        id: 'qa-v164-pumpe-kobenhavn', bandId: band.id, bandName: band.name,
        venue: 'Pumpehuset', city: 'København V', country: 'Denmark', date: '2027-08-05', attending: false,
      },
    );

    const record = (name, capacity) => ({
      venueId: VenueMetadataModelV158.venueIdFor({ name, city: 'Copenhagen', country: 'Denmark' }),
      name,
      city: 'Copenhagen',
      country: 'Denmark',
      maxCapacity: capacity,
      researchStatus: 'partial',
      schemaVersion: 1,
    });
    VenueMetadataV158.setRecords([
      record('Royal Arena', 17000),
      record('Pumpehuset', 600),
    ]);
  });
}

test('v164 venue directory hides placeholders and canonicalizes city aliases into one venue card', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);
  await seedCanonicalVenueCases(page);

  await page.locator('#tabbar [data-tab="concerts"]').click();
  await page.getByRole('button', { name: 'Venues' }).click();

  const cards = page.locator('.venue-metadata-list-card');
  await expect(cards).toHaveCount(2);
  await expect(page.locator('body')).not.toContainText('Unknown venue');

  const royal = cards.filter({ hasText: 'Royal Arena' });
  await expect(royal).toHaveCount(1);
  await expect(royal).toContainText('Copenhagen, Denmark');
  await expect(royal).toContainText('2 shows on record');
  await expect(royal.locator('.venue-card-max-capacity')).toHaveText('Max Capacity: 17 000');

  const pumpehuset = cards.filter({ hasText: 'Pumpehuset' });
  await expect(pumpehuset).toHaveCount(1);
  await expect(pumpehuset).toContainText('Copenhagen, Denmark');
  await expect(pumpehuset).toContainText('2 shows on record');
  await expect(pumpehuset.locator('.venue-card-max-capacity')).toHaveText('Max Capacity: 600');

  await royal.click();
  await expect(page.locator('#screen-venue-detail .venue-detail-location')).toHaveText('Copenhagen, Denmark');
  await expect(page.locator('#screen-venue-detail .row-card[data-band-id]')).toHaveCount(2);

  expect(errors).toEqual([]);
});
