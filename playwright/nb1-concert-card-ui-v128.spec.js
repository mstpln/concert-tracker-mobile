const { test, expect } = require('@playwright/test');

test('NB1 renders the approved inline countdown and thin image borders', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');

  const result = await page.evaluate(() => {
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
    renderMyConcertsScreen();

    const card = document.querySelector('#screen-myconcerts .row-card-mc');
    const meta = card?.querySelector('.row-km')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const cardImage = card?.querySelector('.row-avatar img');
    const cardBorder = cardImage ? getComputedStyle(cardImage).borderTopWidth : '';

    const profileFixture = document.createElement('div');
    profileFixture.innerHTML = '<div class="profile-avatar"><img src="data:image/svg+xml,%3Csvg xmlns=&quot;http://www.w3.org/2000/svg&quot; width=&quot;20&quot; height=&quot;20&quot;/%3E" alt=""></div>';
    document.body.appendChild(profileFixture);
    const profileImage = profileFixture.querySelector('.profile-avatar img');
    const profileBorder = getComputedStyle(profileImage).borderTopWidth;
    profileFixture.remove();

    return { meta, cardBorder, profileBorder };
  });

  expect(result.meta).toBe('59 km away · 69 days until concert');
  expect(result.cardBorder).toBe('1px');
  expect(result.profileBorder).toBe('1px');
  expect(pageErrors).toEqual([]);
});
