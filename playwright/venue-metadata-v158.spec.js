const { test, expect } = require('@playwright/test');

async function openApp(page, testInfo) {
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium' ? { width: 375, height: 900 } : { width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: testInfo.project.name === 'mobile-chromium' ? 'light' : 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}

async function seedVenueMetadata(page) {
  return page.evaluate(() => {
    const live = concerts.filter((concert) => bands.some((band) => band.id === concert.bandId));
    const { upcoming, past } = dlMyConcerts(live);
    const next = EventModelV156.nextEventPresentation(upcoming);
    if (!next) throw new Error('QA fixture must include an upcoming attended concert');
    const pastConcert = past[0];
    const recordFor = (concert, capacity, suffix) => ({
      venueId: VenueMetadataModelV158.venueIdFor({ name: concert.venue, city: concert.city, country: concert.country }) || `venue-${suffix}`,
      name: concert.venue,
      city: concert.city,
      country: concert.country || '',
      address: concert.venueAddress || undefined,
      maxCapacity: capacity,
      officialUrl: 'https://venue.example.test/',
      description: 'A synthetic venue description used only by the BANDMARKR QA fake backend.',
      researchStatus: 'complete',
      researchedAt: '2027-07-16T10:00:00.000Z',
      sources: ['https://source.example.test/'],
      schemaVersion: 1,
    });
    const records = [recordFor(next, 16000, '11111111')];
    if (pastConcert && (pastConcert.venue !== next.venue || pastConcert.city !== next.city)) records.push(recordFor(pastConcert, 6500, '22222222'));
    VenueMetadataV158.setRecords(records);
    renderMyConcertsScreen();
    return {
      nextVenue: next.venue,
      nextCity: next.city,
      nextCapacity: 'Max Capacity: 16 000',
      pastVenue: pastConcert?.venue || null,
      pastCapacity: records.length > 1 ? 'Max Capacity: 6 500' : 'Max Capacity: 16 000',
    };
  });
}

test('v158 shows capacity on upcoming/past cards and Next Concert without changing the ticket shell', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);
  const seeded = await seedVenueMetadata(page);

  const upcomingCard = page.locator('.row-card-mc').filter({ hasText: seeded.nextVenue }).first();
  await expect(upcomingCard.locator('.venue-max-capacity-concert')).toHaveText(seeded.nextCapacity);
  const ordering = await upcomingCard.evaluate((card) => {
    const cap = card.querySelector('.venue-max-capacity-concert');
    const distance = card.querySelector('.row-km');
    return !!cap && !!distance && !!(cap.compareDocumentPosition(distance) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(ordering).toBe(true);

  if (seeded.pastVenue) {
    const pastCard = page.locator('.row-card-mc.is-past').filter({ hasText: seeded.pastVenue }).first();
    await expect(pastCard.locator('.venue-max-capacity-concert')).toHaveText(seeded.pastCapacity);
  }

  await expect(page.locator('#countdown-card .venue-max-capacity-next')).toHaveText(seeded.nextCapacity);
  await expect(page.locator('#countdown-card .countdown-ticket-outline')).toBeVisible();

  for (const width of [375, 480]) {
    await page.setViewportSize({ width, height: 920 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('v158 places capacity lower-right on Venues cards and shows clean venue detail metadata', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);
  const seeded = await seedVenueMetadata(page);

  await page.locator('#tabbar [data-tab="concerts"]').click();
  await page.getByRole('button', { name: 'Venues' }).click();
  const venueCard = page.locator('.venue-metadata-list-card').filter({ hasText: seeded.nextVenue }).first();
  await expect(venueCard.locator('.venue-card-max-capacity')).toHaveText(seeded.nextCapacity);
  const positions = await venueCard.evaluate((card) => {
    const capacity = card.querySelector('.venue-card-max-capacity').getBoundingClientRect();
    const chevron = card.querySelector('.row-chevron').getBoundingClientRect();
    return { capacityTop: capacity.top, chevronBottom: chevron.bottom, capacityRight: capacity.right, cardRight: card.getBoundingClientRect().right };
  });
  expect(positions.capacityTop).toBeGreaterThanOrEqual(positions.chevronBottom - 2);
  expect(Math.abs(positions.cardRight - positions.capacityRight)).toBeLessThan(24);

  await venueCard.click();
  await expect(page.locator('#screen-venue-detail .venue-detail-value').first()).toBeVisible();
  await expect(page.locator('#screen-venue-detail .venue-detail-capacity')).toHaveText(seeded.nextCapacity);
  await expect(page.locator('#screen-venue-detail .venue-detail-official-link')).toHaveAttribute('href', 'https://venue.example.test/');
  await expect(page.locator('#screen-venue-detail .venue-detail-description')).toContainText('synthetic venue description');
  await expect(page.locator('#screen-venue-detail')).not.toContainText('source.example.test');

  for (const width of [375, 480]) {
    await page.setViewportSize({ width, height: 920 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('v158 hides unknown capacity without reserving a placeholder', async ({ page }, testInfo) => {
  await openApp(page, testInfo);
  await page.evaluate(() => {
    VenueMetadataV158.setRecords([]);
    renderMyConcertsScreen();
  });
  await expect(page.locator('.venue-max-capacity')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Max Capacity: Unknown');
  await expect(page.locator('body')).not.toContainText('Max Capacity: N/A');
});
