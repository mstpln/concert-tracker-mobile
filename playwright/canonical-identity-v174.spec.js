const { test, expect } = require('@playwright/test');

async function openApp(page, testInfo, options = {}) {
  const mobile = testInfo.project.name === 'mobile-chromium';
  await page.setViewportSize({ width: options.width || (mobile ? 375 : 1280), height: 900 });
  await page.emulateMedia({ colorScheme: options.colorScheme || (mobile ? 'light' : 'dark'), reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}

async function seedIdentityFixture(page) {
  await page.evaluate(() => {
    VenueMetadataV158.setRecords([
      {
        venueId: VenueMetadataModelV158.venueIdFor({ name: 'The O2 Belfast', city: 'Belfast', country: 'United Kingdom' }),
        name: 'The O2 Belfast', currentName: 'The O2 Belfast', city: 'Belfast', country: 'United Kingdom',
        address: '2 Queens Quay, Belfast, United Kingdom',
        historicalNames: [{ name: 'SSE Arena Belfast', city: 'Belfast', country: 'United Kingdom', address: '2 Queens Quay, Belfast, United Kingdom' }],
        researchStatus: 'partial', schemaVersion: 1,
      },
      {
        venueId: VenueMetadataModelV158.venueIdFor({ name: 'Aviva Studios', city: 'Manchester', country: 'United Kingdom' }),
        name: 'Aviva Studios', city: 'Manchester', country: 'United Kingdom', address: 'Water Street, Manchester, United Kingdom',
        subLocations: [{ name: 'Warehouse', type: 'room' }], researchStatus: 'partial', schemaVersion: 1,
      },
      {
        venueId: VenueMetadataModelV158.venueIdFor({ name: 'AFAS Dome', city: 'Antwerp', country: 'Belgium' }),
        name: 'AFAS Dome', city: 'Antwerp', country: 'Belgium', address: 'Schijnpoortweg 119, Antwerp, Belgium', researchStatus: 'partial', schemaVersion: 1,
      },
      {
        venueId: VenueMetadataModelV158.venueIdFor({ name: 'Lotto Arena Antwerpen', city: 'Antwerp', country: 'Belgium' }),
        name: 'Lotto Arena Antwerpen', city: 'Antwerp', country: 'Belgium', address: 'Schijnpoortweg 119, Antwerp, Belgium', researchStatus: 'partial', schemaVersion: 1,
      },
    ]);

    bands.splice(0, bands.length,
      { id: 'qa-v174-katseye', name: 'KATSEYE', genre: 'Pop' },
      { id: 'qa-v174-support', name: 'QA Support', genre: 'Rock' },
      { id: 'qa-v174-headliner', name: 'QA Headliner', genre: 'Rock' },
      { id: 'qa-v174-history', name: 'QA History', genre: 'Rock' },
    );
    concerts.splice(0, concerts.length,
      { id: 'qa-v174-k1', bandId: 'qa-v174-katseye', bandName: 'KATSEYE', date: '2030-09-10', time: '19:00', venue: 'Aviva Studios', city: 'Manchester', country: 'United Kingdom', attending: true, providerEventId: 'tm-a' },
      { id: 'qa-v174-k2', bandId: 'qa-v174-katseye', bandName: 'KATSEYE', date: '2030-09-10', time: '21:30', venue: 'Warehouse', city: 'Manchester', country: 'United Kingdom', attending: true, providerEventId: 'tm-b' },
      { id: 'qa-v174-s', bandId: 'qa-v174-support', bandName: 'QA Support', date: '2030-10-18', venue: 'Warehouse', city: 'Manchester', country: 'United Kingdom', attending: true, lineupRole: 'support', ticketPrice: 0, ticketQuantity: 1, distanceKm: 50 },
      { id: 'qa-v174-h', bandId: 'qa-v174-headliner', bandName: 'QA Headliner', date: '2030-10-18', venue: 'Aviva Studios', city: 'Manchester', country: 'United Kingdom', attending: true, lineupRole: 'headliner', ticketPrice: 900, ticketQuantity: 1, distanceKm: 50 },
      { id: 'qa-v174-old', bandId: 'qa-v174-history', bandName: 'QA History', date: '2024-05-01', venue: 'SSE Arena Belfast', city: 'Belfast', country: 'United Kingdom', venueAddress: '2 Queens Quay, Belfast, United Kingdom', attending: true },
      { id: 'qa-v174-future', bandId: 'qa-v174-history', bandName: 'QA History', date: '2030-05-01', venue: 'SSE Arena Belfast', city: 'Belfast', country: 'United Kingdom', venueAddress: '2 Queens Quay, Belfast, United Kingdom', attending: false },
    );
    CanonicalIdentityRuntimeV174.invalidate();
    LiveVaultVenueMetadataLookupPerformanceV166.invalidate();
    LiveVaultVenueNavigationPerformanceV166.invalidate();
    LiveVaultVenueNavigationRenderPerformanceV166.invalidate();
  });
}

test('v174 read-time identity collapses duplicate concerts and preserves historical/current venue display', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);
  await seedIdentityFixture(page);

  const result = await page.evaluate(() => {
    const mine = dlMyConcerts(concerts);
    const katseye = mine.upcoming.filter((record) => record.bandId === 'qa-v174-katseye');
    const historical = mine.past.find((record) => record.id === 'qa-v174-old');
    const future = dlAllUpcomingForBand(concerts, 'qa-v174-history').find((record) => record.id === 'qa-v174-future');
    const grouped = EventModelV156.groupConcertPerformances(concerts.filter((record) => ['qa-v174-s', 'qa-v174-h'].includes(record.id)));
    const event = grouped[0];
    const room = VenueMetadataV158.canonicalVenueIdentity({ venue: 'Warehouse', city: 'Manchester', country: 'United Kingdom' });
    const afas = VenueMetadataV158.canonicalVenueIdentity({ venue: 'AFAS Dome', city: 'Antwerp', country: 'Belgium' });
    const lotto = VenueMetadataV158.canonicalVenueIdentity({ venue: 'Lotto Arena Antwerpen', city: 'Antwerp', country: 'Belgium' });
    return {
      katseyeCount: katseye.length,
      katseyeVenue: katseye[0]?.venue,
      historicalVenue: historical?.venue,
      futureVenue: future?.venue,
      eventCount: grouped.length,
      eventValid: event?.validation?.valid,
      eventTicketCost: EventModelV156.resolveEventTicketCost(event.records).value,
      roomVenueId: room?.canonicalVenueId || room?.record?.venueId,
      afasVenueId: afas?.canonicalVenueId || afas?.record?.venueId,
      lottoVenueId: lotto?.canonicalVenueId || lotto?.record?.venueId,
      identityIndexBuilds: CanonicalIdentityRuntimeV174.getMetrics().indexBuilds,
    };
  });

  expect(errors).toEqual([]);
  expect(result.katseyeCount).toBe(1);
  expect(result.katseyeVenue).toBe('Aviva Studios');
  expect(result.historicalVenue).toBe('SSE Arena Belfast');
  expect(result.futureVenue).toBe('The O2 Belfast');
  expect(result.eventCount).toBe(1);
  expect(result.eventValid).toBe(true);
  expect(result.eventTicketCost).toBe(900);
  expect(result.roomVenueId).toBeTruthy();
  expect(result.afasVenueId).not.toBe(result.lottoVenueId);
  expect(result.identityIndexBuilds).toBe(1);

  await page.evaluate(() => {
    currentTab = 'myconcerts';
    currentScreen = 'main';
    showScreen('screen-myconcerts');
    renderMyConcertsScreen();
  });
  await expect(page.locator('#screen-myconcerts')).toContainText('KATSEYE');
  await expect(page.locator('#screen-myconcerts')).toContainText('Aviva Studios');
});

