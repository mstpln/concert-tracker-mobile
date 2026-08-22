const { test, expect } = require('@playwright/test');

async function openApp(page, testInfo) {
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium' ? { width: 375, height: 900 } : { width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: testInfo.project.name === 'mobile-chromium' ? 'light' : 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}

async function setNextToSharedEvent(page, conflict = false) {
  await page.evaluate((hasConflict) => {
    const data = JSON.parse(localStorage.getItem('livevault-qa:data'));
    const showDay = data.concerts.find((record) => record.id === 'qa-show-day');
    showDay.attending = false;
    if (hasConflict) data.concerts.find((record) => record.id === 'qa-group-support-b').ticketQuantity = 2;
    localStorage.setItem('livevault-qa:data', JSON.stringify(data));
  }, conflict);
  await page.reload();
}

test('AUB3 groups, unlinks and relinks explicitly with persistent recoverable state', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);
  const supportCard = page.locator('.row-card-mc').filter({ has: page.locator('[data-event-group-toggle="qa-group-support-a"]') });
  await supportCard.getByRole('button', { name: /Shared event · 3 performances/ }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await supportCard.getByRole('button', { name: 'Unlink from shared event' }).click();
  await expect(supportCard.getByRole('button', { name: 'Link same event' })).toBeVisible();
  await page.reload();
  let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('livevault-qa:data')).concerts);
  expect(stored.find((record) => record.id === 'qa-group-support-a').eventGroupId).toBeUndefined();
  expect(stored.filter((record) => record.eventGroupId === 'event-qa-shared-2027')).toHaveLength(2);

  await supportCard.getByRole('button', { name: 'Link same event' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await supportCard.getByRole('button', { name: /QA Artist One · Headliner/ }).click();
  await expect(supportCard.getByRole('button', { name: /Shared event · 3 performances/ })).toBeVisible();
  await page.reload();
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('livevault-qa:data')).concerts);
  expect(new Set(stored.filter((record) => record.id.startsWith('qa-group-')).map((record) => record.eventGroupId)).size).toBe(1);

  await supportCard.getByRole('button', { name: /Shared event/ }).click();
  await page.evaluate(() => localStorage.setItem('livevault-qa:failures', JSON.stringify({ write: 'concerts.json' })));
  page.once('dialog', (dialog) => dialog.accept());
  await supportCard.getByRole('button', { name: 'Unlink from shared event' }).click();
  await expect(supportCard.getByRole('status')).toHaveText('Could not unlink the shared event. Try again.');
  await expect(supportCard.getByRole('button', { name: /Shared event · 3 performances/ })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem('livevault-qa:failures'));
  expect(errors).toEqual([]);
});

test('AUB3 grouped Next Concert, ordering, conflict handling and event-level Stats remain contained', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, testInfo);
  await setNextToSharedEvent(page);

  const ticket = page.locator('#countdown-card');
  await expect(ticket.locator('.countdown-v156-headliner')).toHaveText('QA Artist One');
  await expect(ticket.locator('.countdown-v156-supports p')).toHaveText([
    'QA Artist Four With An Intentionally Very Long Artist Name For Responsive Testing', 'QA Artist Two',
  ]);
  await expect(ticket.locator('.countdown-v139-venue')).toHaveText('Shared Event Arena');
  await expect(ticket.locator('.countdown-v139-address')).toHaveText('Sample City');
  await expect(ticket.locator('.countdown-v140-ticket-count strong')).toHaveText('4 TICKETS');
  await expect(ticket.locator('.countdown-ticket-outline')).toBeVisible();

  const orderedIds = await page.locator('.row-card-mc').evaluateAll((cards) => cards
    .map((card) => card.querySelector('.remove-going-btn')?.dataset.concertId)
    .filter((id) => id?.startsWith('qa-group-')));
  expect(orderedIds).toEqual(['qa-group-support-a', 'qa-group-support-b', 'qa-group-headliner']);
  await ticket.screenshot({ path: testInfo.outputPath(`aub3-v156-grouped-next-${testInfo.project.name}.png`) });

  await setNextToSharedEvent(page, true);
  await expect(page.locator('#countdown-card .countdown-v140-ticket-count strong')).toHaveText('2 TICKETS');
  await expect(page.locator('#countdown-card .countdown-v156-ticket-conflict small')).toHaveText('CHECK COUNT');
  await expect(page.locator('#countdown-card')).not.toContainText('6 TICKETS');

  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('livevault-qa:data'));
    for (const record of data.concerts.filter((item) => item.id.startsWith('qa-group-'))) {
      record.date = '2027-05-02'; record.ticketQuantity = 4;
    }
    localStorage.setItem('livevault-qa:data', JSON.stringify(data));
  });
  await page.reload();
  await page.locator('#tabbar [data-tab="stats"]').click();
  await page.getByRole('tab', { name: 'Concerts' }).click();
  const overview = page.locator('.section-label', { hasText: 'Overview' }).locator('+ .stats-kpi-grid');
  await expect(overview).toContainText('2');
  await expect(overview).toContainText('concert nights attended');
  await expect(page.locator('.section-label', { hasText: 'Lineup role' }).locator('+ .stats-kpi-grid')).toContainText('support performances');
  await expect(page.locator('.section-label', { hasText: 'Money' }).locator('+ .stats-kpi-grid')).toContainText('1,200 kr');
  await expect(page.locator('.section-label', { hasText: 'Money' }).locator('+ .stats-kpi-grid')).toContainText('average ticket cost per event');

  for (const width of [375, 480]) {
    await page.setViewportSize({ width, height: 920 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`aub3-v156-stats-${testInfo.project.name}.png`), fullPage: true });
});
