const { test, expect } = require('@playwright/test');

async function openStart(page) {
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
  await expect(page.locator('#screen-myconcerts')).toBeVisible();
}

function localDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

test('v138 show-day card uses directions plus the compact Open tickets circle', async ({ page }) => {
  await openStart(page);
  const today = localDateString(new Date());
  await page.evaluate((date) => {
    const concert = {
      id: 'qa-v138-show-day', bandId: 'qa-artist-one', bandName: 'QA Artist One', date, time: '20:00',
      venue: 'Example Arena', address: '1 Fictional Avenue', city: 'Sample City', country: 'Exampleland',
      latitude: 55.5, longitude: 13.1, attending: true,
      ownedTickets: [{ id: 'qa-v138-url-ticket', type: 'url', url: 'https://qa.invalid/tickets/v138-show-day', addedAt: '2027-01-01T00:00:00.000Z' }],
    };
    document.querySelector('#screen-myconcerts').innerHTML = window.countdownCardHtml(concert);
  }, today);
  const card = page.locator('#countdown-card');
  await expect(card).toHaveAttribute('data-today', 'true');
  await expect(card.locator('.countdown-ticket-outline')).toBeVisible();
  await expect(card.locator('.countdown-ticket-tear')).toHaveCount(1);
  const tearStyle = await card.locator('.countdown-ticket-tear').evaluate((node) => ({ stroke: getComputedStyle(node).stroke, dash: getComputedStyle(node).strokeDasharray }));
  expect(tearStyle.stroke).not.toBe('none');
  expect(tearStyle.dash).not.toBe('none');
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
  const future = new Date();
  future.setDate(future.getDate() + 30);
  const futureDate = localDateString(future);
  await page.evaluate((date) => {
    const concert = {
      id: 'qa-v138-future', bandId: 'qa-artist-two', bandName: 'QA Artist Two', date, time: '19:00',
      venue: 'Test Hall', address: '2 Synthetic Street', city: 'Sample City', country: 'Exampleland', attending: true,
    };
    document.querySelector('#screen-myconcerts').innerHTML = window.countdownCardHtml(concert);
  }, futureDate);
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