async function seedProductionScale(page) {
  await page.evaluate(() => {
    const nextBands = Array.from({ length: 379 }, (_, index) => ({ id: `qa-v174-band-${index}`, name: `QA v174 Band ${index}`, genre: 'Rock' }));
    bands.splice(0, bands.length, ...nextBands);
    const venueRecords = Array.from({ length: 530 }, (_, index) => {
      const name = `QA v174 Venue ${String(index).padStart(3, '0')}`;
      const city = `QA v174 City ${index}`;
      const country = index % 2 ? 'Sweden' : 'Denmark';
      const address = `QA v174 Street ${index}, ${city}, ${country}`;
      return {
        venueId: VenueMetadataModelV158.venueIdFor({ name, city, country }), name, city, country, address,
        researchStatus: 'partial', schemaVersion: 1,
        subLocations: index % 25 === 0 ? [{ name: `${name} Room A`, type: 'room' }] : undefined,
        historicalNames: index % 40 === 0 ? [{ name: `${name} Old`, city, country, address }] : undefined,
      };
    });
    VenueMetadataV158.setRecords(venueRecords);
    const nextConcerts = Array.from({ length: 3300 }, (_, index) => {
      const venueIndex = index % venueRecords.length;
      const venue = venueRecords[venueIndex];
      const band = nextBands[index % nextBands.length];
      return {
        id: `qa-v174-concert-${index}`, bandId: band.id, bandName: band.name,
        venue: venueIndex % 25 === 0 && index % 2 === 0 ? `${venue.name} Room A` : venue.name,
        city: venue.city, country: venue.country, venueAddress: venue.address,
        date: `2027-${String(1 + (index % 12)).padStart(2, '0')}-${String(1 + (index % 27)).padStart(2, '0')}`,
        time: index % 2 ? '19:00' : '21:30', distanceKm: 5 + (index % 800), attending: index % 43 === 0,
      };
    });
    concerts.splice(0, concerts.length, ...nextConcerts);
    CanonicalIdentityRuntimeV174.invalidate();
    LiveVaultVenueMetadataLookupPerformanceV166.invalidate();
    LiveVaultVenueNavigationPerformanceV166.invalidate();
    LiveVaultVenueNavigationRenderPerformanceV166.invalidate();
    concertsSubTab = 'concerts';
    nearbyOnly = false;
    europeOnly = false;
    venuesNearbyOnly = false;
    venuesEuropeOnly = false;
    venuesPastOnly = false;
    if (typeof swedenOnly !== 'undefined') swedenOnly = false;
  });
}

