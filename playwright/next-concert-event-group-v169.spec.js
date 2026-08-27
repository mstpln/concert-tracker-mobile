const { test, expect } = require('@playwright/test');

async function openStart(page) {
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
  await expect(page.locator('#screen-myconcerts')).toBeVisible();
}

async function setGroupedNextFixture(page) {
  await page.evaluate(() => {
    const now = typeof dlCurrentDate === 'function' ? dlCurrentDate() : new Date();
    const dateAt = (days) => {
      const value = new Date(now);
      value.setDate(value.getDate() + days);
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    };
    const owners = bands.slice(0, 4);
    if (owners.length < 4) throw new Error('QA fixture requires four bands');
    const nextDate = dateAt(57);
    concerts = [
      {
        id: 'qa-v169-support', bandId: owners[0].id, bandName: owners[0].name,
        date: nextDate, time: '19:00', venue: 'V169 Event Arena', city: 'Sample City', country: 'Denmark',
        venueAddress: '1 Group Street', address: '1 Group Street', distanceKm: 59,
        attending: true, lineupRole: 'support', ownedTickets: [], prepChecklist: {},
      },
      {
        id: 'qa-v169-headliner', bandId: owners[1].id, bandName: owners[1].name,
        date: nextDate, time: '20:30', venue: 'V169 Event Arena', city: 'Sample City', country: 'Denmark',
        venueAddress: '1 Group Street', address: '1 Group Street', distanceKm: 59,
        attending: true, lineupRole: 'headliner', ownedTickets: [], prepChecklist: {},
      },
      {
        id: 'qa-v169-later-one', bandId: owners[2].id, bandName: owners[2].name,
        date: dateAt(70), time: '19:30', venue: 'V169 Later Hall', city: 'Sample City', country: 'Denmark',
        venueAddress: '2 Later Street', address: '2 Later Street', distanceKm: 70,
        attending: true, lineupRole: 'headliner', ownedTickets: [], prepChecklist: {},
      },
      {
        id: 'qa-v169-later-two', bandId: owners[3].id, bandName: owners[3].name,
        date: dateAt(82), time: '20:00', venue: 'V169 Final Club', city: 'Sample City', country: 'Denmark',
        venueAddress: '3 Final Street', address: '3 Final Street', distanceKm: 82,
        attending: true, lineupRole: 'headliner', ownedTickets: [], prepChecklist: {},
      },
    ];
    listeningEvents = [];
    VenueMetadataV158.setRecords([]);
    renderMyConcertsScreen();
  });
}

function cardById(screen, id) {
  return screen.locator(`.row-card-mc:has(.delete-corner-btn[data-concert-id="${id}"])`);
}

