const { test, expect } = require('@playwright/test');

async function openApp(page, testInfo) {
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium'
    ? { width: 375, height: 900 }
    : { width: 1280, height: 900 });
  await page.emulateMedia({
    colorScheme: testInfo.project.name === 'mobile-chromium' ? 'light' : 'dark',
    reducedMotion: 'reduce',
  });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
  await page.evaluate(() => loadDataAndShowApp());
}

async function seedProductionShape(page) {
  await page.evaluate(() => {
    const countries = ['Sweden', 'Denmark', 'United Kingdom', 'Germany', 'Spain', 'Italy'];
    const venueRecords = Array.from({ length: 540 }, (_, index) => {
      const name = `QA v178 Mixed Venue ${String(index).padStart(3, '0')}`;
      const city = `QA v178 City ${index % 180}`;
      const country = countries[index % countries.length];
      const address = `QA v178 Street ${index}, ${city}, ${country}`;
      return {
        venueId: VenueMetadataModelV158.venueIdFor({ name, city, country, address }),
        legacyVenueIds: index % 13 === 0
          ? [VenueMetadataModelV158.venueIdFor({ name: `QA v178 Legacy ${index}`, city, country })]
          : undefined,
        name, city, country, address,
        identityAliases: [{ name: `QA v178 Local Alias ${index}`, city, country, address }],
        historicalNames: [{ name: `QA v178 Historical Venue ${index}`, city, country, address }],
        locationHistory: index % 17 === 0
          ? [{ city: `Old ${city}`, country, address: `Old QA v178 Street ${index}, ${country}` }]
          : undefined,
        subLocations: index % 7 === 0 ? [{ name: `QA v178 Room ${index}`, type: 'room' }] : undefined,
        maxCapacity: index % 3 === 0 ? 1000 + index * 10 : undefined,
        officialUrl: index % 5 === 0 ? `https://venue-${index}.example.com` : undefined,
        description: index % 4 === 0 ? `Synthetic production-shaped description ${index}` : undefined,
        researchStatus: 'partial', schemaVersion: 1,
      };
    });
    const nextBands = Array.from({ length: 379 }, (_, index) => ({
      id: `qa-v178-band-${index}`,
      name: `QA v178 Band ${index}`,
      genre: 'Rock',
    }));
    const nextConcerts = Array.from({ length: 2989 }, (_, index) => {
      const venue = venueRecords[index % venueRecords.length];
      const band = nextBands[index % nextBands.length];
      const canonical = index < 1017;
      const mode = index % 8;
      let rawVenue = venue.name;
      let city = venue.city;
      let country = venue.country;
      let venueAddress = venue.address;
      if (canonical) rawVenue = `QA v178 Provider wording ${index}`;
      else if (mode === 1) rawVenue = venue.historicalNames[0].name;
      else if (mode === 2) rawVenue = venue.identityAliases[0].name;
      else if (mode === 3 && venue.subLocations?.length) rawVenue = venue.subLocations[0].name;
      else if (mode === 4) city = '';
      else if (mode === 5) country = '';
      else if (mode === 6) venueAddress = '';
      else if (mode === 7) {
        rawVenue = 'Unknown venue';
        venueAddress = `${venue.name}, ${venue.address}`;
      }
      return {
        id: `qa-v178-concert-${index}`,
        bandId: band.id,
        bandName: band.name,
        venue: rawVenue,
        city,
        country,
        venueAddress,
        canonicalVenueId: canonical ? venue.venueId : undefined,
        date: `${index % 5 === 0 ? 2025 : 2027}-${String(1 + index % 12).padStart(2, '0')}-${String(1 + index % 27).padStart(2, '0')}`,
        time: index % 2 ? '19:00' : '21:30',
        attending: index < 76,
        distanceKm: index % 900,
      };
    });

    bands.splice(0, bands.length, ...nextBands);
    concerts.splice(0, concerts.length, ...nextConcerts);
    VenueMetadataV158.setRecords(venueRecords);
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

test('v178 production-shaped navigation is bounded, lazy, cached, and error free', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);
  await seedProductionShape(page);

  const result = await page.evaluate(async () => {
    const timed = (fn) => {
      const started = performance.now();
      fn();
      return performance.now() - started;
    };

    const metricsBefore = LiveVaultVenueNavigationPerformanceV166.getMetrics();
    const concertsMs = timed(() => renderConcertsScreen());
    const metricsAfterConcerts = LiveVaultVenueNavigationPerformanceV166.getMetrics();

    concertsSubTab = 'venues';
    const venuesMs = timed(() => renderConcertsScreen());
    const cards = [...document.querySelectorAll('#screen-concerts .venue-metadata-list-card')];
    const firstKey = cards[0]?.dataset.venueKey;
    const secondKey = cards[1]?.dataset.venueKey;
    const detailOneMs = timed(() => openVenueDetail(firstKey, { fromHistory: true }));
    currentScreen = 'main';
    showScreen('screen-concerts');
    const backMs = timed(() => renderConcertsScreen());
    const detailTwoMs = timed(() => openVenueDetail(secondKey, { fromHistory: true }));
    const metricsAfterVenues = LiveVaultVenueNavigationPerformanceV166.getMetrics();

    currentScreen = 'main';
    const musicMs = timed(() => renderMyConcertsScreen());
    const bandsMs = timed(() => renderMyBandsScreen());
    const statsMs = timed(() => renderStatsScreen());
    const alertsMs = timed(() => renderNewsScreen());
    const profileMs = timed(() => renderProfileScreen(bands[0].id));

    const existing = VenueMetadataV158.getRecords();
    const beforeEquivalent = {
      nav: LiveVaultVenueNavigationPerformanceV166.getMetrics(),
      lookup: LiveVaultVenueMetadataLookupPerformanceV166.getMetrics(),
      canonical: CanonicalIdentityRuntimeV174.getMetrics(),
    };
    VenueMetadataV158.setRecords(existing.map((record) => ({ ...record })));
    LiveVaultVenueNavigationPerformanceV166.canonicalVenueGroupsFast();
    VenueMetadataV158.metadataFor(concerts[0]);
    CanonicalIdentityRuntimeV174.canonicalVenueIdentity(concerts[0]);
    const afterEquivalent = {
      nav: LiveVaultVenueNavigationPerformanceV166.getMetrics(),
      lookup: LiveVaultVenueMetadataLookupPerformanceV166.getMetrics(),
      canonical: CanonicalIdentityRuntimeV174.getMetrics(),
    };

    const originalRead = dlReadJsonFile;
    dlReadJsonFile = async (_connection, file, fallback) => file === 'venues.json'
      ? existing
      : file === 'bands.json'
        ? bands
        : file === 'concerts.json'
          ? concerts
          : fallback;
    const startupStarted = performance.now();
    try { await loadDataAndShowApp(); } finally { dlReadJsonFile = originalRead; }
    const startupMs = performance.now() - startupStarted;

    return {
      counts: { venues: existing.length, concerts: concerts.length, canonical: concerts.filter((item) => item.canonicalVenueId).length, cards: cards.length },
      timings: { concertsMs, venuesMs, detailOneMs, backMs, detailTwoMs, musicMs, bandsMs, statsMs, alertsMs, profileMs, startupMs },
      metricsBefore,
      metricsAfterConcerts,
      metricsAfterVenues,
      equivalentDeltas: {
        nav: afterEquivalent.nav.indexBuilds - beforeEquivalent.nav.indexBuilds,
        lookup: afterEquivalent.lookup.indexBuilds - beforeEquivalent.lookup.indexBuilds,
        canonical: afterEquivalent.canonical.indexBuilds - beforeEquivalent.canonical.indexBuilds,
      },
      firstDetailRows: document.querySelectorAll('#screen-venue-detail .row-card[data-band-id]').length,
    };
  });

  expect(errors).toEqual([]);
  expect(result.counts).toMatchObject({ venues: 540, concerts: 2989, canonical: 1017, cards: 540 });
  expect(result.metricsAfterConcerts.groupBuilds).toBe(result.metricsBefore.groupBuilds);
  expect(result.metricsAfterVenues.groupBuilds).toBe(result.metricsAfterConcerts.groupBuilds + 1);
  expect(result.equivalentDeltas).toEqual({ nav: 0, lookup: 0, canonical: 0 });
  expect(result.firstDetailRows).toBeGreaterThan(0);
  expect(result.timings.concertsMs).toBeLessThan(1500);
  expect(result.timings.venuesMs).toBeLessThan(3000);
  expect(result.timings.detailOneMs).toBeLessThan(1000);
  expect(result.timings.backMs).toBeLessThan(1000);
  expect(result.timings.detailTwoMs).toBeLessThan(1000);
  expect(result.timings.musicMs).toBeLessThan(1000);
  expect(result.timings.bandsMs).toBeLessThan(1000);
  expect(result.timings.statsMs).toBeLessThan(1000);
  expect(result.timings.alertsMs).toBeLessThan(1000);
  expect(result.timings.profileMs).toBeLessThan(1000);
  expect(result.timings.startupMs).toBeLessThan(2500);
});

test('v178 rich fallback stays finite and changed records rebuild each index once', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);

  const result = await page.evaluate(() => {
    const venue = {
      name: 'QA v178 Current Hall', city: 'Copenhagen', country: 'Denmark', address: 'Current Street 1, Copenhagen, Denmark',
      identityAliases: [{ name: 'QA v178 Alias Hall', city: 'København', country: 'Denmark', address: 'Old Street 9, København, Denmark' }],
      historicalNames: [{ name: 'QA v178 Former Hall', city: 'København', country: 'Denmark', address: 'Old Street 9, København, Denmark' }],
      subLocations: [{ name: 'QA v178 Small Room', type: 'room' }],
      researchStatus: 'partial', schemaVersion: 1,
    };
    venue.venueId = VenueMetadataModelV158.venueIdFor(venue);
    VenueMetadataV158.setRecords([venue]);
    LiveVaultVenueMetadataLookupPerformanceV166.invalidate();
    CanonicalIdentityRuntimeV174.invalidate();

    const started = performance.now();
    const resolved = [
      { venue: venue.name, city: venue.city, country: venue.country },
      { venue: venue.identityAliases[0].name, city: 'København', country: 'Denmark', venueAddress: 'Old Street 9, København, Denmark' },
      { venue: venue.historicalNames[0].name, city: 'København', country: 'Denmark', venueAddress: 'Old Street 9, København, Denmark' },
      { venue: venue.subLocations[0].name, city: venue.city, country: venue.country, venueAddress: venue.address },
    ].map((value) => VenueMetadataV158.metadataFor(value)?.venueId || null);
    const unresolved = VenueMetadataV158.metadataFor({ venue: 'TBA', city: '', country: '' });
    const fallbackMs = performance.now() - started;

    const beforeChange = {
      nav: LiveVaultVenueNavigationPerformanceV166.getMetrics(),
      lookup: LiveVaultVenueMetadataLookupPerformanceV166.getMetrics(),
      canonical: CanonicalIdentityRuntimeV174.getMetrics(),
    };
    VenueMetadataV158.setRecords([{ ...venue, description: 'Updated once' }]);
    LiveVaultVenueNavigationPerformanceV166.canonicalVenueGroupsFor([]);
    VenueMetadataV158.metadataFor({ canonicalVenueId: venue.venueId, venue: 'Provider wording' });
    CanonicalIdentityRuntimeV174.richMetadataFallback({
      venue: venue.historicalNames[0].name,
      city: 'København',
      country: 'Denmark',
      venueAddress: 'Old Street 9, København, Denmark',
    });
    const afterChange = {
      nav: LiveVaultVenueNavigationPerformanceV166.getMetrics(),
      lookup: LiveVaultVenueMetadataLookupPerformanceV166.getMetrics(),
      canonical: CanonicalIdentityRuntimeV174.getMetrics(),
    };

    return {
      venueId: venue.venueId,
      resolved,
      unresolved: unresolved?.venueId || null,
      fallbackMs,
      rebuildDeltas: {
        nav: afterChange.nav.indexBuilds - beforeChange.nav.indexBuilds,
        lookup: afterChange.lookup.indexBuilds - beforeChange.lookup.indexBuilds,
        canonical: afterChange.canonical.indexBuilds - beforeChange.canonical.indexBuilds,
      },
    };
  });

  expect(errors).toEqual([]);
  expect(result.resolved).toEqual([result.venueId, result.venueId, result.venueId, result.venueId]);
  expect(result.unresolved).toBeNull();
  expect(result.fallbackMs).toBeLessThan(1000);
  expect(result.rebuildDeltas).toEqual({ nav: 1, lookup: 1, canonical: 1 });
});
