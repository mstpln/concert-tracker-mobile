const { test, expect } = require('@playwright/test');

async function openStart(page) {
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
  await expect(page.locator('#screen-myconcerts')).toBeVisible();
}

async function setMergedNextFixture(page, { today = false, single = false } = {}) {
  await page.evaluate(({ showToday, oneOnly }) => {
    const now = typeof dlCurrentDate === 'function' ? dlCurrentDate() : new Date();
    const dateAt = (days) => {
      const value = new Date(now);
      value.setDate(value.getDate() + days);
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    };
    const firstDate = showToday ? dateAt(0) : dateAt(58);
    const secondDate = dateAt(80);
    const venueId = VenueMetadataModelV158.venueIdFor({ name: 'Example Arena', city: 'Sample City', country: 'Exampleland' });
    const first = {
      id: 'qa-v167-next',
      bandId: 'qa-artist-one',
      bandName: 'QA Artist One',
      date: firstDate,
      time: '19:30',
      venue: 'Example Arena',
      venueId,
      venueAddress: '1 Fictional Avenue',
      address: '1 Fictional Avenue',
      city: 'Sample City',
      country: 'Exampleland',
      latitude: 55.5,
      longitude: 13.1,
      distanceKm: 59,
      attending: true,
      ticketQuantity: 4,
      ticketPrice: 5276,
      ownedTickets: [{ id: 'qa-v167-url-ticket', type: 'url', url: 'https://qa.invalid/tickets/v167', addedAt: now.toISOString() }],
      playlistUrl: null,
      prepChecklist: {},
      predictedSetlist: {
        status: 'ready',
        confidence: 'medium',
        predictedSongCount: 25,
        sourceSetlistCount: 20,
        generatedAt: now.toISOString(),
        songs: [{ name: 'Synthetic Song', spotifyMatched: true, spotifyUri: 'qa:track:v167', performanceRate: 75 }],
      },
    };
    const second = {
      id: 'qa-v167-later',
      bandId: 'qa-artist-two',
      bandName: 'QA Artist Two',
      date: secondDate,
      time: '20:00',
      venue: 'Test Hall',
      venueAddress: '2 Synthetic Street',
      address: '2 Synthetic Street',
      city: 'Sample City',
      country: 'Exampleland',
      distanceKm: 75,
      attending: true,
      ownedTickets: [],
      prepChecklist: {},
    };
    concerts = oneOnly ? [first] : [first, second];
    listeningEvents = [{
      localBandId: 'qa-artist-one',
      artistName: 'QA Artist One',
      trackName: 'Synthetic Listen',
      listenedAt: now.toISOString(),
      listenedDurationMs: 180000,
    }];
    VenueMetadataV158.setRecords([{
      venueId,
      name: 'Example Arena',
      city: 'Sample City',
      country: 'Exampleland',
      address: '1 Fictional Avenue',
      maxCapacity: 17000,
      researchStatus: 'partial',
      schemaVersion: 1,
    }]);
    renderMyConcertsScreen();
  }, { showToday: today, oneOnly: single });
}

async function assertCoreCardContent(card) {
  await expect(card.locator('.row-chevron')).toBeVisible();
  await expect(card.locator('.concert-listening-row')).toContainText('Your listening');
  const prep = card.locator('.concert-prep-group');
  await expect(prep).toContainText('Ticket');
  await expect(prep).toContainText('Playlist');
  await expect(prep).toContainText('Weather forecast');
  await expect(prep).toContainText('Predicted setlist');
  await expect(prep).toContainText('Checklist');
  await expect(card.locator('.venue-address-link')).toBeVisible();
  await expect(card.locator('.venue-max-capacity-concert')).toContainText('Max Capacity: 17 000');
  const colors = await card.evaluate((node) => ({
    address: getComputedStyle(node.querySelector('.venue-address-link')).color,
    capacity: getComputedStyle(node.querySelector('.venue-max-capacity-concert')).color,
    overflow: node.scrollWidth - node.clientWidth,
  }));
  expect(colors.capacity).toBe(colors.address);
  expect(colors.overflow).toBeLessThanOrEqual(1);
}

