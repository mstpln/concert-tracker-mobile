const { test, expect } = require('@playwright/test');

async function installSyntheticVenueState(page) {
  await page.goto('/');
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('livevault-qa:data') || '{}');
    const template = (data.concerts || []).find((concert) => concert.id === 'qa-show-day');
    if (!template) throw new Error('Synthetic QA fixture qa-show-day is missing');

    const recovered = {
      ...template,
      id: 'qa-gau4-recovered',
      bandId: 'qa-artist-one',
      bandName: 'QA Artist One',
      date: '2027-07-17',
      venue: 'Royal Arena',
      city: 'København S',
      country: 'Denmark',
      venueAddress: 'Hannemanns Allé 18-20, København S, Denmark',
      attending: true,
      ticketUrl: 'https://qa.invalid/tickets/gau4-recovered',
      notes: 'Synthetic user note remains attached.',
      playlistUrl: 'https://example.invalid/playlists/gau4-user-owned',
      photos: ['https://example.invalid/photos/gau4-user-owned.jpg'],
      futureVenueField: { preserve: true },
      sourceProvider: 'ticketmaster',
      providerEventId: 'qa-event-gau4-recovered',
    };

    const unresolved = {
      ...template,
      id: 'qa-gau4-unresolved',
      bandId: 'qa-artist-two',
      bandName: 'QA Artist Two',
      date: '2027-07-19',
      venue: 'Unknown venue',
      city: 'Fallback City',
      country: 'Exampleland',
      venueAddress: '99 Synthetic Street, Fallback City, Exampleland',
      attending: true,
      ticketUrl: 'https://qa.invalid/tickets/gau4-unresolved',
      sourceProvider: 'tavily_groq',
      providerEventId: null,
    };

    data.concerts = [...(data.concerts || []).filter((concert) => !['qa-gau4-recovered', 'qa-gau4-unresolved'].includes(concert.id)), recovered, unresolved];
    localStorage.setItem('livevault-qa:data', JSON.stringify(data));
  });
  await page.reload();
}

test('GAU4 recovered canonical venue is visible while honest fallback remains Unknown venue', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize(testInfo.project.name === 'mobile-chromium'
    ? { width: 375, height: 820 }
    : { width: 480, height: 900 });

  await installSyntheticVenueState(page);
  const screen = page.locator('#screen-myconcerts');
  await expect(screen).toBeVisible();

  const recoveredCard = screen.locator('.row-card-mc', { hasText: 'QA Artist One' }).filter({ hasText: 'Royal Arena' });
  await expect(recoveredCard).toBeVisible();
  await expect(recoveredCard).toContainText('Royal Arena');
  await expect(recoveredCard).toContainText('København S');
  await expect(recoveredCard).toContainText('Hannemanns Allé 18-20');
  await expect(recoveredCard).not.toContainText('Unknown venue');

  const fallbackCard = screen.locator('.row-card-mc', { hasText: 'QA Artist Two' }).filter({ hasText: 'Fallback City' });
  await expect(fallbackCard).toBeVisible();
  await expect(fallbackCard).toContainText('Unknown venue');

  const stored = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('livevault-qa:data') || '{}');
    return data.concerts.find((concert) => concert.id === 'qa-gau4-recovered');
  });
  expect(stored.id).toBe('qa-gau4-recovered');
  expect(stored.attending).toBe(true);
  expect(stored.ticketUrl).toBe('https://qa.invalid/tickets/gau4-recovered');
  expect(stored.notes).toBe('Synthetic user note remains attached.');
  expect(stored.playlistUrl).toBe('https://example.invalid/playlists/gau4-user-owned');
  expect(stored.photos).toEqual(['https://example.invalid/photos/gau4-user-owned.jpg']);
  expect(stored.futureVenueField).toEqual({ preserve: true });

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await screen.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-gau4-venue-correction.png`) });
});
