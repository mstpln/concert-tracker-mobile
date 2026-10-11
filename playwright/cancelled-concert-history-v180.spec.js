const { test, expect } = require('@playwright/test');

for (const width of [375, 480]) {
  test(`v180 reversible cancellation, safe deletion and statistics at ${width}px`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
    await page.evaluate(async () => {
      const latest = await dlReadJsonFile(remote, 'concerts.json', []);
      const selected = {
        id: 'qa-v180-reversible', bandId: 'qa-artist-one', bandName: 'QA Artist One',
        venue: 'Fictional Concert Hall', city: 'Sample City', country: 'Exampleland',
        date: '2027-11-20', time: '19:30', attending: true, manuallyAdded: false,
        ticketPrice: 1420, ticketQuantity: 2, distanceKm: 112,
        ownedTickets: [{ id: 'qa-v180-ticket', type: 'url', url: 'https://qa.invalid/tickets/saved' }],
        notes: 'Preserved synthetic notes', customFutureProperty: { keep: true },
      };
      const next = [...latest.filter((c) => c.id !== selected.id), selected];
      await dlWriteJsonFile(remote, 'concerts.json', next);
      concerts = next;
      renderMyConcertsScreen();
    });

    const id = 'qa-v180-reversible';
    const action = () => page.locator(`#screen-myconcerts .my-lifecycle-action[data-concert-id="${id}"]`);
    const stored = () => page.evaluate((key) => {
      const data = JSON.parse(localStorage.getItem('livevault-qa:data') || '{}');
      return (data.concerts || []).find((c) => c.id === key);
    }, id);
    await expect(action()).toContainText('Cancelled');
    const spacing = await action().evaluate((node) => {
      const trash = node.parentElement.querySelector('.remove-going-btn');
      const a = node.getBoundingClientRect(), b = trash.getBoundingClientRect();
      return { firstHeight: a.height, secondHeight: b.height, gap: b.left - a.right };
    });
    expect(spacing.firstHeight).toBe(28);
    expect(spacing.secondHeight).toBe(28);
    expect(spacing.gap).toBe(20);

    page.once('dialog', (dialog) => dialog.dismiss());
    await action().click();
    expect((await stored()).personalLifecycleStatus).toBeUndefined();

    page.once('dialog', (dialog) => dialog.accept());
    await action().click();
    await expect(page.locator('[data-my-history-tab="cancelled"]')).toHaveAttribute('aria-selected', 'true');
    await expect(action()).toContainText('Restore');
    await expect(page.locator('#my-history-cancelled .my-lifecycle-status.cancelled')).toContainText('CANCELLED');
    const cancelled = await stored();
    expect(cancelled.personalLifecycleStatus).toBe('cancelled');
    expect(cancelled.ticketPrice).toBe(1420);
    expect(cancelled.ownedTickets).toHaveLength(1);
    expect(cancelled.customFutureProperty).toEqual({ keep: true });
    const noCancelledStats = await page.evaluate(() => {
      const { upcoming, past } = dlMyConcerts(concerts);
      return { upcoming: upcoming.some((c) => c.id === 'qa-v180-reversible'), past: past.some((c) => c.id === 'qa-v180-reversible') };
    });
    expect(noCancelledStats).toEqual({ upcoming: false, past: false });
    await page.locator('#screen-myconcerts').screenshot({ path: testInfo.outputPath(`v180-cancelled-${width}.png`) });

    page.once('dialog', (dialog) => dialog.accept());
    await action().click();
    await expect(action()).toContainText('Cancelled');
    const restored = await stored();
    expect(restored.personalLifecycleStatus).toBeUndefined();
    expect(restored.ownedTickets).toHaveLength(1);

    const deleteButton = page.locator(`#screen-myconcerts .remove-going-btn[data-concert-id="${id}"]`);
    page.once('dialog', (dialog) => dialog.dismiss());
    await deleteButton.click();
    expect((await stored()).attending).toBe(true);
    page.once('dialog', (dialog) => dialog.accept());
    await deleteButton.click();
    await expect.poll(async () => (await stored()).attending).toBe(false);
    expect((await stored()).id).toBe(id);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}


test('v180 optimized venue detail never mislabels cancelled shows as Attended and refreshes cache on status changes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
  await page.evaluate(() => {
    const band = bands[0];
    concerts = [...concerts, {
      id: 'qa-v180-venue-lifecycle', bandId: band.id, bandName: band.name,
      venue: 'V180 Fictional Lifecycle Hall', city: 'Sample City',
      country: 'Exampleland', date: '2027-10-20', time: '20:00',
      attending: true, distanceKm: 60,
    }];
    const venue = LiveVaultVenueNavigationPerformanceV166.canonicalVenueGroupsFast().groups
      .find((group) => group.concerts.some((record) => record.id === 'qa-v180-venue-lifecycle'));
    if (!venue) throw new Error('Missing synthetic venue');
    window.__qaV180VenueKey = venue.key;
    openVenueDetail(venue.key);
  });
  await expect(page.locator('#screen-venue-detail .pill-going')).toContainText('Going');
  const originalCacheBuilds = await page.evaluate(() => LiveVaultVenueNavigationPerformanceV166.getMetrics().groupBuilds);
  await page.evaluate(() => {
    concerts = concerts.map((record) => record.id === 'qa-v180-venue-lifecycle'
      ? { ...record, personalLifecycleStatus: 'cancelled', date: '2027-01-20' } : record);
    renderVenueDetailScreen(window.__qaV180VenueKey);
  });
  await expect(page.locator('#screen-venue-detail .pill-cancelled')).toContainText('Cancelled');
  await expect(page.locator('#screen-venue-detail .pill-attended')).toHaveCount(0);
  const changedCacheBuilds = await page.evaluate(() => LiveVaultVenueNavigationPerformanceV166.getMetrics().groupBuilds);
  expect(changedCacheBuilds).toBeGreaterThan(originalCacheBuilds);
  await page.evaluate(() => {
    concerts = concerts.map((record) => record.id === 'qa-v180-venue-lifecycle'
      ? { ...record, personalLifecycleStatus: 'active', date: '2027-10-20' } : record);
    renderVenueDetailScreen(window.__qaV180VenueKey);
  });
  await expect(page.locator('#screen-venue-detail .pill-going')).toContainText('Going');
  await expect(page.locator('#screen-venue-detail .pill-cancelled')).toHaveCount(0);
});
