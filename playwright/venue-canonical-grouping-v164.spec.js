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
      concert('qa-v164-roxy-prague', 'Roxy', 'Prague', 'Czech Republic', '2027-08-10', 'Dlouhá 33, 110 00 Prague, Czech Republic'),
      concert('qa-v164-roxy-praha', 'Roxy', 'Praha 1', 'Czech Republic', '2027-08-11', 'Dlouhá 33, Praha 1, Czech Republic'),
      concert('qa-v164-afas', 'AFAS Dome', 'Merksem (Antwerpen)', 'Belgium', '2027-08-12', 'Schijnpoortweg 119, Merksem (Antwerpen), Belgium'),
      concert('qa-v164-lotto', 'Lotto Arena Antwerpen', 'Merksem (Antwerpen)', 'Belgium', '2027-08-13', 'Schijnpoortweg 119, Merksem (Antwerpen), Belgium'),
      concert('qa-v164-unknown-ambiguous', 'Unknown venue', 'Merksem (Antwerpen)', 'Belgium', '2027-08-14', 'Schijnpoortweg 119, Merksem (Antwerpen), Belgium'),
      concert('qa-v164-ippodromo-milan', 'Ippodromo SNAI San Siro', 'Milan', 'Italy', '2027-08-15', 'Via Diomede 1, 20151 Milano, Italy'),
      concert('qa-v164-ippodromo-milano', 'Ippodromo SNAI San Siro', 'Milano', 'Italy', '2027-08-16', 'Via Diomede, 1, 20148 Milano MI, Italy'),
      concert('qa-v164-hollywood-bowl-la', 'Hollywood Bowl', 'Los Angeles', 'USA', '2027-08-17', '2301 N Highland Ave, Los Angeles, USA'),
      concert('qa-v164-hollywood-bowl-hollywood', 'Hollywood Bowl', 'Hollywood', 'United States Of America', '2027-08-18', '2301 N Highland Ave, Hollywood, United States'),
      concert('qa-v164-greek-berkeley', 'Greek Theatre', 'Berkeley', 'United States', '2027-08-19', '2001 Gayley Road, Berkeley, United States'),
      concert('qa-v164-greek-la', 'Greek Theatre', 'Los Angeles', 'United States', '2027-08-20', '2700 N Vermont Ave, Los Angeles, United States'),
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
      record('Roxy', 'Prague', 'Czech Republic', null, 'Dlouhá 33, 110 00 Prague, Czech Republic', {
        identityAliases: [{ name: 'Roxy', city: 'Praha 1', country: 'Czech Republic', address: 'Dlouhá 33, Praha 1, Czech Republic' }],
      }),
      record('AFAS Dome', 'Merksem (Antwerpen)', 'Belgium', 23001, 'Schijnpoortweg 119, Merksem (Antwerpen), Belgium'),
      record('Lotto Arena Antwerpen', 'Merksem (Antwerpen)', 'Belgium', 8050, 'Schijnpoortweg 119, Merksem (Antwerpen), Belgium'),
      record('Ippodromo SNAI San Siro', 'Milan', 'Italy', null, 'Via Diomede 1, 20151 Milano, Italy'),
      record('Ippodromo SNAI San Siro', 'Milano', 'Italy', null, 'Via Diomede, 1, 20148 Milano MI, Italy'),
    ]);
  });
}

test('v164 venue directory uses canonical physical venue identity across the full list', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);
  await seedCanonicalVenueCases(page);

  await page.locator('#tabbar [data-tab="concerts"]').click();
  await page.locator('[data-discover-tab="venues"]').click();

  const cards = page.locator('.venue-metadata-list-card');
  await expect(cards).toHaveCount(11);
  await expect(cards.filter({ hasText: 'Unknown venue' })).toHaveCount(0);

  const expected = [
    ['Royal Arena', 'Copenhagen, Denmark', '2 shows on record'],
    ['Pumpehuset', 'Copenhagen, Denmark', '2 shows on record'],
    ['Nordichallen', 'Sundsvall, Sweden', '2 shows on record'],
    ['Filmstudion', 'Gothenburg, Sweden', '2 shows on record'],
    ['Roxy', 'Prague, Czech Republic', '2 shows on record'],
    ['Ippodromo SNAI San Siro', null, '2 shows on record'],
    ['Hollywood Bowl', null, '2 shows on record'],
  ];
  for (const [name, location, count] of expected) {
    const card = cards.filter({ hasText: name });
    await expect(card).toHaveCount(1);
    if (location) await expect(card).toContainText(location);
    await expect(card).toContainText(count);
  }

  await expect(cards.filter({ hasText: 'AFAS Dome' })).toHaveCount(1);
  await expect(cards.filter({ hasText: 'Lotto Arena Antwerpen' })).toHaveCount(1);
  await expect(cards.filter({ hasText: 'AFAS Dome' })).toContainText('1 show on record');
  await expect(cards.filter({ hasText: 'Lotto Arena Antwerpen' })).toContainText('1 show on record');

  const greek = cards.filter({ hasText: 'Greek Theatre' });
  await expect(greek).toHaveCount(2);
  await expect(greek.filter({ hasText: 'Berkeley' })).toHaveCount(1);
  await expect(greek.filter({ hasText: 'Los Angeles' })).toHaveCount(1);

  const royal = cards.filter({ hasText: 'Royal Arena' });
  await expect(royal.locator('.venue-card-max-capacity')).toHaveText('Max Capacity: 17 000');
  await royal.click();
  await expect(page.locator('#screen-venue-detail .venue-detail-location')).toHaveText('Copenhagen, Denmark');
  await expect(page.locator('#screen-venue-detail .row-card[data-band-id]')).toHaveCount(2);

  expect(errors).toEqual([]);
});

