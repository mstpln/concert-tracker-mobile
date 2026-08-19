const { test, expect } = require('@playwright/test');

async function appDate(page, offsetDays = 0) {
  return page.evaluate((offset) => {
    const date = typeof dlCurrentDate === 'function' ? dlCurrentDate() : new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }, offsetDays);
}

async function render(page, date) {
  await page.evaluate((future) => {
    const concert = {
      id:'qa-v141-location',bandId:'qa-artist',bandName:'LE SSERAFIM',date:future,time:'20:00',
      venue:'Unknown venue',address:'Hannemanns Alle 18-20',postalCode:'2300',city:'Copenhagen',country:'Denmark',
      attending:true,ownedTickets:[],ticketQuantity:4,
    };
    document.querySelector('#screen-myconcerts').innerHTML=window.countdownCardHtml(concert);
  }, date);
  return page.locator('#countdown-card');
}

test('v141 keeps full locality clear of the current ticket quantity presentation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
  const future = await appDate(page, 30);
  for (const width of [375, 432, 480]) {
    await page.setViewportSize({ width, height: 900 });
    const card = await render(page, future);
    const addresses = card.locator('.countdown-v139-address');
    await expect(addresses).toHaveCount(2);
    await expect(addresses.nth(0)).toHaveText('Hannemanns Alle 18-20');
    await expect(addresses.nth(1)).toHaveText('2300 Copenhagen, Denmark');
    const spacing = await card.evaluate((node) => {
      const location = Array.from(node.querySelectorAll('.countdown-v139-address'));
      const quantity = node.querySelector('.countdown-v140-ticket-count strong');
      const lastRect = location.at(-1).getBoundingClientRect();
      const quantityRect = quantity.getBoundingClientRect();
      return { gap: quantityRect.top - lastRect.bottom };
    });
    // v148 replaces the historical separator rules with the approved pill;
    // locality must remain clear of whichever quantity presentation is current.
    expect(spacing.gap).toBeGreaterThanOrEqual(6);
  }
});
