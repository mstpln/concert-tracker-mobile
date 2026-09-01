const { test, expect } = require('@playwright/test');

async function openApp(page, testInfo) {
  const mobile = testInfo.project.name === 'mobile-chromium';
  await page.setViewportSize({ width: mobile ? 375 : 1280, height: 900 });
  await page.emulateMedia({ colorScheme: mobile ? 'light' : 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
  // The QA banner is rendered before the asynchronous fake-backend refresh is
  // necessarily complete. Finish that local refresh before replacing its data
  // so it cannot race the migration-shaped fixture and clear venue records.
  await page.evaluate(() => loadDataAndShowApp());
}

async function seedMigratedProductionShape(page) {
  await page.evaluate(() => {
    const nextBands = Array.from({ length: 379 }, (_, index) => ({
      id: `qa-v177-band-${index}`,
      name: `QA v177 Band ${index}`,
      genre: 'Rock',
    }));
    bands.splice(0, bands.length, ...nextBands);

    const venueRecords = Array.from({ length: 540 }, (_, index) => {
      const name = `QA v177 Canonical Venue ${String(index).padStart(3, '0')}`;
      const city = `QA v177 City ${index}`;
      const country = index % 2 ? 'Sweden' : 'Denmark';
      return {
        venueId: VenueMetadataModelV158.venueIdFor({ name, city, country }),
        name, city, country,
        address: `QA v177 Street ${index}, ${city}`,
        researchStatus: 'partial',
        schemaVersion: 1,
        legacyVenueIds: index % 31 === 0 ? [VenueMetadataModelV158.venueIdFor({ name: `QA v177 Legacy Venue ${index}`, city, country })] : undefined,
      };
    });
    VenueMetadataV158.setRecords(venueRecords);

    const nextConcerts = Array.from({ length: 2989 }, (_, index) => {
      const venue = venueRecords[index % venueRecords.length];
      const band = nextBands[index % nextBands.length];
      const migratedCanonical = index < 1017;
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
    concertsSubTab = 'concerts';
    renderConcertsScreen();
    const groupBuildsAfterConcerts = LiveVaultVenueNavigationPerformanceV166.getMetrics().groupBuilds;
    concertsSubTab = 'venues';
    renderConcertsScreen();
    const venuesMs = performance.now() - start;
    const cards = [...document.querySelectorAll('#screen-concerts .venue-metadata-list-card')];
    const firstKey = cards[0]?.dataset.venueKey;
    const secondKey = cards[1]?.dataset.venueKey;
    history.replaceState({ tab: 'concerts', screen: 'main' }, '');
    const detailStart = performance.now();
    openVenueDetail(firstKey);
    const detailMs = performance.now() - detailStart;

    return {
      directVenueId: direct?.venueId || null,
      expectedVenueId: canonicalRecord.venueId,
      venueCount: cards.length,
      secondKey,
      venuesMs,
      detailMs,
      detailHasRows: document.querySelectorAll('#screen-venue-detail .row-card[data-band-id]').length > 0,
      groupBuildsAfterConcerts,
      navigation: LiveVaultVenueNavigationPerformanceV166.getMetrics(),
      lookup: LiveVaultVenueMetadataLookupPerformanceV166.getMetrics(),
    };
  });

  await page.goBack();
  await expect(page.locator('#screen-concerts')).toBeVisible();
  const secondDetail = await page.evaluate((secondKey) => {
    const start = performance.now();
    openVenueDetail(secondKey);
    return {
      detailMs: performance.now() - start,
      detailHasRows: document.querySelectorAll('#screen-venue-detail .row-card[data-band-id]').length > 0,
      navigation: LiveVaultVenueNavigationPerformanceV166.getMetrics(),
      detailDelegated: document.querySelector('#screen-venue-detail')?.dataset.v166VenueDetailDelegated || '',
    };
  }, result.secondKey);

  expect(errors).toEqual([]);
  expect(result.directVenueId).toBe(result.expectedVenueId);
  expect(result.venueCount).toBe(540);
  expect(result.detailHasRows).toBe(true);
  expect(result.groupBuildsAfterConcerts).toBe(0);
  expect(result.navigation.groupBuilds).toBe(1);
  expect(result.lookup.indexBuilds).toBe(1);
  expect(result.venuesMs).toBeLessThan(3000);
  expect(result.detailMs).toBeLessThan(1000);
  expect(secondDetail.detailHasRows).toBe(true);
  expect(secondDetail.navigation.groupBuilds).toBe(1);
  expect(secondDetail.detailDelegated).toBe('true');
  expect(secondDetail.detailMs).toBeLessThan(1000);
});

test('v177 canonical and legacy ID lookup stays fast, safe, fail-closed, and refreshable', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);

  const result = await page.evaluate(() => {
    const currentId = VenueMetadataModelV158.venueIdFor({ name: 'QA Current Hall', city: 'Copenhagen', country: 'Denmark' });
    const uniqueLegacyId = VenueMetadataModelV158.venueIdFor({ name: 'QA Former Hall', city: 'København', country: 'Denmark' });
    const branchAId = VenueMetadataModelV158.venueIdFor({ name: 'QA Branch A', city: 'Malmö', country: 'Sweden' });
    const branchBId = VenueMetadataModelV158.venueIdFor({ name: 'QA Branch B', city: 'Stockholm', country: 'Sweden' });
    const collisionId = VenueMetadataModelV158.venueIdFor({ name: 'QA Shared Legacy Branch', city: 'Sweden', country: 'Sweden' });
    const missingId = VenueMetadataModelV158.venueIdFor({ name: 'QA Missing Venue', city: 'Nowhere', country: 'Denmark' });
    const records = [
      {
        venueId: currentId,
        legacyVenueIds: [uniqueLegacyId],
        name: 'QA Current Hall', city: 'Copenhagen', country: 'Denmark', address: 'Current Street 1, Copenhagen, Denmark',
        identityAliases: [{ name: 'QA Historical Hall', city: 'København', country: 'Denmark', address: 'Old Street 9, København, Denmark' }],
        researchStatus: 'partial', schemaVersion: 1,
      },
      {
        venueId: branchAId, legacyVenueIds: [collisionId],
        name: 'QA Branch A', city: 'Malmö', country: 'Sweden', address: 'A Street 1, Malmö, Sweden', researchStatus: 'partial', schemaVersion: 1,
      },
      {
        venueId: branchBId, legacyVenueIds: [collisionId],
        name: 'QA Branch B', city: 'Stockholm', country: 'Sweden', address: 'B Street 2, Stockholm, Sweden', researchStatus: 'partial', schemaVersion: 1,
      },
    ];
    VenueMetadataV158.setRecords(records);
    LiveVaultVenueMetadataLookupPerformanceV166.invalidate();

    const direct = VenueMetadataV158.metadataFor({ canonicalVenueId: currentId, venue: 'Different provider wording', city: '', country: '' });
    const uniqueLegacy = VenueMetadataV158.metadataFor({ canonicalVenueId: uniqueLegacyId, venue: 'Different historical wording', city: '', country: '' });
    const missingIdFallback = VenueMetadataV158.metadataFor({ venue: 'QA Current Hall', city: 'Copenhagen', country: 'Denmark' });
    const invalidIdFallback = VenueMetadataV158.metadataFor({ canonicalVenueId: missingId, venue: 'QA Current Hall', city: 'Copenhagen', country: 'Denmark' });
    const invalidIdNoEvidence = VenueMetadataV158.metadataFor({ canonicalVenueId: missingId, venue: 'Unrelated venue wording', city: '', country: '' });
    const ambiguousLegacy = VenueMetadataV158.metadataFor({ canonicalVenueId: collisionId, venue: 'Unrelated venue wording', city: '', country: '' });
    const historicalAlias = VenueMetadataV158.metadataFor({ venue: 'QA Historical Hall', city: 'København', country: 'Denmark', venueAddress: 'Old Street 9, København, Denmark' });
    const buildsBeforeSetRecords = LiveVaultVenueMetadataLookupPerformanceV166.getMetrics().indexBuilds;

    VenueMetadataV158.setRecords([{ ...records[0], name: 'QA Current Hall Updated' }]);
    const afterSetRecords = VenueMetadataV158.metadataFor({ canonicalVenueId: currentId, venue: 'Still different provider wording' });
    const metrics = LiveVaultVenueMetadataLookupPerformanceV166.getMetrics();
    return {
      direct: direct?.venueId || null,
      uniqueLegacy: uniqueLegacy?.venueId || null,
      missingIdFallback: missingIdFallback?.venueId || null,
      invalidIdFallback: invalidIdFallback?.venueId || null,
      invalidIdNoEvidence: invalidIdNoEvidence?.venueId || null,
      ambiguousLegacy: ambiguousLegacy?.venueId || null,
      historicalAlias: historicalAlias?.venueId || null,
      afterSetRecordsName: afterSetRecords?.name || null,
      currentId,
      buildsBeforeSetRecords,
      metrics,
    };
  });

  expect(errors).toEqual([]);
  expect(result.direct).toBe(result.currentId);
  expect(result.uniqueLegacy).toBe(result.currentId);
  expect(result.missingIdFallback).toBe(result.currentId);
  expect(result.invalidIdFallback).toBe(result.currentId);
  expect(result.invalidIdNoEvidence).toBeNull();
  expect(result.ambiguousLegacy).toBeNull();
  expect(result.historicalAlias).toBe(result.currentId);
  expect(result.afterSetRecordsName).toBe('QA Current Hall Updated');
  expect(result.metrics.indexBuilds).toBe(result.buildsBeforeSetRecords + 1);
});
