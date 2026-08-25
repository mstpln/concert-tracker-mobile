const { test, expect } = require('@playwright/test');

async function openApp(page, testInfo) {
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium' ? { width: 375, height: 900 } : { width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: testInfo.project.name === 'mobile-chromium' ? 'light' : 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}

async function seedLargeVenueCollection(page) {
  await page.evaluate(() => {
    const nextBands = Array.from({ length: 320 }, (_, index) => ({
      id: `qa-v166-band-${index}`,
      name: `QA Band ${index}`,
      genre: index % 2 ? 'Rock' : 'Pop',
    }));
    bands.splice(0, bands.length, ...nextBands);

    const venueRecords = Array.from({ length: 520 }, (_, index) => {
      const name = `QA Venue ${String(index).padStart(3, '0')}`;
      const city = `QA City ${index % 80}`;
      const country = index % 3 === 0 ? 'Sweden' : index % 3 === 1 ? 'Denmark' : 'Germany';
      const address = `QA Street ${index} 1, ${city}, ${country}`;
      return {
        venueId: VenueMetadataModelV158.venueIdFor({ name, city, country }),
        name,
        city,
        country,
        address,
        maxCapacity: 1000 + index,
        researchStatus: 'partial',
        schemaVersion: 1,
        identityAliases: index % 10 === 0
          ? [{ name, city: `${city} District`, country, address }]
          : undefined,
      };
    });
    VenueMetadataV158.setRecords(venueRecords);

    const nextConcerts = Array.from({ length: 3260 }, (_, index) => {
      const venueIndex = index % venueRecords.length;
      const venue = venueRecords[venueIndex];
      const band = nextBands[index % nextBands.length];
      const year = 2024 + (index % 5);
      const month = String(1 + (index % 12)).padStart(2, '0');
      const day = String(1 + (index % 27)).padStart(2, '0');
      return {
        id: `qa-v166-concert-${index}`,
        bandId: band.id,
        bandName: band.name,
        venue: venue.name,
        city: venueIndex % 10 === 0 && index % 2 === 0 ? `${venue.city} District` : venue.city,
        country: venue.country,
        venueAddress: venue.address,
        date: `${year}-${month}-${day}`,
        time: '20:00',
        distanceKm: 10 + (index % 600),
        attending: index % 41 === 0,
      };
    });
    concerts.splice(0, concerts.length, ...nextConcerts);

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

test('v166 indexed venue identity preserves v164 canonical decisions', async ({ page }, testInfo) => {
  await openApp(page, testInfo);

  const result = await page.evaluate(() => {
    VenueMetadataV158.setRecords([
      {
        venueId: VenueMetadataModelV158.venueIdFor({ name: 'Royal Arena', city: 'Copenhagen', country: 'Denmark' }),
        name: 'Royal Arena', city: 'Copenhagen', country: 'Denmark',
        address: 'Hannemanns Allé 18-20, Copenhagen, Denmark',
        identityAliases: [{ name: 'Royal Arena', city: 'København S', country: 'Denmark', address: 'Hannemanns Allé 18-20, København S, Denmark' }],
        researchStatus: 'partial', schemaVersion: 1,
      },
      {
        venueId: VenueMetadataModelV158.venueIdFor({ name: 'AFAS Dome', city: 'Merksem (Antwerpen)', country: 'Belgium' }),
        name: 'AFAS Dome', city: 'Merksem (Antwerpen)', country: 'Belgium',
        address: 'Schijnpoortweg 119, Merksem (Antwerpen), Belgium', researchStatus: 'partial', schemaVersion: 1,
      },
      {
        venueId: VenueMetadataModelV158.venueIdFor({ name: 'Lotto Arena Antwerpen', city: 'Merksem (Antwerpen)', country: 'Belgium' }),
        name: 'Lotto Arena Antwerpen', city: 'Merksem (Antwerpen)', country: 'Belgium',
        address: 'Schijnpoortweg 119, Merksem (Antwerpen), Belgium', researchStatus: 'partial', schemaVersion: 1,
      },
    ]);
    LiveVaultVenueMetadataLookupPerformanceV166.invalidate();
    LiveVaultVenueNavigationPerformanceV166.invalidate();
    const index = LiveVaultVenueNavigationPerformanceV166.buildRecordIndex(VenueMetadataV158.getRecords());
    const cases = [
      { venue: 'Royal Arena', city: 'København S', country: 'Denmark', venueAddress: 'Hannemanns Allé 18-20, København S, Denmark' },
      { venue: 'Unknown venue', city: 'Merksem (Antwerpen)', country: 'Belgium', venueAddress: 'Schijnpoortweg 119, Merksem (Antwerpen), Belgium' },
      { venue: 'Greek Theatre', city: 'Los Angeles', country: 'United States', venueAddress: '2700 N Vermont Ave, Los Angeles, United States' },
    ];
    return cases.map((value) => {
      const oldIdentity = VenueMetadataV158.canonicalVenueIdentity(value);
      const fastIdentity = LiveVaultVenueNavigationPerformanceV166.canonicalVenueIdentityFast(value, index);
      const compact = (identity) => identity ? {
        venue: identity.venue,
        city: identity.city,
        country: identity.country,
        venueId: identity.record?.venueId || null,
        addressHead: identity.addressHead || null,
      } : null;
      return { oldIdentity: compact(oldIdentity), fastIdentity: compact(fastIdentity) };
    });
  });

  for (const item of result) expect(item.fastIdentity).toEqual(item.oldIdentity);
});

test('v166 Dates, Venues and Venue Detail stay responsive at production-scale fixture size', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);
  await seedLargeVenueCollection(page);

  const timings = await page.evaluate(() => {
    const measure = (fn) => {
      const start = performance.now();
      fn();
      return performance.now() - start;
    };

    const datesMs = measure(() => {
      concertsSubTab = 'concerts';
      renderConcertsScreen();
    });
    const buildsAfterDates = LiveVaultVenueNavigationPerformanceV166.getMetrics().groupBuilds;

    const venuesMs = measure(() => {
      concertsSubTab = 'venues';
      renderConcertsScreen();
    });
    const venueCards = document.querySelectorAll('#screen-concerts .venue-metadata-list-card');
    const firstKey = venueCards[0]?.dataset.venueKey;
    const detailMs = measure(() => openVenueDetail(firstKey));

    const buildsBeforeCachedReturn = LiveVaultVenueNavigationPerformanceV166.getMetrics().groupBuilds;
    const cachedReturnMs = measure(() => {
      currentScreen = 'main';
      showScreen('screen-concerts');
      renderConcertsScreen();
    });
    const metrics = LiveVaultVenueNavigationPerformanceV166.getMetrics();
    const lookupMetrics = LiveVaultVenueMetadataLookupPerformanceV166.getMetrics();

    return {
      datesMs,
      venuesMs,
      detailMs,
      cachedReturnMs,
      venueCount: venueCards.length,
      detailRows: document.querySelectorAll('#screen-venue-detail .row-card[data-band-id]').length,
      buildsAfterDates,
      buildsBeforeCachedReturn,
      metrics,
      lookupMetrics,
    };
  });

  expect(errors).toEqual([]);
  expect(timings.venueCount).toBe(520);
  expect(timings.detailRows).toBeGreaterThan(0);

  // Opening the ordinary Dates list must not pay the canonical venue-grouping cost.
  expect(timings.buildsAfterDates).toBe(0);
  // The full canonical directory is built once, then reused by detail and return navigation.
  expect(timings.buildsBeforeCachedReturn).toBe(1);
  expect(timings.metrics.groupBuilds).toBe(1);
  expect(timings.metrics.groupCacheHits).toBeGreaterThanOrEqual(2);
  expect(timings.lookupMetrics.indexBuilds).toBe(1);

  // These are deliberately generous CI ceilings, not product targets. Their
  // job is to catch a return to multi-second/minute synchronous navigation.
  expect(timings.datesMs).toBeLessThan(1000);
  expect(timings.venuesMs).toBeLessThan(2500);
  expect(timings.detailMs).toBeLessThan(750);
  expect(timings.cachedReturnMs).toBeLessThan(750);
});