test('v169 keeps the whole next event together and preserves section rhythm', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 1200 });
  await openStart(page);
  await setGroupedNextFixture(page);

  const screen = page.locator('#screen-myconcerts');
  const support = cardById(screen, 'qa-v169-support');
  const headliner = cardById(screen, 'qa-v169-headliner');
  const laterOne = cardById(screen, 'qa-v169-later-one');
  const spacer = screen.locator('.year-divider-v169-spacer');
  const upcoming = screen.locator('.section-label-v143-upcoming');

  await expect(support).toHaveCount(1);
  await expect(headliner).toHaveCount(1);
  await expect(support.locator('.lineup-role-badge')).toContainText('Support');
  await expect(headliner.locator('.lineup-role-badge')).toContainText('Headliner');
  await expect(support.locator('.next-concert-banner-v167')).toHaveCount(1);
  await expect(headliner.locator('.next-concert-banner-v167')).toHaveCount(0);
  await expect(spacer).toHaveCount(1);

  const ordering = await screen.evaluate((node) => {
    const children = [...node.children];
    const indexOfCard = (id) => children.findIndex((child) => child.querySelector?.(`.delete-corner-btn[data-concert-id="${id}"]`));
    return {
      next: children.findIndex((child) => child.classList.contains('section-label-v167-next')),
      spacer: children.findIndex((child) => child.classList.contains('year-divider-v169-spacer')),
      support: indexOfCard('qa-v169-support'),
      headliner: indexOfCard('qa-v169-headliner'),
      upcoming: children.findIndex((child) => child.classList.contains('section-label-v143-upcoming')),
      later: indexOfCard('qa-v169-later-one'),
    };
  });
  expect(ordering.next).toBeLessThan(ordering.spacer);
  expect(ordering.spacer).toBeLessThan(ordering.support);
  expect(ordering.support).toBeLessThan(ordering.headliner);
  expect(ordering.headliner).toBeLessThan(ordering.upcoming);
  expect(ordering.upcoming).toBeLessThan(ordering.later);

  const spacerPresentation = await spacer.evaluate((node) => ({
    height: node.getBoundingClientRect().height,
    childVisibility: [...node.children].map((child) => getComputedStyle(child).visibility),
  }));
  expect(spacerPresentation.height).toBeGreaterThan(0);
  expect(spacerPresentation.childVisibility.every((value) => value === 'hidden')).toBe(true);

  const gaps = await screen.evaluate((node) => {
    const findCard = (id) => [...node.children].find((child) => child.querySelector?.(`.delete-corner-btn[data-concert-id="${id}"]`));
    const support = findCard('qa-v169-support');
    const headliner = findCard('qa-v169-headliner');
    const upcoming = node.querySelector(':scope > .section-label-v143-upcoming');
    return {
      betweenEventCards: headliner.getBoundingClientRect().top - support.getBoundingClientRect().bottom,
      eventToUpcoming: upcoming.getBoundingClientRect().top - headliner.getBoundingClientRect().bottom,
    };
  });
  expect(Math.abs(gaps.betweenEventCards - 8)).toBeLessThanOrEqual(1);
  expect(Math.abs(gaps.eventToUpcoming - 28)).toBeLessThanOrEqual(1);

  await expect(screen.locator('.year-divider-v169-upcoming .year-divider-count')).toHaveText('2 more shows');
  await expect(laterOne).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await screen.screenshot({ path: testInfo.outputPath('v169-grouped-next-event-375px.png'), fullPage: false });
});

test('v169 keeps a single next concert on the same spacer and more-shows contract', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 1000 });
  await openStart(page);
  await setGroupedNextFixture(page);
  await page.evaluate(() => {
    concerts = concerts.filter((concert) => concert.id !== 'qa-v169-support');
    renderMyConcertsScreen();
  });

  const screen = page.locator('#screen-myconcerts');
  await expect(screen.locator('.next-concert-event-card-v169')).toHaveCount(1);
  await expect(screen.locator('.year-divider-v169-spacer')).toHaveCount(1);
  await expect(screen.locator('.year-divider-v169-upcoming .year-divider-count')).toHaveText('2 more shows');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('v169 removes Upcoming when the grouped next event is the only future event even if past concerts follow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 1100 });
  await openStart(page);
  await setGroupedNextFixture(page);
  await page.evaluate(() => {
    const now = typeof dlCurrentDate === 'function' ? dlCurrentDate() : new Date();
    const past = new Date(now);
    past.setDate(past.getDate() - 30);
    const pastDate = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(past.getDate()).padStart(2, '0')}`;
    const owner = bands[2];
    concerts = concerts.filter((concert) => ['qa-v169-support', 'qa-v169-headliner'].includes(concert.id));
    concerts.push({
      id: 'qa-v169-past', bandId: owner.id, bandName: owner.name,
      date: pastDate, time: '20:00', venue: 'V169 Past Hall', city: 'Sample City', country: 'Denmark',
      venueAddress: '4 Past Street', address: '4 Past Street', distanceKm: 40,
      attending: true, lineupRole: 'headliner', ownedTickets: [], prepChecklist: {},
    });
    renderMyConcertsScreen();
  });

  const screen = page.locator('#screen-myconcerts');
  await expect(screen.locator('.next-concert-event-card-v169')).toHaveCount(2);
  await expect(screen.locator('.section-label-v143-upcoming')).toHaveCount(0);
  await expect(screen.getByText('Past concerts', { exact: true })).toBeVisible();
  await expect(cardById(screen, 'qa-v169-past')).toBeVisible();
});
