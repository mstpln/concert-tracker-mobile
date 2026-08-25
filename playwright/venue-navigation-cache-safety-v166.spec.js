const { test, expect } = require('@playwright/test');

async function openApp(page, testInfo) {
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium' ? { width: 375, height: 900 } : { width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: testInfo.project.name === 'mobile-chromium' ? 'light' : 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}

test('v166 refresh invalidates the indexed venue metadata snapshot', async ({ page }, testInfo) => {
  await openApp(page, testInfo);

  const result = await page.evaluate(async () => {
    const record = {
      venueId: VenueMetadataModelV158.venueIdFor({ name: 'Refresh Hall', city: 'Malmö', country: 'Sweden' }),
      name: 'Refresh Hall',
      city: 'Malmö',
      country: 'Sweden',
      address: 'Refreshgatan 1, Malmö, Sweden',
      researchStatus: 'partial',
      schemaVersion: 1,
    };
    VenueMetadataV158.setRecords([record]);
    const value = {
      venue: record.name,
      city: record.city,
      country: record.country,
      venueAddress: record.address,
    };

    LiveVaultVenueMetadataLookupPerformanceV166.invalidate();
    VenueMetadataV158.metadataFor(value);
    const afterInitialLookup = LiveVaultVenueMetadataLookupPerformanceV166.getMetrics().indexBuilds;

    // The QA backend deliberately has no venues.json fixture. The normal v158
    // Refresh path therefore replaces the synthetic record above with [], which
    // still exercises the real closed-over loader boundary without production data.
    await loadDataAndShowApp();
    VenueMetadataV158.metadataFor(value);
    const afterRefreshLookup = LiveVaultVenueMetadataLookupPerformanceV166.getMetrics().indexBuilds;

    return { afterInitialLookup, afterRefreshLookup };
  });

  expect(result.afterRefreshLookup).toBe(result.afterInitialLookup + 1);
});

test('v166 placeholder candidate indexing preserves v164 name-prefix evidence', async ({ page }, testInfo) => {
  await openApp(page, testInfo);

  const result = await page.evaluate(() => {
    VenueMetadataV158.setRecords([
      {
        venueId: VenueMetadataModelV158.venueIdFor({ name: 'Prefix Hall', city: 'Testville', country: 'Sweden' }),
        name: 'Prefix Hall',
        city: 'Testville',
        country: 'Sweden',
        address: 'Other Road 9, Testville, Sweden',
        researchStatus: 'partial',
        schemaVersion: 1,
      },
      {
        venueId: VenueMetadataModelV158.venueIdFor({ name: 'Other Venue', city: 'Elsewhere', country: 'Denmark' }),
        name: 'Other Venue',
        city: 'Elsewhere',
        country: 'Denmark',
        address: 'Prefix Hall, Testville, Sweden',
        researchStatus: 'partial',
        schemaVersion: 1,
      },
    ]);

    const value = {
      venue: 'Unknown venue',
      city: 'Testville',
      country: 'Sweden',
      venueAddress: 'Prefix Hall, Testville, Sweden',
    };
    const index = LiveVaultVenueNavigationPerformanceV166.buildRecordIndex(VenueMetadataV158.getRecords());
    const oldIdentity = VenueMetadataV158.canonicalVenueIdentity(value);
    const fastIdentity = LiveVaultVenueNavigationPerformanceV166.canonicalVenueIdentityFast(value, index);
    return {
      oldVenueId: oldIdentity?.record?.venueId || null,
      fastVenueId: fastIdentity?.record?.venueId || null,
    };
  });

  expect(result.oldVenueId).not.toBeNull();
  expect(result.fastVenueId).toBe(result.oldVenueId);
});

test('v166 venue caches invalidate description and day-dependent rendering', async ({ page }, testInfo) => {
  await openApp(page, testInfo);

  const result = await page.evaluate(() => {
    const venue = {
      venueId: VenueMetadataModelV158.venueIdFor({ name: 'Cache Hall', city: 'Malmö', country: 'Sweden' }),
      name: 'Cache Hall',
      city: 'Malmö',
      country: 'Sweden',
      address: 'Cachegatan 1, Malmö, Sweden',
      description: 'Original description',
      researchStatus: 'partial',
      schemaVersion: 1,
    };
    const band = { id: 'qa-cache-band', name: 'QA Cache Band' };
    const concert = {
      id: 'qa-cache-concert',
      bandId: band.id,
      bandName: band.name,
      venue: venue.name,
      city: venue.city,
      country: venue.country,
      venueAddress: venue.address,
      date: '2030-01-02',
      time: '20:00',
      attending: true,
    };

    bands.splice(0, bands.length, band);
    concerts.splice(0, concerts.length, concert);
    VenueMetadataV158.setRecords([venue]);
    concertsSubTab = 'venues';
    venuesNearbyOnly = false;
    venuesEuropeOnly = false;
    venuesPastOnly = true;

    globalThis.__LIVEVAULT_QA_NOW__ = '2030-01-02T10:00:00Z';
    renderConcertsScreen();
    const cardsOnConcertDay = document.querySelectorAll('#screen-concerts .venue-metadata-list-card').length;

    const group = LiveVaultVenueNavigationPerformanceV166.canonicalVenueGroupsFast().groups[0];
    openVenueDetail(group.key);
    const initialDescription = document.querySelector('#screen-venue-detail .venue-detail-description')?.textContent || '';
    const initialPill = document.querySelector('#screen-venue-detail .pill')?.textContent.trim() || '';

    const firstIndex = LiveVaultVenueNavigationPerformanceV166.buildRecordIndex(VenueMetadataV158.getRecords());
    VenueMetadataV158.setRecords([{ ...venue, description: 'Updated description' }]);
    const secondIndex = LiveVaultVenueNavigationPerformanceV166.buildRecordIndex(VenueMetadataV158.getRecords());
    const descriptionSignatureChanged = firstIndex.signature !== secondIndex.signature;

    globalThis.__LIVEVAULT_QA_NOW__ = '2030-01-03T10:00:00Z';
    currentScreen = 'main';
    showScreen('screen-concerts');
    renderConcertsScreen();
    const cardsNextDay = document.querySelectorAll('#screen-concerts .venue-metadata-list-card').length;

    const nextGroup = LiveVaultVenueNavigationPerformanceV166.canonicalVenueGroupsFast().groups[0];
    openVenueDetail(nextGroup.key);
    const updatedDescription = document.querySelector('#screen-venue-detail .venue-detail-description')?.textContent || '';
    const nextDayPill = document.querySelector('#screen-venue-detail .pill')?.textContent.trim() || '';

    delete globalThis.__LIVEVAULT_QA_NOW__;
    return {
      cardsOnConcertDay,
      cardsNextDay,
      initialDescription,
      updatedDescription,
      initialPill,
      nextDayPill,
      descriptionSignatureChanged,
    };
  });

  expect(result.cardsOnConcertDay).toBe(0);
  expect(result.cardsNextDay).toBe(1);
  expect(result.initialDescription).toBe('Original description');
  expect(result.updatedDescription).toBe('Updated description');
  expect(result.initialPill).toContain('Going');
  expect(result.nextDayPill).toContain('Attended');
  expect(result.descriptionSignatureChanged).toBe(true);
});