test('v167 promotes the first upcoming card and preserves its full preparation content', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 1100 });
  await openStart(page);
  await setMergedNextFixture(page);

  const screen = page.locator('#screen-myconcerts');
  const card = screen.locator('.next-concert-merged-v167');
  await expect(card).toHaveCount(1);
  await expect(screen.locator('#countdown-card')).toHaveCount(0);
  await assertCoreCardContent(card);

  const banner = card.locator('.next-concert-banner-v167');
  await expect(banner).toContainText('DAYS LEFT');
  await expect(banner).toContainText('59 km away');
  await expect(banner.locator('.next-concert-live-v167')).toContainText(/\d{2}h \d{2}m \d{2}s/);
  await expect(card.locator('.row-km')).toBeHidden();

  const ordering = await screen.evaluate((node) => {
    const children = [...node.children];
    const next = children.findIndex((child) => child.classList.contains('section-label-v167-next'));
    const first = children.findIndex((child) => child.classList.contains('next-concert-merged-v167'));
    const upcoming = children.findIndex((child) => child.classList.contains('section-label-v143-upcoming'));
    return { next, first, upcoming };
  });
  expect(ordering.next).toBeGreaterThanOrEqual(0);
  expect(ordering.first).toBeGreaterThan(ordering.next);
  expect(ordering.upcoming).toBeGreaterThan(ordering.first);
  await expect(screen.locator('.year-divider-v167-upcoming .year-divider-count')).toHaveText('1 show');

  const weights = await banner.evaluate((node) => ({
    headline: getComputedStyle(node.querySelector('strong')).fontWeight,
    live: getComputedStyle(node.querySelector('.next-concert-live-v167')).fontWeight,
    distance: getComputedStyle(node.querySelector('.next-concert-distance-v167')).fontWeight,
  }));
  expect(Number(weights.headline)).toBeGreaterThanOrEqual(700);
  expect(Number(weights.live)).toBeLessThan(700);
  expect(Number(weights.distance)).toBeLessThan(700);

  // Moving the existing card must preserve its established band-profile
  // navigation; the chevron remains a functional affordance, not decoration.
  await card.locator('.row-chevron').click();
  await expect(page.locator('#screen-profile')).toBeVisible();
  await expect(page.locator('#screen-profile')).toContainText('QA Artist One');
  await page.getByTestId('back-button').click();
  await expect(page.locator('#screen-myconcerts .next-concert-merged-v167')).toBeVisible();
  await screen.screenshot({ path: testInfo.outputPath('v167-start-next-concert-375px.png') });
});

test('v167 concert day uses neon banner, primary tickets and ghost directions', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 1100 });
  await openStart(page);
  await setMergedNextFixture(page, { today: true });

  const card = page.locator('#screen-myconcerts .next-concert-merged-v167');
  await assertCoreCardContent(card);
  const banner = card.locator('.next-concert-banner-v167');
  await expect(banner).toContainText('CONCERT DAY');
  await expect(banner).toContainText('59 km away');
  await expect(banner).not.toContainText('DAYS LEFT');

  const actions = card.locator('.next-concert-actions-v167');
  await expect(actions).toBeVisible();
  const directions = actions.locator('.next-concert-directions-v167');
  const tickets = actions.locator('.countdown-v139-open-ticket');
  await expect(directions).toContainText('Get directions');
  await expect(directions).toHaveAttribute('href', /google\.com\/maps/);
  await expect(tickets).toContainText('Open tickets');
  await expect(tickets).toHaveAttribute('href', 'https://qa.invalid/tickets/v167');

  const styles = await actions.evaluate((node) => {
    const banner = node.closest('.next-concert-merged-v167').querySelector('.next-concert-banner-v167');
    const directions = node.querySelector('.next-concert-directions-v167');
    const tickets = node.querySelector('.countdown-v139-open-ticket');
    return {
      bannerBackground: getComputedStyle(banner).backgroundColor,
      ticketBackground: getComputedStyle(tickets).backgroundColor,
      directionsBackground: getComputedStyle(directions).backgroundColor,
    };
  });
  expect(styles.bannerBackground).toBe('rgb(94, 216, 255)');
  expect(styles.ticketBackground).toBe('rgb(94, 216, 255)');
  expect(styles.directionsBackground).toBe('rgba(0, 0, 0, 0)');
  await page.locator('#screen-myconcerts').screenshot({ path: testInfo.outputPath('v167-start-concert-day-375px.png') });
});

test('v167 removes the Upcoming separator when there are no later concerts', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await openStart(page);
  await setMergedNextFixture(page, { single: true });
  await expect(page.locator('#screen-myconcerts .next-concert-merged-v167')).toHaveCount(1);
  await expect(page.locator('#screen-myconcerts .section-label-v143-upcoming')).toHaveCount(0);
});

test('v167 stays within the card at the supported 480px layout', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 1000 });
  await openStart(page);
  await setMergedNextFixture(page);
  const card = page.locator('#screen-myconcerts .next-concert-merged-v167');
  const overflow = await card.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await assertCoreCardContent(card);
});
