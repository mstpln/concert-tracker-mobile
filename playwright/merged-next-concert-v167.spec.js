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
  await expect(banner.locator('.next-concert-live-v167')).toContainText(/\d+d \d{2}h \d{2}m \d{2}s/);
  await expect(card.locator('.row-km')).toBeHidden();

  const presentation = await banner.evaluate((node) => {
    const headline = node.querySelector('strong');
    const headlineDays = node.querySelector('.next-concert-days-v167')?.textContent?.trim();
    const liveDays = node.querySelector('[data-v167-live-days]')?.textContent?.trim();
    return {
      height: node.getBoundingClientRect().height,
      headlineFontSize: parseFloat(getComputedStyle(headline).fontSize),
      headlineDays,
      liveDays,
    };
  });
  expect(presentation.height).toBeGreaterThanOrEqual(44);
  expect(presentation.headlineFontSize).toBeGreaterThanOrEqual(12);
  expect(presentation.liveDays).toBe(presentation.headlineDays);

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

  const spacing = await screen.evaluate((node) => {
    const summary = node.querySelector(':scope > .myconcerts-summary');
    const next = node.querySelector(':scope > .section-label-v167-next');
    const first = node.querySelector(':scope > .next-concert-merged-v167');
    const upcoming = node.querySelector(':scope > .section-label-v143-upcoming');
    return {
      statsToNext: next.getBoundingClientRect().top - summary.getBoundingClientRect().bottom,
      nextToUpcoming: upcoming.getBoundingClientRect().top - first.getBoundingClientRect().bottom,
    };
  });
  expect(Math.abs(spacing.statsToNext - spacing.nextToUpcoming)).toBeLessThanOrEqual(1);
  expect(spacing.nextToUpcoming).toBeGreaterThanOrEqual(27);

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
      directionsIconWidth: getComputedStyle(directions.querySelector('svg')).width,
    };
  });
  expect(styles.bannerBackground).toBe('rgb(94, 216, 255)');
  expect(styles.ticketBackground).toBe('rgb(94, 216, 255)');
  expect(styles.directionsBackground).toBe('rgba(0, 0, 0, 0)');
  expect(styles.directionsIconWidth).toBe('16px');
  await page.locator('#screen-myconcerts').screenshot({ path: testInfo.outputPath('v167-start-concert-day-375px.png') });
});

test('v167 moved multiple PDF tickets keep their menu chrome and delegated identities', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 1100 });
  await openStart(page);
  await setMergedNextFixture(page, { today: true });
  await page.evaluate(() => {
    const next = concerts.find((record) => record.id === 'qa-v167-next');
    next.ownedTickets = [
      { id: 'qa-v167-pdf-a', type: 'pdf', sizeBytes: 128, addedAt: '2027-01-01T00:00:00.000Z' },
      { id: 'qa-v167-pdf-b', type: 'pdf', sizeBytes: 129, addedAt: '2027-01-02T00:00:00.000Z' },
    ];
    renderMyConcertsScreen();
  });

  const card = page.locator('#screen-myconcerts .next-concert-merged-v167');
  const actions = card.locator('.next-concert-actions-v167');
  const picker = actions.locator('.countdown-v139-ticket-picker');
  const summary = picker.locator('.countdown-v139-open-ticket');
  await expect(summary).toContainText('Open tickets');
  await summary.click();
  await expect(picker).toHaveAttribute('open', '');

  const choices = picker.locator('.countdown-v139-ticket-choice');
  await expect(choices).toHaveCount(2);
  await expect(choices.nth(0)).toHaveAttribute('data-concert-id', 'qa-v167-next');
  await expect(choices.nth(0)).toHaveAttribute('data-ticket-id', 'qa-v167-pdf-a');
  await expect(choices.nth(1)).toHaveAttribute('data-ticket-id', 'qa-v167-pdf-b');

  const styles = await picker.evaluate((node) => {
    const menu = node.querySelector('.countdown-v139-ticket-menu');
    const choice = node.querySelector('.countdown-v139-ticket-choice');
    const symbol = choice.querySelector('.countdown-v139-ticket-symbol');
    return {
      menuPosition: getComputedStyle(menu).position,
      menuDisplay: getComputedStyle(menu).display,
      menuBackground: getComputedStyle(menu).backgroundColor,
      menuZIndex: getComputedStyle(menu).zIndex,
      choiceDisplay: getComputedStyle(choice).display,
      choiceBackground: getComputedStyle(choice).backgroundColor,
      choiceMinHeight: getComputedStyle(choice).minHeight,
      symbolWidth: getComputedStyle(symbol).width,
    };
  });
  expect(styles).toEqual({
    menuPosition: 'absolute',
    menuDisplay: 'grid',
    menuBackground: 'rgb(28, 29, 31)',
    menuZIndex: '2',
    choiceDisplay: 'flex',
    choiceBackground: 'rgb(35, 36, 39)',
    choiceMinHeight: '34px',
    symbolWidth: '25px',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
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