test('v174 keeps v166 navigation responsive at 3300 concerts and 530 venues', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);
  await seedProductionScale(page);

  const timings = await page.evaluate(() => {
    const measure = (fn) => { const start = performance.now(); fn(); return performance.now() - start; };
    const datesMs = measure(() => { concertsSubTab = 'concerts'; renderConcertsScreen(); });
    const groupBuildsAfterDates = LiveVaultVenueNavigationPerformanceV166.getMetrics().groupBuilds;
    const venuesMs = measure(() => { concertsSubTab = 'venues'; renderConcertsScreen(); });
    const cards = document.querySelectorAll('#screen-concerts .venue-metadata-list-card');
    const firstKey = cards[0]?.dataset.venueKey;
    const detailMs = measure(() => openVenueDetail(firstKey));
    return {
      datesMs, venuesMs, detailMs, venueCount: cards.length, groupBuildsAfterDates,
      navigation: LiveVaultVenueNavigationPerformanceV166.getMetrics(),
      lookup: LiveVaultVenueMetadataLookupPerformanceV166.getMetrics(),
      identity: CanonicalIdentityRuntimeV174.getMetrics(),
    };
  });

  expect(errors).toEqual([]);
  expect(timings.venueCount).toBe(530);
  expect(timings.groupBuildsAfterDates).toBe(0);
  expect(timings.navigation.groupBuilds).toBe(1);
  expect(timings.lookup.indexBuilds).toBe(1);
  expect(timings.identity.indexBuilds).toBe(1);
  expect(timings.datesMs).toBeLessThan(1200);
  expect(timings.venuesMs).toBeLessThan(3000);
  expect(timings.detailMs).toBeLessThan(1000);
});

test('v174 mobile canonical identity view is stable at 375 light and 480 dark', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'mobile viewport coverage');
  for (const config of [{ width: 375, colorScheme: 'light' }, { width: 480, colorScheme: 'dark' }]) {
    await openApp(page, testInfo, config);
    await seedIdentityFixture(page);
    await page.evaluate(() => {
      currentTab = 'myconcerts';
      currentScreen = 'main';
      showScreen('screen-myconcerts');
      renderMyConcertsScreen();
    });
    await expect(page.locator('#screen-myconcerts')).toContainText('KATSEYE');
    await expect(page.locator('#screen-myconcerts')).toContainText('Aviva Studios');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(config.width + 1);
  }
});
