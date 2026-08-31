const { test, expect } = require('@playwright/test');

async function openQa(page, colorScheme) {
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}

async function renderLifecycleExamples(page) {
  await page.evaluate(() => {
    const postponed = {
      id: 'qa-v175-postponed', bandId: 'qa-artist-one', bandName: 'A Very Long Synthetic Artist Name',
      date: null, time: null, lifecycleStatus: 'postponed', venue: 'Synthetic Main Hall', city: 'Copenhagen',
      country: 'Denmark', attending: true, ownedTickets: [], ticketQuantity: 1,
    };
    const cancelled = {
      ...postponed, id: 'qa-v175-cancelled', date: '2026-11-15', time: '20:00', lifecycleStatus: 'cancelled',
    };
    document.querySelector('#screen-myconcerts').innerHTML = `
      <div data-v175-postponed-countdown>${window.countdownCardHtml(postponed)}</div>
      <div data-v175-postponed-row>${window.profileUpcomingRowHtml(postponed)}</div>
      <div data-v175-cancelled-row>${window.myConcertRowHtml(cancelled, false)}</div>`;
  });
}

test('v175 lifecycle states remain explicit and usable at 375 light and 480 dark', async ({ page }, testInfo) => {
  for (const config of [{ width: 375, colorScheme: 'light' }, { width: 480, colorScheme: 'dark' }]) {
    await page.setViewportSize({ width: config.width, height: 900 });
    await openQa(page, config.colorScheme);
    await renderLifecycleExamples(page);

    const postponed = page.locator('[data-v175-postponed-countdown]');
    await expect(postponed).toContainText('Postponed');
    await expect(postponed).toContainText('DATE TBD');
    await expect(page.locator('[data-v175-postponed-row]')).toContainText('POSTPONED · DATE TBD');
    await expect(page.locator('[data-v175-postponed-row]').getByRole('link', { name: 'Add to calendar' })).toHaveCount(0);
    await expect(page.locator('[data-v175-cancelled-row]')).toContainText('CANCELLED');

    const overflow = await page.locator('#screen-myconcerts').evaluate((node) => node.scrollWidth > node.clientWidth + 1);
    expect(overflow).toBe(false);
    if (testInfo.project.name === 'mobile-chromium') {
      await page.locator('#screen-myconcerts').screenshot({
        path: testInfo.outputPath(`v175-lifecycle-${config.width}-${config.colorScheme}.png`),
      });
    }
  }
});
