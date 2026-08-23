const { test, expect } = require('@playwright/test');

async function openApp(page, testInfo) {
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium' ? { width: 375, height: 900 } : { width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: testInfo.project.name === 'mobile-chromium' ? 'light' : 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}

async function makeSharedFixtureAutomatic(page, { past = false, cityMode = 'same', ticketConflict = false } = {}) {
  await page.evaluate(({ pastDate, cityModeValue, ticketConflictValue }) => {
    const data = JSON.parse(localStorage.getItem('livevault-qa:data'));
    const showDay = data.concerts.find((record) => record.id === 'qa-show-day');
    showDay.attending = false;
    const shared = data.concerts.filter((record) => record.id.startsWith('qa-group-'));
    for (const record of shared) {
      delete record.eventGroupId;
      record.date = pastDate ? '2027-05-02' : '2027-07-17';
      record.city = 'Sample City';
      record.ticketQuantity = 4;
    }
    if (cityModeValue === 'blank') shared.forEach((record) => { record.city = ''; });
    if (cityModeValue === 'different') shared[2].city = 'Other Sample City';
    if (ticketConflictValue) shared[1].ticketQuantity = 2;
    localStorage.setItem('livevault-qa:data', JSON.stringify(data));
  }, { pastDate: past, cityModeValue: cityMode, ticketConflictValue: ticketConflict });
  await page.reload();
}

test('v157 automatically groups strong context, removes Link CTA, orders Support first and preserves grouped Next Concert', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);
  await makeSharedFixtureAutomatic(page);

  await expect(page.getByRole('button', { name: 'Link same event' })).toHaveCount(0);
  const orderedIds = await page.locator('.row-card-mc').evaluateAll((cards) => cards
    .map((card) => card.querySelector('.remove-going-btn')?.dataset.concertId)
    .filter((id) => id?.startsWith('qa-group-')));
  expect(orderedIds).toEqual(['qa-group-support-a', 'qa-group-support-b', 'qa-group-headliner']);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('livevault-qa:data')).concerts.filter((record) => record.id.startsWith('qa-group-')));
  expect(stored.every((record) => !record.eventGroupId)).toBe(true);
  expect(stored.map((record) => record.id)).toHaveLength(3);

  const ticket = page.locator('#countdown-card');
  await expect(ticket.locator('.countdown-v156-headliner')).toHaveText('QA Artist One');
  await expect(ticket.locator('.countdown-v156-supports p')).toHaveText([
    'QA Artist Four With An Intentionally Very Long Artist Name For Responsive Testing', 'QA Artist Two',
  ]);
  await expect(ticket.locator('.countdown-v139-venue')).toHaveText('Shared Event Arena');
  await expect(ticket.locator('.countdown-v139-address')).toHaveText('Sample City');
  await expect(ticket.locator('.countdown-v140-ticket-count strong')).toHaveText('4 TICKETS');
  await expect(ticket.locator('.countdown-ticket-outline')).toBeVisible();

  for (const width of [375, 480]) {
    await page.setViewportSize({ width, height: 920 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('v157 automatic event semantics count one night, keep performances separate and never add conflicting tickets', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);
  await makeSharedFixtureAutomatic(page, { ticketConflict: true });
  await expect(page.locator('#countdown-card .countdown-v140-ticket-count strong')).toHaveText('2 TICKETS');
  await expect(page.locator('#countdown-card .countdown-v156-ticket-conflict small')).toHaveText('CHECK COUNT');
  await expect(page.locator('#countdown-card')).not.toContainText('6 TICKETS');

  await makeSharedFixtureAutomatic(page, { past: true });
  await page.locator('#tabbar [data-tab="stats"]').click();
  await page.getByRole('tab', { name: 'Concerts' }).click();
  const overview = page.locator('.section-label', { hasText: 'Overview' }).locator('+ .stats-kpi-grid');
  await expect(overview).toContainText('2');
  await expect(overview).toContainText('concert nights attended');
  await expect(page.locator('.section-label', { hasText: 'Lineup role' }).locator('+ .stats-kpi-grid')).toContainText('support performances');
  await expect(page.locator('.section-label', { hasText: 'Money' }).locator('+ .stats-kpi-grid')).toContainText('1,200 kr');
  await expect(page.locator('.section-label', { hasText: 'Money' }).locator('+ .stats-kpi-grid')).toContainText('average ticket cost per event');
  expect(errors).toEqual([]);
});

test('v157 missing-city and different-city pairs fail closed', async ({ page }, testInfo) => {
  await openApp(page, testInfo);
  await makeSharedFixtureAutomatic(page, { cityMode: 'blank' });
  await expect(page.locator('#countdown-card .countdown-v156-supports')).toHaveCount(0);
  let grouped = await page.evaluate(() => EventModelV156.groupConcertPerformances(JSON.parse(localStorage.getItem('livevault-qa:data')).concerts.filter((record) => record.id.startsWith('qa-group-'))).filter((event) => event.records.length > 1).length);
  expect(grouped).toBe(0);

  await makeSharedFixtureAutomatic(page, { cityMode: 'different' });
  grouped = await page.evaluate(() => EventModelV156.groupConcertPerformances(JSON.parse(localStorage.getItem('livevault-qa:data')).concerts.filter((record) => record.id.startsWith('qa-group-'))).filter((event) => event.records.length > 1).length);
  expect(grouped).toBe(1);
  const groups = await page.evaluate(() => EventModelV156.groupConcertPerformances(JSON.parse(localStorage.getItem('livevault-qa:data')).concerts.filter((record) => record.id.startsWith('qa-group-'))).map((event) => event.records.map((record) => record.id)));
  expect(groups).toContainEqual(['qa-group-support-a', 'qa-group-support-b']);
  expect(groups).toContainEqual(['qa-group-headliner']);
});

test('v157 Add a concert wording and dynamic future year create a visible upcoming attended record', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);

  const addCard = page.locator('.add-band-card');
  await expect(addCard.locator('.section-label')).toHaveText('ADD A CONCERT');
  await expect(page.locator('#past-concert-submit')).toContainText('Add a concert');
  await expect(page.locator('#past-concert-year option').first()).toHaveText('Year');
  await expect(page.locator('#past-concert-year option').nth(1)).toHaveText('2028');
  await expect(page.locator('#past-concert-year option[value="2029"]')).toHaveCount(0);

  await page.locator('#past-concert-band').selectOption('qa-artist-five');
  await page.locator('#past-concert-venue').fill('Synthetic Future Hall');
  await page.locator('#past-concert-city').fill('Sample City');
  await page.locator('#past-concert-year').selectOption('2028');
  await page.locator('#past-concert-month').selectOption('01');
  await page.locator('#past-concert-day').selectOption('10');
  await page.locator('#past-concert-submit').click();

  const futureCard = page.locator('.row-card-mc').filter({ hasText: 'Synthetic Ensemble' }).filter({ hasText: 'Synthetic Future Hall' });
  await expect(futureCard).toBeVisible();
  const added = await page.evaluate(() => JSON.parse(localStorage.getItem('livevault-qa:data')).concerts.find((record) => record.venue === 'Synthetic Future Hall'));
  expect(added.attending).toBe(true);
  expect(added.manuallyAdded).toBe(true);
  expect(added.lineupRole).toBe('headliner');
  expect(added.date).toBe('2028-01-10');

  for (const width of [375, 480]) {
    await page.setViewportSize({ width, height: 920 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});
