const { test, expect } = require('@playwright/test');

test('NB1 renders the approved inline countdown and thin image borders', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
  // The QA banner appears at DOMContentLoaded, before the async bootstrap has
  // installed v127's real concert-row decorator. Wait for the real renderer,
  // then exercise the row in an attached, synthetic DOM fixture. Calling the
  // entire Music-page renderer after replacing all app globals in one evaluate
  // races other page startup/render observers and can block the test thread.
  await page.waitForFunction(() => (
    !document.getElementById('app')?.classList.contains('hidden') &&
    window.myConcertRowHtml?.name === 'myConcertRowHtmlV127'
  ));

  const result = await page.evaluate(() => {
    const previous = {
      now: window.__LIVEVAULT_QA_NOW__,
      bands,
      concerts,
      listeningEvents,
    };
    const host = document.createElement('div');
    try {
      window.__LIVEVAULT_QA_NOW__ = '2026-08-15T12:00:00.000Z';
      bands = [{
        id: 'nb1-band',
        name: 'NB1 Band',
        genre: 'Rock',
        photoUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/%3E',
        socials: {},
      }];
      concerts = [{
        id: 'nb1-upcoming',
        bandId: 'nb1-band',
        bandName: 'NB1 Band',
        date: '2026-10-23',
        time: '19:30',
        venue: 'Synthetic Arena',
        venueAddress: '1 Test Street',
        city: 'Synthetic City',
        country: 'Denmark',
        distanceKm: 59,
        attending: true,
        manuallyAdded: false,
      }];
      listeningEvents = [];

      // Use the actual installed production card renderer and production CSS.
      // Only the detached-from-app host is synthetic, not the card markup.
      host.innerHTML = myConcertRowHtml(concerts[0], false);
      const profileFixture = document.createElement('div');
      profileFixture.innerHTML = '<div class="profile-avatar"><img src="data:image/svg+xml,%3Csvg xmlns=&quot;http://www.w3.org/2000/svg&quot; width=&quot;20&quot; height=&quot;20&quot;/%3E" alt=""></div>';
      host.appendChild(profileFixture);
      document.body.appendChild(host);

      const card = host.querySelector('.row-card-mc');
      const meta = card?.querySelector('.row-km')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      const cardImage = card?.querySelector('.row-avatar img');
      return {
        meta,
        cardBorder: cardImage ? getComputedStyle(cardImage).borderTopWidth : '',
        profileBorder: getComputedStyle(profileFixture.querySelector('.profile-avatar img')).borderTopWidth,
        cardCount: host.querySelectorAll('.row-card-mc').length,
      };
    } finally {
      host.remove();
      window.__LIVEVAULT_QA_NOW__ = previous.now;
      bands = previous.bands;
      concerts = previous.concerts;
      listeningEvents = previous.listeningEvents;
    }
  });

  expect(result.meta).toBe('59 km away · 69 days until concert');
  expect(result.cardBorder).toBe('1px');
  expect(result.profileBorder).toBe('1px');
  expect(result.cardCount).toBe(1);
  expect(pageErrors).toEqual([]);
});