test('v164 placeholder recovery is canonical-only and requires one unique physical venue', async ({ page }, testInfo) => {
  await openApp(page, testInfo);
  await seedCanonicalVenueCases(page);

  const result = await page.evaluate(() => ({
    ordinaryMetadata: VenueMetadataV158.metadataFor({
      venue: 'Unknown venue', city: 'Sundsvall', country: 'Sweden', venueAddress: 'Nordichallen, Sundsvall, Sweden',
    })?.name || null,
    resolved: VenueMetadataV158.canonicalVenueIdentity({
      venue: 'Unknown venue', city: 'Sundsvall', country: 'Sweden', venueAddress: 'Nordichallen, Sundsvall, Sweden',
    })?.venue || null,
    ambiguous: VenueMetadataV158.canonicalVenueIdentity({
      venue: 'Unknown venue', city: 'Merksem (Antwerpen)', country: 'Belgium', venueAddress: 'Schijnpoortweg 119, Merksem (Antwerpen), Belgium',
    })?.venue || null,
    missingEvidence: VenueMetadataV158.canonicalVenueIdentity({
      venue: 'Unknown venue', city: 'Bergen', country: 'Norway', venueAddress: null,
    })?.venue || null,
  }));

  expect(result.ordinaryMetadata).toBeNull();
  expect(result.resolved).toBe('Nordichallen');
  expect(result.ambiguous).toBeNull();
  expect(result.missingEvidence).toBeNull();
});

test('v164 canonical lookup does not bypass known address conflicts through address-less aliases', async ({ page }, testInfo) => {
  await openApp(page, testInfo);

  const result = await page.evaluate(() => {
    VenueMetadataV158.setRecords([{
      venueId: VenueMetadataModelV158.venueIdFor({ name: 'Example Hall', city: 'Copenhagen', country: 'Denmark' }),
      name: 'Example Hall', city: 'Copenhagen', country: 'Denmark',
      address: 'Correct Street 1, Copenhagen, Denmark',
      identityAliases: [{ name: 'Example Hall', city: 'København', country: 'Denmark' }],
      researchStatus: 'partial', schemaVersion: 1,
    }]);
    const conflicting = { venue: 'Example Hall', city: 'København', country: 'Denmark', venueAddress: 'Different Street 9, København, Denmark' };
    return {
      ordinary: VenueMetadataV158.metadataFor(conflicting)?.venueId || null,
      canonical: VenueMetadataV158.canonicalVenueIdentity(conflicting),
    };
  });

  expect(result.ordinary).toBeNull();
  expect(result.canonical?.record || null).toBeNull();
  expect(result.canonical).toMatchObject({ venue: 'Example Hall', city: 'København' });
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
      { id: 'stats-5', bandId: 'e', bandName: 'E', venue: 'Hollywood Bowl', city: 'Los Angeles', country: 'USA', venueAddress: '2301 N Highland Ave, Los Angeles, USA', date: '2025-05-01', attending: true },
      { id: 'stats-6', bandId: 'f', bandName: 'F', venue: 'Hollywood Bowl', city: 'Hollywood', country: 'United States Of America', venueAddress: '2301 N Highland Ave, Hollywood, United States', date: '2025-06-01', attending: true },
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
  expect(result.uniqueVenues).toBe(3);
  expect(result.topVenues.some((venue) => venue.venue === 'Unknown venue')).toBe(false);
  expect(result.topVenues.find((venue) => venue.venue === 'Royal Arena')?.count).toBe(2);
  expect(result.topVenues.find((venue) => venue.venue === 'Nordichallen')?.count).toBe(1);
  expect(result.topVenues.find((venue) => venue.venue === 'Hollywood Bowl')?.count).toBe(2);
});

test('v164 canonical venue stats do not change event-level calculations', async ({ page }, testInfo) => {
  await openApp(page, testInfo);
  await seedCanonicalVenueCases(page);

  const result = await page.evaluate(() => {
    const original = [
      {
        id: 'scope-1', bandId: 'scope-a', bandName: 'Scope A', venue: 'Royal Arena', city: 'Copenhagen', country: 'Denmark',
        date: '2025-07-01', attending: true, ticketPrice: 100, ticketQuantity: 1, distanceKm: 10,
      },
      {
        id: 'scope-2', bandId: 'scope-b', bandName: 'Scope B', venue: 'Royal Arena', city: 'København S', country: 'Denmark',
        date: '2025-07-01', attending: true, ticketPrice: 200, ticketQuantity: 1, distanceKm: 20,
      },
    ];
    const before = JSON.stringify(original);
    const stats = dlConcertStats(original, [], []);
    return {
      before,
      after: JSON.stringify(original),
      totalShows: stats.totalShows,
      totalSpend: stats.totalSpend,
      knownSpendCount: stats.knownSpendCount,
      averageTicketPrice: stats.averageTicketPrice,
      kmTraveled: stats.kmTraveled,
      knownDistanceCount: stats.knownDistanceCount,
      uniqueVenues: stats.uniqueVenues,
      topVenues: stats.topVenues,
    };
  });

  expect(result.after).toBe(result.before);
  expect(result.totalShows).toBe(2);
  expect(result.totalSpend).toBe(300);
  expect(result.knownSpendCount).toBe(2);
  expect(result.averageTicketPrice).toBe(150);
  expect(result.kmTraveled).toBe(60);
  expect(result.knownDistanceCount).toBe(2);
  expect(result.uniqueVenues).toBe(1);
  expect(result.topVenues).toHaveLength(1);
  expect(result.topVenues[0]).toMatchObject({ venue: 'Royal Arena', count: 2 });
});
