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

  await expect(page.locator('#start-version-refresh')).toContainText('v94');

  const startCard = page.locator('#screen-myconcerts .row-card-mc').first();
  await expect(startCard).toBeVisible();
  expect(await background(startCard)).toBe('rgb(35, 42, 50)');

  await page.evaluate(() => {
    const addRow = (parent, marker) => {
      const row = document.createElement('article');
      row.className = 'row-card';
      row.dataset.v86Qa = marker;
      row.textContent = marker;
      parent.appendChild(row);
    };
    addRow(document.querySelector('#screen-concerts'), 'dates');
    addRow(document.querySelector('#screen-venue-detail'), 'venue');
    const divider = document.createElement('div');
    divider.className = 'profile-divider';
    document.querySelector('#screen-profile').appendChild(divider);
    addRow(divider, 'profile-concert');
    addRow(document.querySelector('#screen-mybands'), 'generic-band');
  });

  expect(await background(page.locator('[data-v86-qa="dates"]'))).toBe('rgb(35, 42, 50)');
  expect(await background(page.locator('[data-v86-qa="venue"]'))).toBe('rgb(35, 42, 50)');
  expect(await background(page.locator('[data-v86-qa="profile-concert"]'))).toBe('rgb(35, 42, 50)');
  expect(await background(page.locator('[data-v86-qa="generic-band"]'))).not.toBe('rgb(35, 42, 50)');

  await page.locator('#screen-myconcerts').screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-v86-charcoal-concert-cards.png`),
    fullPage: true,
  });
});
