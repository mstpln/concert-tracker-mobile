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
    const concert = (id, venue, city, country, date, venueAddress = null) => ({
      id, bandId: band.id, bandName: band.name, venue, city, country, date, venueAddress, attending: false,
    });

    concerts.splice(0, concerts.length,
      concert('qa-v164-unknown-resolved', 'Unknown venue', 'Sundsvall', 'Sweden', '2027-08-01', 'Nordichallen, Sundsvall, Sweden'),
      concert('qa-v164-nordichallen', 'Nordichallen', 'Sundsvall', 'Sweden', '2027-08-02', 'Sundsvall, Sweden'),
      concert('qa-v164-unknown-unresolved', 'Unknown venue', 'Bergen', 'Norway', '2027-08-03'),
      concert('qa-v164-royal-copenhagen', 'Royal Arena', 'Copenhagen', 'Denmark', '2027-08-04', 'Hannemanns Allé 18-20, 2300 Copenhagen S, Denmark'),
      concert('qa-v164-royal-kobenhavn', 'Royal Arena', 'København S', 'Denmark', '2027-08-05', 'Hannemanns Allé 18-20, København S, Denmark'),
      concert('qa-v164-pumpe-copenhagen', 'Pumpehuset', 'Copenhagen', 'Denmark', '2027-08-06', 'Studiestræde 52, Copenhagen, Denmark'),
      concert('qa-v164-pumpe-kobenhavn', 'Pumpehuset', 'København V', 'Denmark', '2027-08-07', 'Studiestræde 52, København V, Denmark'),
      concert('qa-v164-film-gothenburg', 'Filmstudion', 'Gothenburg', 'Sweden', '2027-08-08'),
      concert('qa-v164-film-goteborg', 'Filmstudion', 'Göteborg', 'Sweden', '2027-08-09'),
      concert('qa-v164-roxy-prague', 'Roxy', 'Prague', 'Czech Republic', '2027-08-10'),
      concert('qa-v164-roxy-praha', 'Roxy', 'Praha 1', 'Czech Republic', '2027-08-11'),
      concert('qa-v164-afas', 'AFAS Dome', 'Merksem (Antwerpen)', 'Belgium', '2027-08-12', 'Schijnpoortweg 119, Merksem (Antwerpen), Belgium'),
      concert('qa-v164-lotto', 'Lotto Arena Antwerpen', 'Merksem (Antwerpen)', 'Belgium', '2027-08-13', 'Schijnpoortweg 119, Merksem (Antwerpen), Belgium'),
      concert('qa-v164-unknown-ambiguous', 'Unknown venue', 'Merksem (Antwerpen)', 'Belgium', '2027-08-14', 'Schijnpoortweg 119, Merksem (Antwerpen), Belgium'),
    );

    const record = (name, city, country, capacity, address, extras = {}) => ({
      venueId: VenueMetadataModelV158.venueIdFor({ name, city, country }),
      name, city, country, address,
      maxCapacity: capacity,
      researchStatus: 'partial',
      schemaVersion: 1,
      ...extras,
    });

    VenueMetadataV158.setRecords([
      record('Royal Arena', 'Copenhagen', 'Denmark', 17000, 'Hannemanns Allé 18-20, 2300 Copenhagen S, Denmark', {
        identityAliases: [{ name: 'Royal Arena', city: 'København S', country: 'Denmark', address: 'Hannemanns Allé 18-20, København S, Denmark' }],
      }),
      record('Pumpehuset', 'Copenhagen', 'Denmark', 600, 'Studiestræde 52, 1554 Copenhagen, Denmark', {
        identityAliases: [{ name: 'Pumpehuset', city: 'København V', country: 'Denmark', address: 'Studiestræde 52, København V, Denmark' }],
      }),
      record('Nordichallen', 'Sundsvall', 'Sweden', 9300, 'Sundsvall, Sweden'),
      record('Filmstudion', 'Gothenburg', 'Sweden', null, null),
      record('Roxy', 'Prague', 'Czech Republic', null, null),
      record('AFAS Dome', 'Merksem (Antwerpen)', 'Belgium', 23001, 'Schijnpoortweg 119, Merksem (Antwerpen), Belgium'),
      record('Lotto Arena Antwerpen', 'Merksem (Antwerpen)', 'Belgium', 8050, 'Schijnpoortweg 119, Merksem (Antwerpen), Belgium'),
    ]);
  });
}

