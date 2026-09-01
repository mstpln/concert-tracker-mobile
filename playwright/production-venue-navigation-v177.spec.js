const { test, expect } = require('@playwright/test');

async function openApp(page, testInfo) {
  const mobile = testInfo.project.name === 'mobile-chromium';
  await page.setViewportSize({ width: mobile ? 375 : 1280, height: 900 });
  await page.emulateMedia({ colorScheme: mobile ? 'light' : 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}

async function seedMigratedProductionShape(page) {
  await page.evaluate(() => {
    const nextBands = Array.from({ length: 379 }, (_, index) => ({
      id: `qa-v177-band-${index}`,
      name: `QA v177 Band ${index}`,
      genre: 'Rock',
    }));
    bands.splice(0, bands.length, ...nextBands);

    const venueRecords = Array.from({ length: 540 }, (_, index) => ({
      venueId: `venue-v177-${String(index).padStart(4, '0')}`,
      name: `QA v177 Canonical Venue ${String(index).padStart(3, '0')}`,
      city: `QA v177 City ${index}`,
      country: index % 2 ? 'Sweden' : 'Denmark',
      address: `QA v177 Street ${index}, QA v177 City ${index}`,
      researchStatus: 'partial',
      schemaVersion: 1,
      legacyVenueIds: index % 31 === 0 ? [`venue-v177-legacy-${index}`] : undefined,
    }));
    VenueMetadataV158.setRecords(venueRecords);

    const nextConcerts = Array.from({ length: 2989 }, (_, index) => {
      const venue = venueRecords[index % venueRecords.length];
      const band = nextBands[index % nextBands.length];
      const migratedCanonical = index < 1100;
      return {
        id: `qa-v177-concert-${index}`,
        bandId: band.id,
        bandName: band.name,
        // Production migration intentionally preserves raw/historical provider
        // wording. These rows therefore cannot depend on a raw-name match.
        venue: migratedCanonical ? `Historical Provider Wording ${index}` : venue.name,
        city: migratedCanonical && index % 3 === 0 ? '' : venue.city,
        country: migratedCanonical && index % 5 === 0 ? '' : venue.country,
        venueAddress: migratedCanonical ? null : venue.address,
        canonicalVenueId: migratedCanonical ? venue.venueId : undefined,
        date: `2027-${String(1 + (index % 12)).padStart(2, '0')}-${String(1 + (index % 27)).padStart(2, '0')}`,
        time: index % 2 ? '19:00' : '21:30',
        distanceKm: index % 900,
        attending: index % 43 === 0,
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

test('v177 migrated canonicalVenueId rows keep Discover > Venues responsive and open detail', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);
  await seedMigratedProductionShape(page);

  const result = await page.evaluate(() => {
    const canonicalRecord = VenueMetadataV158.getRecords()[0];
    const direct = VenueMetadataV158.metadataFor({
      canonicalVenueId: canonicalRecord.venueId,
      venue: 'Completely different historical wording',
      city: '',
      country: '',
    });

    const start = performance.now();
    concertsSubTab = 'venues';
    renderConcertsScreen();
    const venuesMs = performance.now() - start;
    const cards = [...document.querySelectorAll('#screen-concerts .venue-metadata-list-card')];
    const firstKey = cards[0]?.dataset.venueKey;
    const detailStart = performance.now();
    openVenueDetail(firstKey);
    const detailMs = performance.now() - detailStart;

    return {
      directVenueId: direct?.venueId || null,
      expectedVenueId: canonicalRecord.venueId,
      venueCount: cards.length,
      venuesMs,
      detailMs,
      detailHasRows: document.querySelectorAll('#screen-venue-detail .row-card[data-band-id]').length > 0,
      navigation: LiveVaultVenueNavigationPerformanceV166.getMetrics(),
      lookup: LiveVaultVenueMetadataLookupPerformanceV166.getMetrics(),
    };
  });

  expect(errors).toEqual([]);
  expect(result.directVenueId).toBe(result.expectedVenueId);
  expect(result.venueCount).toBe(540);
  expect(result.detailHasRows).toBe(true);
  expect(result.navigation.groupBuilds).toBe(1);
  expect(result.lookup.indexBuilds).toBe(1);
  expect(result.venuesMs).toBeLessThan(3000);
  expect(result.detailMs).toBeLessThan(1000);
});
