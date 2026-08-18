const { test, expect } = require('@playwright/test');

async function installV143SyntheticState(page) {
  await page.goto('/');
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('livevault-qa:data') || '{}');
    const bandId = 'qa-v143-mixed-band';
    const denmarkOnlyBandId = 'qa-v143-denmark-only';

    data.bands = [
      ...(data.bands || []).filter((band) => ![bandId, denmarkOnlyBandId].includes(band.id)),
      { id: bandId, name: 'QA V143 Mixed Band', genre: 'Rock' },
      { id: denmarkOnlyBandId, name: 'QA V143 Denmark Only', genre: 'Rock' },
    ];

    data.concerts = [
      ...(data.concerts || []).filter((concert) => !String(concert.id || '').startsWith('qa-v143-')),
      {
        id: 'qa-v143-sweden-show',
        bandId,
        bandName: 'QA V143 Mixed Band',
        date: '2027-09-01',
        time: '19:30',
        venue: 'QA Stockholm Hall',
        city: 'Stockholm',
        country: 'Sweden',
        distanceKm: 500,
        ticketUrl: 'https://qa.invalid/v143/sweden',
        sourceProvider: 'ticketmaster',
        providerEventId: 'qa-v143-event-sweden',
        foundAt: '2027-07-10T12:00:00.000Z',
      },
      {
        id: 'qa-v143-denmark-show',
        bandId,
        bandName: 'QA V143 Mixed Band',
        date: '2027-09-02',
        time: '20:00',
        venue: 'QA Copenhagen Hall',
        city: 'Copenhagen',
        country: 'Denmark',
        distanceKm: 60,
        ticketUrl: 'https://qa.invalid/v143/denmark',
        sourceProvider: 'ticketmaster',
        providerEventId: 'qa-v143-event-denmark',
        foundAt: '2027-07-10T12:00:00.000Z',
      },
      {
        id: 'qa-v143-denmark-only-show',
        bandId: denmarkOnlyBandId,
        bandName: 'QA V143 Denmark Only',
        date: '2027-09-03',
        time: '20:30',
        venue: 'QA Aarhus Hall',
        city: 'Aarhus',
        country: 'Denmark',
        distanceKm: 220,
        ticketUrl: 'https://qa.invalid/v143/denmark-only',
        sourceProvider: 'ticketmaster',
        providerEventId: 'qa-v143-event-denmark-only',
        foundAt: '2027-07-10T12:00:00.000Z',
      },
    ];

    localStorage.setItem('livevault-qa:data', JSON.stringify(data));
    const settings = JSON.parse(localStorage.getItem('concertTrackerSettings') || '{}');
    Object.assign(settings, { europeOnly: false, nearbyOnly: false, swedenOnly: false });
    localStorage.setItem('concertTrackerSettings', JSON.stringify(settings));
  });
  await page.reload();
}

