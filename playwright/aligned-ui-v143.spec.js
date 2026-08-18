const { test, expect } = require('@playwright/test');

async function installV143SyntheticState(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const data = JSON.parse(localStorage.getItem('livevault-qa:data') || '{}');
    const bandId = 'qa-v143-mixed-band';
    const denmarkOnlyBandId = 'qa-v143-denmark-only';
    const representativeBandId = 'qa-v143-representative-band';

    data.bands = [
      ...(data.bands || []).filter((band) => ![bandId, denmarkOnlyBandId, representativeBandId].includes(band.id)),
      { id: bandId, name: 'QA V143 Mixed Band', genre: 'Rock' },
      { id: denmarkOnlyBandId, name: 'QA V143 Denmark Only', genre: 'Rock' },
      { id: representativeBandId, name: 'QA V143 Representative Band', genre: 'Rock' },
    ];

    data.concerts = [
      ...(data.concerts || []).filter((concert) => !String(concert.id || '').startsWith('qa-v143-')),
      {
        id: 'qa-v143-sweden-show', bandId, bandName: 'QA V143 Mixed Band', date: '2027-09-01', time: '19:30',
        venue: 'QA Stockholm Hall', city: 'Stockholm', country: 'Sweden', distanceKm: 500,
        ticketUrl: 'https://qa.invalid/v143/sweden', sourceProvider: 'ticketmaster',
        providerEventId: 'qa-v143-event-sweden', foundAt: '2027-07-10T12:00:00.000Z',
      },
      {
        id: 'qa-v143-denmark-show', bandId, bandName: 'QA V143 Mixed Band', date: '2027-09-02', time: '20:00',
        venue: 'QA Copenhagen Hall', city: 'Copenhagen', country: 'Denmark', distanceKm: 60,
        ticketUrl: 'https://qa.invalid/v143/denmark', sourceProvider: 'ticketmaster',
        providerEventId: 'qa-v143-event-denmark', foundAt: '2027-07-10T12:00:00.000Z',
      },
      {
        id: 'qa-v143-denmark-only-show', bandId: denmarkOnlyBandId, bandName: 'QA V143 Denmark Only',
        date: '2027-09-03', time: '20:30', venue: 'QA Aarhus Hall', city: 'Aarhus', country: 'Denmark', distanceKm: 220,
        ticketUrl: 'https://qa.invalid/v143/denmark-only', sourceProvider: 'ticketmaster',
        providerEventId: 'qa-v143-event-denmark-only', foundAt: '2027-07-10T12:00:00.000Z',
      },
      {
        id: 'qa-v143-representative-denmark-show', bandId: representativeBandId, bandName: 'QA V143 Representative Band',
        date: '2027-08-20', time: '19:00', venue: 'QA Odense Hall', city: 'Odense', country: 'Denmark', distanceKm: 180,
        ticketUrl: 'https://qa.invalid/v143/representative-denmark', sourceProvider: 'ticketmaster',
        providerEventId: 'qa-v143-event-representative-denmark', foundAt: '2027-07-10T12:00:00.000Z',
      },
      {
        id: 'qa-v143-representative-sweden-show', bandId: representativeBandId, bandName: 'QA V143 Representative Band',
        date: '2027-09-05', time: '19:00', venue: 'QA Gothenburg Hall', city: 'Gothenburg', country: 'Sweden', distanceKm: 280,
        ticketUrl: 'https://qa.invalid/v143/representative-sweden', sourceProvider: 'ticketmaster',
        providerEventId: 'qa-v143-event-representative-sweden', foundAt: '2027-07-10T12:00:00.000Z',
      },
    ];

    localStorage.setItem('livevault-qa:data', JSON.stringify(data));
    await chrome.storage.local.set({ europeOnly: false, nearbyOnly: false, swedenOnly: false });
  });
  await page.reload();
}

function viewportFor(testInfo) {
  return testInfo.project.name === 'mobile-chromium'
    ? { width: 375, height: 820 }
    : { width: 480, height: 900 };
}

async function expectNoHorizontalOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

async function expectDividerParity(page) {
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
}

async function expectMainFilterGeometry(page) {
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
}

async function expectProfileFilterGeometry(page) {
  const profileOrder = await page.locator('#screen-profile .section-label-filters > button').evaluateAll((buttons) => buttons.map((button) => button.id));
  expect(profileOrder).toEqual(['profile-nearby-toggle-btn', 'profile-sweden-toggle-btn', 'profile-europe-toggle-btn']);

  const profileSizes = await page.evaluate(() => {
    const se = document.querySelector('#profile-sweden-toggle-btn').getBoundingClientRect();
    const eu = document.querySelector('#profile-europe-toggle-btn').getBoundingClientRect();
    return { se: { width: se.width, height: se.height }, eu: { width: eu.width, height: eu.height } };
  });
  expect(Math.abs(profileSizes.se.width - profileSizes.eu.width)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(profileSizes.se.height - profileSizes.eu.height)).toBeLessThanOrEqual(0.5);
}