test('v164 venue directory uses canonical physical venue identity across the full list', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);
  await seedCanonicalVenueCases(page);

  await page.locator('#tabbar [data-tab="concerts"]').click();
  await page.getByRole('button', { name: 'Venues' }).click();

  const cards = page.locator('.venue-metadata-list-card');
  await expect(cards).toHaveCount(7);
  await expect(cards.filter({ hasText: 'Unknown venue' })).toHaveCount(0);

  const expected = [
    ['Royal Arena', 'Copenhagen, Denmark', '2 shows on record'],
    ['Pumpehuset', 'Copenhagen, Denmark', '2 shows on record'],
    ['Nordichallen', 'Sundsvall, Sweden', '2 shows on record'],
    ['Filmstudion', 'Gothenburg, Sweden', '2 shows on record'],
    ['Roxy', 'Prague, Czech Republic', '2 shows on record'],
  ];
  for (const [name, location, count] of expected) {
    const card = cards.filter({ hasText: name });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(location);
    await expect(card).toContainText(count);
  }

  await expect(cards.filter({ hasText: 'AFAS Dome' })).toHaveCount(1);
  await expect(cards.filter({ hasText: 'Lotto Arena Antwerpen' })).toHaveCount(1);
  await expect(cards.filter({ hasText: 'AFAS Dome' })).toContainText('1 show on record');
  await expect(cards.filter({ hasText: 'Lotto Arena Antwerpen' })).toContainText('1 show on record');

  const royal = cards.filter({ hasText: 'Royal Arena' });
  await expect(royal.locator('.venue-card-max-capacity')).toHaveText('Max Capacity: 17 000');
  await royal.click();
  await expect(page.locator('#screen-venue-detail .venue-detail-location')).toHaveText('Copenhagen, Denmark');
  await expect(page.locator('#screen-venue-detail .row-card[data-band-id]')).toHaveCount(2);

  expect(errors).toEqual([]);
});

test('v164 placeholder venue resolution requires one unique stored physical venue', async ({ page }, testInfo) => {
  await openApp(page, testInfo);
  await seedCanonicalVenueCases(page);

  const result = await page.evaluate(() => ({
    resolved: VenueMetadataV158.metadataFor({
      venue: 'Unknown venue', city: 'Sundsvall', country: 'Sweden', venueAddress: 'Nordichallen, Sundsvall, Sweden',
    })?.name || null,
    ambiguous: VenueMetadataV158.metadataFor({
      venue: 'Unknown venue', city: 'Merksem (Antwerpen)', country: 'Belgium', venueAddress: 'Schijnpoortweg 119, Merksem (Antwerpen), Belgium',
    })?.name || null,
    missingEvidence: VenueMetadataV158.metadataFor({
      venue: 'Unknown venue', city: 'Bergen', country: 'Norway', venueAddress: null,
    })?.name || null,
  }));

  expect(result.resolved).toBe('Nordichallen');
  expect(result.ambiguous).toBeNull();
  expect(result.missingEvidence).toBeNull();
});

test('v164 venue statistics use the same canonical venue identity without changing stored concerts', async ({ page }, testInfo) => {
  await openApp(page, testInfo);
  await seedCanonicalVenueCases(page);

  const result = await page.evaluate(() => {
    const original = [
      { id: 'stats-1', bandId: 'a', bandName: 'A', venue: 'Royal Arena', city: 'Copenhagen', country: 'Denmark', date: '2025-01-01', attending: true },
      { id: 'stats-2', bandId: 'b', bandName: 'B', venue: 'Royal Arena', city: 'København S', country: 'Denmark', date: '2025-02-01', attending: true },
      { id: 'stats-3', bandId: 'c', bandName: 'C', venue: 'Unknown venue', city: 'Sundsvall', country: 'Sweden', venueAddress: 'Nordichallen, Sundsvall, Sweden', date: '2025-03-01', attending: true },
      { id: 'stats-4', bandId: 'd', bandName: 'D', venue: 'Unknown venue', city: 'Bergen', country: 'Norway', date: '2025-04-01', attending: true },
    ];
    const before = JSON.stringify(original);
    const stats = dlConcertStats(original, [], []);
    return {
      before,
      after: JSON.stringify(original),
      uniqueVenues: stats.uniqueVenues,
      topVenues: stats.topVenues,
    };
  });

  expect(result.after).toBe(result.before);
  expect(result.uniqueVenues).toBe(2);
  expect(result.topVenues.some((venue) => venue.venue === 'Unknown venue')).toBe(false);
  expect(result.topVenues.find((venue) => venue.venue === 'Royal Arena')?.count).toBe(2);
  expect(result.topVenues.find((venue) => venue.venue === 'Nordichallen')?.count).toBe(1);
});