async function expectNoHorizontalOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test('v143 aligns separators, header naming, stats tabs, and Sweden filters', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium'
    ? { width: 375, height: 820 }
    : { width: 480, height: 900 });
  await installV143SyntheticState(page);

  // My Concerts: Upcoming gets the same centered line treatment as Past.
  const upcomingLabel = page.locator('#screen-myconcerts .section-label-v143-upcoming');
  const pastLabel = page.locator('#screen-myconcerts .section-label-gap-lg');
  await expect(upcomingLabel).toHaveText(/Upcoming concerts/i);
  await expect(pastLabel).toHaveText(/Past concerts/i);
  const dividerStyles = await page.evaluate(() => {
    const upcoming = document.querySelector('#screen-myconcerts .section-label-v143-upcoming');
    const past = document.querySelector('#screen-myconcerts .section-label-gap-lg');
    const read = (node) => ({
      display: getComputedStyle(node).display,
      beforeHeight: getComputedStyle(node, '::before').height,
      beforeColor: getComputedStyle(node, '::before').backgroundColor,
      beforeOpacity: getComputedStyle(node, '::before').opacity,
      afterHeight: getComputedStyle(node, '::after').height,
      afterColor: getComputedStyle(node, '::after').backgroundColor,
      afterOpacity: getComputedStyle(node, '::after').opacity,
    });
    return { upcoming: read(upcoming), past: read(past) };
  });
  expect(dividerStyles.upcoming).toEqual(dividerStyles.past);
  await expectNoHorizontalOverflow(page);

  // Alerts: the root header follows the CONCERTDATES two-tone naming pattern.
  await page.locator('#tabbar [data-tab="news"]').click();
  await expect(page.locator('#header-title')).toHaveText('CONCERTALERTS');
  await expect(page.locator('#header-title .brand-blue')).toHaveText('CONCERT');
  await expectNoHorizontalOverflow(page);

  // ConcertDates: SE sits exactly between Nearby and EU and matches EU sizing.
  await page.locator('#tabbar [data-tab="concerts"]').click();
  const order = await page.locator('#app-header > button').evaluateAll((buttons) =>
    buttons.filter((button) => !button.classList.contains('hidden')).map((button) => button.id));
  const nearbyIndex = order.indexOf('nearby-toggle-btn');
  const swedenIndex = order.indexOf('sweden-toggle-btn');
  const europeIndex = order.indexOf('europe-toggle-btn');
  expect(nearbyIndex).toBeGreaterThanOrEqual(0);
  expect(swedenIndex).toBe(nearbyIndex + 1);
  expect(europeIndex).toBe(swedenIndex + 1);

  const mainSizes = await page.evaluate(() => {
    const se = document.querySelector('#sweden-toggle-btn').getBoundingClientRect();
    const eu = document.querySelector('#europe-toggle-btn').getBoundingClientRect();
    return { se: { width: se.width, height: se.height }, eu: { width: eu.width, height: eu.height } };
  });
  expect(Math.abs(mainSizes.se.width - mainSizes.eu.width)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(mainSizes.se.height - mainSizes.eu.height)).toBeLessThanOrEqual(0.5);

  const concertDatesTabsHeight = await page.locator('#screen-concerts .news-subtab-switch').evaluate((node) => node.getBoundingClientRect().height);

  await page.locator('#sweden-toggle-btn').click();
  await expect(page.locator('#sweden-toggle-btn')).toHaveClass(/active/);
  await expect(page.locator('#europe-toggle-btn')).not.toHaveClass(/active/);
  await expect(page.locator('#nearby-toggle-btn')).not.toHaveClass(/active/);
  await expect(page.locator('#screen-concerts')).toContainText('QA V143 Mixed Band');
  await expect(page.locator('#screen-concerts')).not.toContainText('QA V143 Denmark Only');
  await expectNoHorizontalOverflow(page);

  // Stats: segmented control uses the current ConcertDates control height.
  await page.locator('#tabbar [data-tab="stats"]').click();
  const statsTabsHeight = await page.locator('#screen-stats .stats-subtabs').evaluate((node) => node.getBoundingClientRect().height);
  expect(Math.abs(statsTabsHeight - concertDatesTabsHeight)).toBeLessThanOrEqual(1);
  await expectNoHorizontalOverflow(page);

  // Band Detail: transient SE filter is inserted between Nearby and EU,
  // matches EU sizing, and keeps only Sweden dates for that band.
  await page.evaluate(() => openProfile('qa-v143-mixed-band'));
  const profileOrder = await page.locator('#screen-profile .section-label-filters > button').evaluateAll((buttons) => buttons.map((button) => button.id));
  expect(profileOrder).toEqual(['profile-nearby-toggle-btn', 'profile-sweden-toggle-btn', 'profile-europe-toggle-btn']);

  const profileSizes = await page.evaluate(() => {
    const se = document.querySelector('#profile-sweden-toggle-btn').getBoundingClientRect();
    const eu = document.querySelector('#profile-europe-toggle-btn').getBoundingClientRect();
    return { se: { width: se.width, height: se.height }, eu: { width: eu.width, height: eu.height } };
  });
  expect(Math.abs(profileSizes.se.width - profileSizes.eu.width)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(profileSizes.se.height - profileSizes.eu.height)).toBeLessThanOrEqual(0.5);
  await expect(page.locator('#screen-profile')).toContainText('QA Stockholm Hall');
  await expect(page.locator('#screen-profile')).toContainText('QA Copenhagen Hall');

  await page.locator('#profile-sweden-toggle-btn').click();
  await expect(page.locator('#profile-sweden-toggle-btn')).toHaveClass(/active/);
  await expect(page.locator('#profile-europe-toggle-btn')).not.toHaveClass(/active/);
  await expect(page.locator('#profile-nearby-toggle-btn')).not.toHaveClass(/active/);
  await expect(page.locator('#screen-profile')).toContainText('QA Stockholm Hall');
  await expect(page.locator('#screen-profile')).not.toContainText('QA Copenhagen Hall');
  await expectNoHorizontalOverflow(page);

  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-v143-aligned-ui.png`), fullPage: true });
});

test('v143 resolves a persisted Sweden filter as the only active root geographic filter', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium'
    ? { width: 375, height: 820 }
    : { width: 480, height: 900 });
  await installV143SyntheticState(page);

  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('concertTrackerSettings') || '{}');
    Object.assign(settings, { swedenOnly: true, europeOnly: true, nearbyOnly: true });
    localStorage.setItem('concertTrackerSettings', JSON.stringify(settings));
  });
  await page.reload();
  await page.locator('#tabbar [data-tab="concerts"]').click();

  await expect(page.locator('#sweden-toggle-btn')).toHaveClass(/active/);
  await expect(page.locator('#europe-toggle-btn')).not.toHaveClass(/active/);
  await expect(page.locator('#nearby-toggle-btn')).not.toHaveClass(/active/);
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('concertTrackerSettings') || '{}'));
  expect(persisted.swedenOnly).toBe(true);
  expect(persisted.europeOnly).toBe(false);
  expect(persisted.nearbyOnly).toBe(false);
});
