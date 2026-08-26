const { test, expect } = require('@playwright/test');

function dateKey(offsetDays) {
  return { offsetDays };
}

test('v168 renders Max Capacity like venue address on next, upcoming and past cards', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 1100 });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');

  await page.evaluate(({ offsets }) => {
    const now = typeof dlCurrentDate === 'function' ? dlCurrentDate() : new Date();
    const toDate = (days) => {
      const value = new Date(now);
      value.setDate(value.getDate() + days);
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    };
    const owners = bands.slice(0, 3);
    if (owners.length < 3) throw new Error('QA fixture requires at least three bands');
    const fixtures = [
      { id: 'qa-v168-next', owner: owners[0], days: offsets.next.offsetDays, venue: 'V168 Next Arena', address: '1 Next Street', capacity: 17000 },
      { id: 'qa-v168-upcoming', owner: owners[1], days: offsets.upcoming.offsetDays, venue: 'V168 Later Hall', address: '2 Later Street', capacity: 4200 },
      { id: 'qa-v168-past', owner: owners[2], days: offsets.past.offsetDays, venue: 'V168 Past Club', address: '3 Past Street', capacity: 1250 },
    ];
    concerts = fixtures.map((fixture) => ({
      id: fixture.id,
      bandId: fixture.owner.id,
      bandName: fixture.owner.name,
      date: toDate(fixture.days),
      time: '19:30',
      venue: fixture.venue,
      venueAddress: fixture.address,
      address: fixture.address,
      city: 'Sample City',
      country: 'Denmark',
      attending: true,
      ownedTickets: [],
      prepChecklist: {},
    }));
    VenueMetadataV158.setRecords(fixtures.map((fixture) => ({
      venueId: VenueMetadataModelV158.venueIdFor({ name: fixture.venue, city: 'Sample City', country: 'Denmark' }),
      name: fixture.venue,
      city: 'Sample City',
      country: 'Denmark',
      address: fixture.address,
      maxCapacity: fixture.capacity,
      researchStatus: 'partial',
      schemaVersion: 1,
    })));
    renderMyConcertsScreen();
  }, { offsets: { next: dateKey(58), upcoming: dateKey(80), past: dateKey(-30) } });

  const cards = page.locator('#screen-myconcerts .row-card-mc');
  await expect(cards).toHaveCount(3);
  for (const venue of ['V168 Next Arena', 'V168 Later Hall', 'V168 Past Club']) {
    const card = cards.filter({ hasText: venue }).first();
    await expect(card).toBeVisible();
    await expect(card.locator('.venue-address-link')).toBeVisible();
    await expect(card.locator('.venue-max-capacity-concert')).toBeVisible();
    const style = await card.evaluate((node) => {
      const address = node.querySelector('.venue-address-link');
      const capacity = node.querySelector('.venue-max-capacity-concert');
      return {
        addressColor: getComputedStyle(address).color,
        capacityColor: getComputedStyle(capacity).color,
        addressWeight: Number(getComputedStyle(address).fontWeight),
        capacityWeight: Number(getComputedStyle(capacity).fontWeight),
      };
    });
    expect(style.capacityColor).toBe(style.addressColor);
    expect(style.capacityWeight).toBe(style.addressWeight);
    expect(style.capacityWeight).toBeLessThan(600);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
