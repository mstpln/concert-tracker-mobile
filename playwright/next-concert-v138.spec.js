const { test, expect } = require('@playwright/test');

async function openStart(page) {
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
  await expect(page.locator('#screen-myconcerts')).toBeVisible();
}

test('v138 show-day card uses directions plus the compact Open tickets circle', async ({ page }) => {
  await openStart(page);
  const card = page.locator('#countdown-card');
  await expect(card).toHaveAttribute('data-today', 'true');
  await expect(card.locator('.countdown-ticket-outline')).toBeVisible();
  await expect(card.locator('.countdown-ticket-tear')).toBeVisible();
  await expect(card.getByRole('link', { name: 'Get directions' })).toBeVisible();
  const ticket = card.getByRole('link', { name: 'Open tickets' });
  await expect(ticket).toBeVisible();
  await expect(ticket.locator('svg')).toHaveCount(1);
  await expect(card).not.toContainText('🎟');
  await expect(card.locator('.countdown-v138-location-line')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('v138 normal countdown card keeps live countdown ids and matching graphite perforation', async ({ page }) => {
  await openStart(page);
  await page.evaluate(() => {
    const fixtures = window.LiveVaultQaFixtures.createLiveVaultQaFixtures();
    const concert = fixtures.concerts.find((item) => item.id === 'qa-one-pdf');
    document.querySelector('#screen-myconcerts').innerHTML = window.countdownCardHtml(concert);
  });
  const card = page.locator('#countdown-card');
  await expect(card).toHaveAttribute('data-today', 'false');
  await expect(card.locator('#countdown-ring-day')).toBeVisible();
  await expect(card.locator('#countdown-d')).toBeVisible();
  await expect(card.locator('#countdown-h')).toBeVisible();
  await expect(card.locator('#countdown-m')).toBeVisible();
  await expect(card.locator('#countdown-s')).toBeVisible();
  const colors = await card.evaluate((node) => {
    const contour = node.querySelector('.countdown-ticket-contour');
    const tear = node.querySelector('.countdown-ticket-tear');
    return { contour: getComputedStyle(contour).stroke, tear: getComputedStyle(tear).stroke };
  });
  expect(colors.tear).toBe(colors.contour);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
