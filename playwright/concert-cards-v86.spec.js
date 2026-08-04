const { test, expect } = require('@playwright/test');

async function background(locator) {
  return locator.evaluate((element) => getComputedStyle(element).backgroundColor);
}

test('v86 applies charcoal blue only to concert listing cards', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium'
    ? { width: 375, height: 820 }
    : { width: 480, height: 900 });
  await page.goto('/');

  await expect(page.locator('#start-version-refresh')).toContainText('v86');

  const startCard = page.locator('#screen-myconcerts .row-card-mc').first();
  await expect(startCard).toBeVisible();
  expect(await background(startCard)).toBe('rgb(35, 42, 50)');

  await page.getByRole('button', { name: 'Dates' }).click();
  const datesCard = page.locator('#screen-concerts .row-card').first();
  await expect(datesCard).toBeVisible();
  expect(await background(datesCard)).toBe('rgb(35, 42, 50)');

  await page.getByRole('button', { name: 'Bands' }).click();
  const bandCard = page.locator('#screen-mybands .row-card').first();
  await expect(bandCard).toBeVisible();
  expect(await background(bandCard)).not.toBe('rgb(35, 42, 50)');

  await bandCard.click();
  await expect(page.locator('#screen-profile')).toBeVisible();
  await page.getByRole('tab', { name: 'Concerts', exact: true }).click();
  const profileCard = page.locator('#screen-profile .profile-divider .row-card').first();
  await expect(profileCard).toBeVisible();
  expect(await background(profileCard)).toBe('rgb(35, 42, 50)');

  await page.getByRole('tab', { name: 'Alerts', exact: true }).click();
  const nonConcertProfileCard = page.locator('#screen-profile .row-card').first();
  if (await nonConcertProfileCard.count()) {
    expect(await background(nonConcertProfileCard)).not.toBe('rgb(35, 42, 50)');
  }

  await page.getByRole('tab', { name: 'Concerts', exact: true }).click();
  await page.locator('#screen-profile').screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-v86-charcoal-concert-cards.png`),
    fullPage: true,
  });
});