for (const colorScheme of ['dark', 'light']) {
  test(`v143 aligns the approved visible UI in ${colorScheme} mode`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.setViewportSize(viewportFor(testInfo));
    await installV143SyntheticState(page);

    await expectDividerParity(page);
    await expectNoHorizontalOverflow(page);

    await page.locator('#tabbar [data-tab="news"]').click();
    await expect(page.locator('#header-title')).toHaveText('CONCERTALERTS');
    await expect(page.locator('#header-title .brand-blue')).toHaveText('CONCERT');
    await expectNoHorizontalOverflow(page);

    await page.locator('#tabbar [data-tab="concerts"]').click();
    await expectMainFilterGeometry(page);
    const concertDatesTabsHeight = await page.locator('#screen-concerts .news-subtab-switch').evaluate((node) => node.getBoundingClientRect().height);
    await expectNoHorizontalOverflow(page);

    await page.locator('#tabbar [data-tab="stats"]').click();
    const statsTabsHeight = await page.locator('#screen-stats .stats-subtabs').evaluate((node) => node.getBoundingClientRect().height);
    expect(Math.abs(statsTabsHeight - concertDatesTabsHeight)).toBeLessThanOrEqual(1);
    await expectNoHorizontalOverflow(page);

    await page.evaluate(() => openProfile('qa-v143-mixed-band'));
    await expectProfileFilterGeometry(page);
    await expectNoHorizontalOverflow(page);

    await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-v143-aligned-ui-${colorScheme}.png`), fullPage: true });
  });
}

test('v143 Sweden filters are exact and mutually exclusive in both concert views', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize(viewportFor(testInfo));
  await installV143SyntheticState(page);

  let rootSweden = page.locator('#sweden-toggle-btn');
  let rootEurope = page.locator('#europe-toggle-btn');
  let rootNearby = page.locator('#nearby-toggle-btn');

  await page.locator('#tabbar [data-tab="concerts"]').click();
  await rootSweden.click();
  await expect(rootSweden).toHaveClass(/active/);
  await expect(rootEurope).not.toHaveClass(/active/);
  await expect(rootNearby).not.toHaveClass(/active/);
  await expect(page.locator('#screen-concerts')).toContainText('QA V143 Mixed Band');
  await expect(page.locator('#screen-concerts')).not.toContainText('QA V143 Denmark Only');

  // Direct SE -> EU transition.
  await rootEurope.click();
  await expect(rootEurope).toHaveClass(/active/);
  await expect(rootSweden).not.toHaveClass(/active/);
  await expect(rootNearby).not.toHaveClass(/active/);

  // Fresh neutral root state proves the independent direct SE -> Nearby transition
  // without reusing one globally feedback-armed control inside a synthetic burst.
  await installV143SyntheticState(page);
  rootSweden = page.locator('#sweden-toggle-btn');
  rootEurope = page.locator('#europe-toggle-btn');
  rootNearby = page.locator('#nearby-toggle-btn');
  await page.locator('#tabbar [data-tab="concerts"]').click();
  await rootSweden.click();
  await expect(rootSweden).toHaveClass(/active/);
  await rootNearby.click();
  await expect(rootNearby).toHaveClass(/active/);
  await expect(rootSweden).not.toHaveClass(/active/);
  await expect(rootEurope).not.toHaveClass(/active/);

  await page.evaluate(() => openProfile('qa-v143-mixed-band'));
  await expect(page.locator('#screen-profile')).toContainText('QA Stockholm Hall');
  await expect(page.locator('#screen-profile')).toContainText('QA Copenhagen Hall');

  let profileSweden = page.locator('#profile-sweden-toggle-btn');
  let profileEurope = page.locator('#profile-europe-toggle-btn');
  let profileNearby = page.locator('#profile-nearby-toggle-btn');

  await profileSweden.click();
  await expect(profileSweden).toHaveClass(/active/);
  await expect(profileEurope).not.toHaveClass(/active/);
  await expect(profileNearby).not.toHaveClass(/active/);
  await expect(page.locator('#screen-profile')).toContainText('QA Stockholm Hall');
  await expect(page.locator('#screen-profile')).not.toContainText('QA Copenhagen Hall');

  // Direct profile SE -> EU transition.
  await profileEurope.click();
  await expect(profileEurope).toHaveClass(/active/);
  await expect(profileSweden).not.toHaveClass(/active/);
  await expect(profileNearby).not.toHaveClass(/active/);

  // Reopening the profile resets transient filters; from that neutral state,
  // independently prove the direct profile SE -> Nearby transition.
  await page.evaluate(() => openProfile('qa-v143-mixed-band'));
  profileSweden = page.locator('#profile-sweden-toggle-btn');
  profileEurope = page.locator('#profile-europe-toggle-btn');
  profileNearby = page.locator('#profile-nearby-toggle-btn');
  await expect(profileSweden).not.toHaveClass(/active/);
  await expect(profileEurope).not.toHaveClass(/active/);
  await expect(profileNearby).not.toHaveClass(/active/);
  await profileSweden.click();
  await expect(profileSweden).toHaveClass(/active/);
  await profileNearby.click();
  await expect(profileNearby).toHaveClass(/active/);
  await expect(profileSweden).not.toHaveClass(/active/);
  await expect(profileEurope).not.toHaveClass(/active/);
  await expectNoHorizontalOverflow(page);
});

test('v143 root Sweden filtering preserves representative-show semantics', async ({ page }, testInfo) => {
  await page.setViewportSize(viewportFor(testInfo));
  await installV143SyntheticState(page);

  await page.locator('#tabbar [data-tab="concerts"]').click();
  await expect(page.locator('#screen-concerts')).toContainText('QA V143 Representative Band');
  await expect(page.locator('#screen-concerts')).toContainText('QA Odense Hall');
  await expect(page.locator('#screen-concerts')).not.toContainText('QA Gothenburg Hall');

  await page.locator('#sweden-toggle-btn').click();
  await expect(page.locator('#screen-concerts')).not.toContainText('QA V143 Representative Band');
  await expect(page.locator('#screen-concerts')).not.toContainText('QA Gothenburg Hall');
});

test('v143 Band Detail Sweden filter resets when a band page is opened', async ({ page }, testInfo) => {
  await page.setViewportSize(viewportFor(testInfo));
  await installV143SyntheticState(page);

  await page.evaluate(() => openProfile('qa-v143-mixed-band'));
  await page.locator('#profile-sweden-toggle-btn').click();
  await expect(page.locator('#profile-sweden-toggle-btn')).toHaveClass(/active/);
  await expect(page.locator('#screen-profile')).not.toContainText('QA Copenhagen Hall');

  await page.evaluate(() => openProfile('qa-v143-denmark-only'));
  await expect(page.locator('#profile-sweden-toggle-btn')).not.toHaveClass(/active/);
  await expect(page.locator('#profile-europe-toggle-btn')).not.toHaveClass(/active/);
  await expect(page.locator('#profile-nearby-toggle-btn')).not.toHaveClass(/active/);
  await expect(page.locator('#screen-profile')).toContainText('QA Aarhus Hall');

  await page.evaluate(() => openProfile('qa-v143-mixed-band'));
  await expect(page.locator('#profile-sweden-toggle-btn')).not.toHaveClass(/active/);
  await expect(page.locator('#screen-profile')).toContainText('QA Stockholm Hall');
  await expect(page.locator('#screen-profile')).toContainText('QA Copenhagen Hall');
});

test('v143 resolves a persisted Sweden filter as the only active root geographic filter', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize(viewportFor(testInfo));
  await installV143SyntheticState(page);

  await page.evaluate(async () => {
    await chrome.storage.local.set({ swedenOnly: true, europeOnly: true, nearbyOnly: true });
  });
  await page.reload();
  await page.locator('#tabbar [data-tab="concerts"]').click();

  await expect(page.locator('#sweden-toggle-btn')).toHaveClass(/active/);
  await expect(page.locator('#europe-toggle-btn')).not.toHaveClass(/active/);
  await expect(page.locator('#nearby-toggle-btn')).not.toHaveClass(/active/);
  const persisted = await page.evaluate(async () => chrome.storage.local.get(['swedenOnly', 'europeOnly', 'nearbyOnly']));
  expect(persisted.swedenOnly).toBe(true);
  expect(persisted.europeOnly).toBe(false);
  expect(persisted.nearbyOnly).toBe(false);
});

test('v143 keeps the root Sweden filter off the connection-error header', async ({ page }, testInfo) => {
  await page.setViewportSize(viewportFor(testInfo));
  await installV143SyntheticState(page);

  await page.locator('#tabbar [data-tab="concerts"]').click();
  await expect(page.locator('#sweden-toggle-btn')).toBeVisible();
  await page.evaluate(() => showConnectionError());
  await expect(page.locator('#screen-connection-error')).toBeVisible();
  await expect(page.locator('#sweden-toggle-btn')).toBeHidden();
});