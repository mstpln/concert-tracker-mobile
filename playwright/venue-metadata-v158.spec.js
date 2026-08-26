const { test, expect } = require('@playwright/test');

async function openApp(page, testInfo) {
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium' ? { width: 375, height: 900 } : { width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: testInfo.project.name === 'mobile-chromium' ? 'light' : 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}

async function seedVenueMetadata(page) {
  return page.evaluate(() => {
    // This regression is specifically for the normal future-event card with
    // visible venue metadata. Keep the synthetic show-day fixture out of the
    // Next Concert slot so the four-ticket grouped event exercises the layout.
    const showDay = concerts.find((concert) => concert.id === 'qa-show-day');
    if (showDay) showDay.attending = false;
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

async function makeGroupedLongVenueFixture(page) {
  const longVenue = 'The Extremely Long Synthetic International Concert Hall and Cultural Centre';
  await page.evaluate((venueName) => {
    const data = JSON.parse(localStorage.getItem('livevault-qa:data'));
    const showDay = data.concerts.find((record) => record.id === 'qa-show-day');
    if (showDay) showDay.attending = false;
    const shared = data.concerts.filter((record) => record.id.startsWith('qa-group-'));
    for (const record of shared) {
      delete record.eventGroupId;
      record.attending = true;
      record.date = '2027-07-17';
      record.venue = venueName;
      record.city = 'Sample City';
      record.country = 'Denmark';
      record.venueAddress = '123 Synthetic Avenue, 2300 Sample City, Denmark';
    }
    localStorage.setItem('livevault-qa:data', JSON.stringify(data));
  }, longVenue);
  await page.reload();
  return longVenue;
}

test('v158 shows capacity on upcoming/past cards and the promoted v167 Next Concert card', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);
  const seeded = await seedVenueMetadata(page);

  const nextCard = page.locator('#screen-myconcerts .next-concert-merged-v167');
  await expect(nextCard).toContainText(seeded.nextVenue);
  await expect(nextCard.locator('.venue-max-capacity-concert')).toHaveText(seeded.nextCapacity);
  await expect(nextCard.locator('.venue-address-link')).toBeVisible();
  await expect(page.locator('#screen-myconcerts #countdown-card')).toHaveCount(0);

  if (seeded.pastVenue) {
    const pastCard = page.locator('.row-card-mc.is-past').filter({ hasText: seeded.pastVenue }).first();
    await expect(pastCard.locator('.venue-max-capacity-concert')).toHaveText(seeded.pastCapacity);
  }

  for (const width of [375, 480, 1280]) {
    await page.setViewportSize({ width, height: 920 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const nextLayout = await nextCard.evaluate((card) => {
      const capacity = card.querySelector('.venue-max-capacity-concert');
      const address = card.querySelector('.venue-address-link');
      if (!capacity || !address) return null;
      const cardRect = card.getBoundingClientRect();
      const capacityRect = capacity.getBoundingClientRect();
      const capacityStyle = getComputedStyle(capacity);
      const addressStyle = getComputedStyle(address);
      return {
        capacityInside: capacityRect.left >= cardRect.left && capacityRect.right <= cardRect.right,
        capacityFontSize: capacityStyle.fontSize,
        addressFontSize: addressStyle.fontSize,
        capacityColor: capacityStyle.color,
        addressColor: addressStyle.color,
        capacityWeight: Number(capacityStyle.fontWeight),
        addressWeight: Number(addressStyle.fontWeight),
      };
    });
    expect(nextLayout).not.toBeNull();
    expect(nextLayout.capacityInside).toBe(true);
    expect(nextLayout.capacityFontSize).toBe(nextLayout.addressFontSize);
    expect(nextLayout.capacityColor).toBe(nextLayout.addressColor);
    expect(nextLayout.capacityWeight).toBe(nextLayout.addressWeight);
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

test('v158 grouped promoted Next Concert and long venue cards remain safe in mobile dark and desktop light', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);
  const longVenue = await makeGroupedLongVenueFixture(page);
  const seeded = await seedVenueMetadata(page);

  const promoted = page.locator('#screen-myconcerts .next-concert-merged-v167');
  await expect(promoted).toBeVisible();
  await expect(promoted).toContainText(longVenue);
  await expect(promoted.locator('.venue-max-capacity-concert')).toHaveText(seeded.nextCapacity);
  await expect(promoted.locator('.row-chevron')).toBeVisible();

  await page.locator('#tabbar [data-tab="concerts"]').click();
  await page.getByRole('button', { name: 'Venues' }).click();
  const venueCard = page.locator('.venue-metadata-list-card').filter({ hasText: longVenue }).first();
  await expect(venueCard).toBeVisible();
  await expect(venueCard.locator('.venue-card-max-capacity')).toHaveText(seeded.nextCapacity);
  await expect(venueCard.locator('.row-chevron')).toBeVisible();

  for (const scenario of [
    { width: 375, colorScheme: 'dark' },
    { width: 1280, colorScheme: 'light' },
  ]) {
    await page.setViewportSize({ width: scenario.width, height: 920 });
    await page.emulateMedia({ colorScheme: scenario.colorScheme, reducedMotion: 'reduce' });
    await expect(venueCard.locator('.row-name')).toContainText(longVenue);
    await expect(venueCard.locator('.venue-card-max-capacity')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const noCollision = await venueCard.evaluate((card) => {
      const name = card.querySelector('.row-name').getBoundingClientRect();
      const chevron = card.querySelector('.row-chevron').getBoundingClientRect();
      const capacity = card.querySelector('.venue-card-max-capacity').getBoundingClientRect();
      return name.right <= chevron.left + 1 && capacity.top >= chevron.bottom - 2;
    });
    expect(noCollision).toBe(true);
  }
  expect(errors).toEqual([]);
});
